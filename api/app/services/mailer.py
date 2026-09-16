"""Outbound mail.

A plugin point, per the project's open-core split: a self-hoster brings their
own provider through configuration rather than a code fork.

Notification bodies deliberately stay vague — "your tag was scanned", never
which bag or where beyond a city. Mail arrives in an inbox the owner may read
on a lock screen, in a shared account, or over an unencrypted hop; the detail
belongs behind a login.
"""

from __future__ import annotations

import logging
import smtplib
import ssl
from abc import ABC, abstractmethod
from email.message import EmailMessage
from email.utils import formataddr

from ..config import Config

log = logging.getLogger(__name__)


class Mailer(ABC):
    @abstractmethod
    def send(self, *, to: str, subject: str, body: str, html: str | None = None) -> None: ...


class ConsoleMailer(Mailer):
    """Development provider: prints the message instead of sending it.

    The recipient address is masked even here — a development log is still a
    place personal data should not accumulate.
    """

    def send(self, *, to: str, subject: str, body: str, html: str | None = None) -> None:
        # The plain-text part is logged, never the HTML: the point of the
        # console provider is to read the links during development, and a wall
        # of table markup buries them.
        log.info(
            "[mail] to=%s subject=%s%s\n%s",
            mask_email(to),
            subject,
            " (multipart)" if html else "",
            body,
        )


class SmtpMailer(Mailer):
    """SMTP with STARTTLS and certificate verification on by default."""

    def __init__(self, config: Config) -> None:
        self._from = config.mail_from
        self._host = config.smtp["host"]
        self._port = int(config.smtp["port"] or 587)
        self._username = config.smtp["username"]
        self._password = config.smtp["password"]
        self._starttls = str(config.smtp["starttls"]).lower() in {"1", "true", "yes", "on"}
        if not self._host:
            raise ValueError("DLT_SMTP_HOST is required when DLT_MAIL_PROVIDER=smtp")

    def send(self, *, to: str, subject: str, body: str, html: str | None = None) -> None:
        message = EmailMessage()
        message["From"] = formataddr(("Dynamic Luggage Tag", self._from))
        message["To"] = to
        message["Subject"] = subject
        # Tells well-behaved clients not to auto-reply; these are one-way.
        message["Auto-Submitted"] = "auto-generated"

        # multipart/alternative, text first. Clients pick the last part they
        # can render, so the order matters: text is the fallback, not the
        # preference.
        message.set_content(body)
        if html:
            message.add_alternative(html, subtype="html")

        context = ssl.create_default_context()
        context.check_hostname = True
        context.verify_mode = ssl.CERT_REQUIRED

        if self._port == 465:
            with smtplib.SMTP_SSL(self._host, self._port, context=context, timeout=15) as smtp:
                self._authenticate(smtp)
                smtp.send_message(message)
            return

        with smtplib.SMTP(self._host, self._port, timeout=15) as smtp:
            smtp.ehlo()
            if self._starttls:
                smtp.starttls(context=context)
                smtp.ehlo()
            elif self._username:
                # Refusing to send credentials in the clear is the whole point
                # of having a TLS setting; do not quietly downgrade.
                raise RuntimeError(
                    "Refusing to authenticate over an unencrypted SMTP connection. "
                    "Set DLT_SMTP_STARTTLS=true or use port 465."
                )
            self._authenticate(smtp)
            smtp.send_message(message)

    def _authenticate(self, smtp: smtplib.SMTP) -> None:
        if self._username:
            smtp.login(self._username, self._password)


def build_mailer(config: Config) -> Mailer:
    if config.mail_provider == "smtp":
        return SmtpMailer(config)
    if config.mail_provider == "console":
        return ConsoleMailer()
    raise ValueError(f"Unknown DLT_MAIL_PROVIDER: {config.mail_provider}")


def mask_email(email: str) -> str:
    """r****@example.com — enough to recognise, not enough to harvest."""
    local, separator, domain = email.partition("@")
    if not separator:
        return "***"
    head = local[0] if local else "*"
    return f"{head}{'*' * max(3, len(local) - 1)}@{domain}"
