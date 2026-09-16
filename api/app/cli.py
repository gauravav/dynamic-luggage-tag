"""Operational commands.

Everything here runs against live personal data, so each command either avoids
touching plaintext entirely or says plainly what it is about to do.
"""

from __future__ import annotations

import smtplib

import click
from flask import Flask
from flask.cli import with_appcontext
from sqlalchemy import select

from .extensions import app_config, db_session, keyring
from .models import Base, User
from .services import retention


def register_cli(app: Flask) -> None:
    app.cli.add_command(init_db)
    app.cli.add_command(purge)
    app.cli.add_command(rewrap_keys)
    app.cli.add_command(verify_email_cmd)
    app.cli.add_command(check_config)
    app.cli.add_command(send_test_email)


@click.command("init-db")
@with_appcontext
def init_db() -> None:
    """Creates the schema directly. Use Alembic for anything but a fresh start."""
    from .extensions import db_session as _session

    engine = _session().get_bind()
    Base.metadata.create_all(engine)
    click.echo("Schema created.")


@click.command("purge")
@with_appcontext
def purge() -> None:
    """Deletes scan history, conversations and audit rows past retention."""
    db = db_session()
    counts = retention.purge_expired(db)
    counts["sessions"] = retention.purge_expired_sessions(db)
    counts["email_tokens"] = retention.purge_expired_email_tokens(db)
    for table, number in counts.items():
        click.echo(f"{table:16s} {number}")


@click.command("rewrap-keys")
@click.option("--dry-run", is_flag=True, help="Report what would change and stop.")
@with_appcontext
def rewrap_keys(dry_run: bool) -> None:
    """Re-wraps every data key onto the active KEK version.

    Run after adding a new DLT_KEK_V<n> and pointing DLT_KEK_ACTIVE_VERSION at
    it. Field ciphertexts are untouched — only the wrapped data keys move — so
    this is fast and safe to re-run. Keep the old KEK in the environment until
    it reports zero remaining.
    """
    ring = keyring()
    db = db_session()
    users = db.scalars(select(User).where(User.deleted_at.is_(None))).all()

    pending = [user for user in users if user.dek_version != ring.active_version]
    click.echo(f"{len(pending)} of {len(users)} data keys are not on v{ring.active_version}.")
    if dry_run or not pending:
        return

    for user in pending:
        wrapped, version = ring.rewrap(bytes(user.dek_wrapped), user.dek_version, owner_id=user.id)
        user.dek_wrapped = wrapped
        user.dek_version = version
    db.commit()
    click.echo(f"Re-wrapped {len(pending)} data keys onto v{ring.active_version}.")


@click.command("verify-email")
@click.argument("email")
@with_appcontext
def verify_email_cmd(email: str) -> None:
    """Marks an address verified. Development only.

    Refuses to run in production: it would bypass the one check standing
    between an account and publishing a name on a public scan page.
    """
    config = app_config()
    if config.is_production:
        raise click.ClickException("Not available in production.")

    from .models import utcnow
    from .services.accounts import find_by_email

    db = db_session()
    user = find_by_email(db, email, config=config)
    if user is None:
        raise click.ClickException("No account with that address.")
    user.email_verified_at = utcnow()
    db.commit()
    click.echo(f"Verified {email}.")


@click.command("check-config")
@with_appcontext
def check_config() -> None:
    """Reports the security posture of the running configuration."""
    config = app_config()
    checks = [
        ("environment", config.env, True),
        ("secure cookies", config.cookie_secure, config.cookie_secure or not config.is_production),
        ("database TLS", "sslmode=" in config.database_url, "sslmode=" in config.database_url),
        ("KEK versions loaded", sorted(config.kek_versions), True),
        ("active KEK", config.kek_active_version, True),
        ("mail provider", config.mail_provider, True),
        ("geo provider", config.geo_provider, True),
        ("scan retention (days)", config.scan_retention_days, config.scan_retention_days <= 365),
        ("trusted proxy hops", config.trusted_proxy_hops, True),
        ("public base URL", config.public_base_url, True),
    ]
    for label, value, ok in checks:
        mark = click.style("ok", fg="green") if ok else click.style("check", fg="yellow")
        click.echo(f"{mark:>14}  {label:24s} {value}")


@click.command("send-test-email")
@click.argument("address")
@with_appcontext
def send_test_email(address: str) -> None:
    """Sends one test message, to check a mail provider is configured correctly.

    Reports the provider and settings in use first, so a message that silently
    went to stdout is not mistaken for one that was delivered.
    """
    from flask import current_app

    config = app_config()
    mailer = current_app.extensions["mailer"]

    click.echo(f"provider  {config.mail_provider}")
    click.echo(f"from      {config.mail_from}")
    if config.mail_provider == "smtp":
        smtp = config.smtp
        starttls = str(smtp["starttls"]).lower() in {"1", "true", "yes", "on"}
        mode = (
            "implicit TLS"
            if str(smtp["port"]) == "465"
            else ("STARTTLS" if starttls else click.style("PLAINTEXT", fg="red"))
        )
        click.echo(f"server    {smtp['host']}:{smtp['port']} ({mode})")
        click.echo(f"username  {smtp['username'] or '(none)'}")
        # Length only — never the password itself, and never a prefix of it.
        password = smtp["password"]
        # Length only — never the password, and never a prefix of it.
        shown = f"set, {len(password)} characters" if password else click.style("NOT SET", fg="red")
        click.echo(f"password  {shown}")

    elif config.mail_provider == "console":
        click.echo(
            click.style(
                "\nThis provider prints to stdout and sends nothing. "
                "Set DLT_MAIL_PROVIDER=smtp to actually deliver mail.",
                fg="yellow",
            )
        )
    click.echo("")

    from .services.email_templates import Email, render_html, render_text

    message = Email(
        subject="Dynamic Luggage Tag test message",
        heading="Outbound mail is working",
        preheader="A test message from your own deployment.",
        paragraphs=[
            "This is a test message from your Dynamic Luggage Tag deployment.",
            "If you are reading it in an inbox, verification links, password "
            "resets and scan notifications will reach people.",
        ],
        footnote="Nobody else received this. It was sent only to the address you passed.",
    )

    try:
        mailer.send(
            to=address,
            subject=message.subject,
            body=render_text(message),
            html=render_html(message),
        )
    except smtplib.SMTPAuthenticationError as exc:
        hint = ""
        password = config.smtp.get("password", "")
        if password and any(character.isspace() for character in password):
            # Google shows app passwords in four spaced groups and accepts
            # them either way, so this is not usually the cause — but a
            # rejected login looks identical to a wrong password, so it is
            # worth ruling out when one has actually been rejected.
            hint = (
                f"\n\nThe password contains whitespace ({len(password)} characters). "
                "Gmail normally accepts an app password with its spaces, but try "
                "the 16-character form with them removed."
            )
        raise click.ClickException(f"SMTPAuthenticationError: {exc}{hint}") from exc
    except Exception as exc:  # noqa: BLE001 - the whole point is to report it
        raise click.ClickException(f"{type(exc).__name__}: {exc}") from exc

    click.echo(click.style(f"Sent to {address}.", fg="green"))
