"""Owner notifications, and every message the system sends.

All the copy lives here rather than at the call sites, so the tone stays
consistent and so it is possible to read, in one file, exactly what this
service ever puts in somebody's inbox.

Two rules shape that copy:

* Notifications say as little as possible. "Your tag was scanned", never which
  bag or what a finder wrote. Mail arrives on lock screens, in shared accounts
  and over hops nobody controls; the detail belongs behind a login.
* Security mail always tells the recipient what to do if it was not them, with
  a link they can act on.

Scan mail is additionally rate limited on two axes, because the promise is "a
quiet email, not a push-notification flood": a cooldown per tag, and
deduplication by the day-salted hash of the scanner.
"""

from __future__ import annotations

import datetime as dt
import logging

from sqlalchemy import select
from sqlalchemy.orm import Session as OrmSession

from ..config import Config
from ..models import RelayThread, ScanEvent, Tag, User, utcnow
from ..security.pii import UserCrypto
from .email_templates import Email, render_html, render_text
from .geo import CoarseLocation
from .mailer import Mailer

log = logging.getLogger(__name__)


# --------------------------------------------------------------------------
# Delivery
# --------------------------------------------------------------------------


def deliver(mailer: Mailer, address: str, email: Email) -> bool:
    """Renders both parts and sends. Never raises.

    A mail provider being down must not fail the request that triggered it —
    a scan still records and a relay message still saves.
    """
    try:
        mailer.send(
            to=address,
            subject=email.subject,
            body=render_text(email),
            html=render_html(email),
        )
    except Exception:  # noqa: BLE001 - reported, never propagated
        log.exception("Failed to send %r", email.subject)
        return False
    return True


def _url(config: Config, path: str) -> str:
    return f"{config.public_base_url.rstrip('/')}{path}"


# --------------------------------------------------------------------------
# Account and security mail
# --------------------------------------------------------------------------


def verification_email(config: Config, token: str, *, returning: bool = False) -> Email:
    """Confirms a new address, or re-sends the link to an unverified account."""
    return Email(
        subject="Confirm your email address",
        heading="Confirm your email address",
        preheader="One tap to activate your Dynamic Luggage Tag account.",
        paragraphs=(
            [
                "You already started an account with this address but never "
                "confirmed it, so here is a fresh link.",
                "Your original password still applies. If you have forgotten it, "
                "confirm first and then use the reset link on the sign-in page.",
            ]
            if returning
            else [
                "Welcome to Dynamic Luggage Tag. Confirm this address to activate "
                "your account and get your design.",
            ]
        ),
        button=("Confirm my address", _url(config, f"/verify?token={token}")),
        footnote=(
            "This link is valid for 24 hours and can be used once. "
            "If you did not sign up, you can ignore this email — nothing was created."
        ),
        accent="forest",
    )


def duplicate_registration_email(config: Config) -> Email:
    """Sent when someone tries to register a verified address.

    The registration endpoint answers identically whether or not an address is
    known, so this is how the person actually entitled to know finds out.
    """
    return Email(
        subject="Someone tried to register with your address",
        heading="Someone tried to sign up with your address",
        preheader="No action is needed — your account was not changed.",
        paragraphs=[
            "Someone entered this address when signing up for Dynamic Luggage Tag. "
            "You already have an account, so nothing was created.",
            "If that was you, sign in instead.",
        ],
        button=("Sign in", _url(config, "/login")),
        footnote=(
            "If it was not you, no action is needed. The attempt did not create "
            "anything, change your account, or reveal that you have one."
        ),
        accent="brass",
    )


def password_reset_email(config: Config, token: str) -> Email:
    return Email(
        subject="Reset your password",
        heading="Choose a new password",
        preheader="This link is valid for 30 minutes.",
        paragraphs=[
            "Use the link below to set a new password for your Dynamic Luggage Tag account.",
            "Finishing the reset signs out every device currently using the account.",
        ],
        button=("Set a new password", _url(config, f"/reset?token={token}")),
        footnote=(
            "This link is valid for 30 minutes and can be used once. "
            "If you did not ask for it, you can ignore this email."
        ),
        accent="forest",
    )


def password_changed_email(config: Config) -> Email:
    return Email(
        subject="Your password was changed",
        heading="Your password was changed",
        preheader="Other signed-in devices were signed out.",
        paragraphs=[
            "The password on your Dynamic Luggage Tag account was just changed, "
            "and every other signed-in device was signed out.",
        ],
        button=("This was not me — reset it", _url(config, "/forgot")),
        footnote="If you made this change, there is nothing to do.",
        accent="brick",
    )


def totp_disabled_email(config: Config) -> Email:
    return Email(
        subject="Two-factor authentication was turned off",
        heading="Two-factor authentication is off",
        preheader="Your password alone now signs you in.",
        paragraphs=[
            "Two-factor authentication was turned off on your account. Your "
            "password alone is now enough to sign in.",
        ],
        button=("This was not me — reset my password", _url(config, "/forgot")),
        footnote="If you turned it off yourself, there is nothing to do.",
        accent="brick",
    )


def account_deleted_email() -> Email:
    return Email(
        subject="Your account has been deleted",
        heading="Your account has been deleted",
        preheader="Your data key was destroyed; nothing can be read again.",
        paragraphs=[
            "Your Dynamic Luggage Tag account and all of its data have been deleted.",
            "The key that could decrypt your details was destroyed, so any copy "
            "that remains in a backup cannot be read.",
            "Any printed tags you still have will show “not registered” when scanned.",
        ],
        footnote="This is the last email we will send to this address.",
        accent="brass",
    )


# --------------------------------------------------------------------------
# Scan and relay mail
# --------------------------------------------------------------------------


def recent_duplicate(
    db: OrmSession, tag: Tag, ip_hash: bytes | None, *, config: Config
) -> ScanEvent | None:
    """The same scanner's very recent scan of this tag, if there is one."""
    if ip_hash is None:
        return None
    since = utcnow() - dt.timedelta(minutes=config.scan_dedup_minutes)
    return db.scalar(
        select(ScanEvent)
        .where(
            ScanEvent.tag_id == tag.id,
            ScanEvent.ip_hash == ip_hash,
            ScanEvent.occurred_at >= since,
        )
        .order_by(ScanEvent.occurred_at.desc())
        .limit(1)
    )


def should_notify(tag: Tag, user: User, *, config: Config) -> bool:
    if not user.notify_on_scan or not tag.notify_on_scan:
        return False
    if tag.last_notified_at is None:
        return True
    cooldown = dt.timedelta(minutes=config.scan_notify_cooldown_minutes)
    return utcnow() - tag.last_notified_at >= cooldown


def scan_email(config: Config, location: CoarseLocation, *, revealed_contact: bool) -> Email:
    where = f" near {location.label()}" if not location.is_empty() else ""
    return Email(
        subject="Your luggage tag was scanned",
        heading=f"Your tag was scanned{where}",
        preheader=(
            "Your name was shown, because the bag is marked lost."
            if revealed_contact
            else "No personal details were shown."
        ),
        paragraphs=[
            f"Someone scanned one of your luggage tags{where}.",
            (
                "This bag is marked lost, so your name and a message link were shown."
                if revealed_contact
                else "This bag is marked safe, so no personal details were shown."
            ),
        ],
        button=("Open my dashboard", _url(config, "/app")),
        footnote=(
            "If this was not expected, you can rotate the tag's code from the same "
            "page — that invalidates every printed copy of it."
        ),
        accent="brick" if revealed_contact else "forest",
    )


def relay_message_email(config: Config) -> Email:
    # The body stays out of the email on purpose: a stranger wrote it, and it
    # belongs behind a login rather than in a lock-screen preview.
    return Email(
        subject="A message about your bag",
        heading="Someone who found your bag sent you a message",
        preheader="Read and reply without sharing your number.",
        paragraphs=[
            "Someone who found one of your bags has sent you a message. "
            "It is waiting in your inbox.",
            "Replies are relayed, so they never see your email address or "
            "phone number — and you never see theirs.",
        ],
        button=("Read the message", _url(config, "/app/inbox")),
        accent="brick",
    )


def finder_conversation_email(config: Config, relay_token: str) -> Email:
    """Sent to a finder who left an email address, right after their first message."""
    return Email(
        subject="Your conversation about a found bag",
        heading="Thank you for helping a bag get home",
        preheader="Keep this email: it has your link back to the conversation.",
        paragraphs=[
            "Your message was delivered, and the owner of the bag has been notified.",
            "Use the link below to read their reply and answer. It is the only way "
            "back into the conversation, so keep this email. We will also email "
            "you here when the owner replies.",
            "The owner never sees this email address.",
        ],
        button=("Open the conversation", _url(config, f"/r/{relay_token}")),
        footnote=(
            "If you did not send a message about a lost bag, someone typed your "
            "address by mistake. Open the link and choose “Stop email updates” "
            "and we will not write again."
        ),
        accent="forest",
    )


def finder_reply_email(config: Config, relay_token: str) -> Email:
    # As with the owner's notice, the reply itself stays behind the link: the
    # owner wrote it for the conversation, not for a lock-screen preview.
    return Email(
        subject="The owner replied about the bag you found",
        heading="The owner replied",
        preheader="Open the conversation to read it.",
        paragraphs=[
            "The owner of the bag you found has replied to your message.",
            "Open the conversation to read it and answer. They still never see your email address.",
        ],
        button=("Read the reply", _url(config, f"/r/{relay_token}")),
        footnote=("To stop these emails, open the conversation and choose “Stop email updates”."),
        accent="forest",
    )


# --------------------------------------------------------------------------
# Senders that need a decrypted address
# --------------------------------------------------------------------------


def notify_scan(
    mailer: Mailer,
    *,
    user: User,
    crypto: UserCrypto,
    tag: Tag,
    location: CoarseLocation,
    revealed_contact: bool,
    config: Config,
) -> bool:
    address = crypto.read_user(user, "email")
    if not address:
        return False
    return deliver(mailer, address, scan_email(config, location, revealed_contact=revealed_contact))


def notify_relay_message(mailer: Mailer, *, user: User, crypto: UserCrypto, config: Config) -> bool:
    address = crypto.read_user(user, "email")
    if not address:
        return False
    return deliver(mailer, address, relay_message_email(config))


def notify_finder_opened(
    mailer: Mailer, *, thread: RelayThread, crypto: UserCrypto, relay_token: str, config: Config
) -> bool:
    address = crypto.read_thread(thread, "finder_email")
    if not address:
        return False
    return deliver(mailer, address, finder_conversation_email(config, relay_token))


def notify_finder_reply(
    mailer: Mailer, *, thread: RelayThread, crypto: UserCrypto, config: Config
) -> bool:
    """Tells a subscribed finder the owner replied, at most once per cooldown.

    The cooldown turns a burst of short replies into one email: the link opens
    the whole conversation, so a second email adds nothing.
    """
    if thread.finder_email_enc is None or thread.finder_token_enc is None:
        return False
    if thread.finder_notified_at is not None:
        cooldown = dt.timedelta(minutes=config.relay_notify_cooldown_minutes)
        if utcnow() - thread.finder_notified_at < cooldown:
            return False
    address = crypto.read_thread(thread, "finder_email")
    relay_token = crypto.read_thread(thread, "finder_token")
    if not address or not relay_token:
        return False
    return deliver(mailer, address, finder_reply_email(config, relay_token))
