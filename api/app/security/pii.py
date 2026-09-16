"""Reading and writing a user's encrypted fields.

Wraps the envelope so call sites never handle a data key directly and can
never forget the associated data that pins a ciphertext to its own row.
"""

from __future__ import annotations

from dataclasses import dataclass

from ..models import RelayMessage, RelayThread, Tag, User
from .crypto import Keyring, decrypt_field, encrypt_field, field_aad


@dataclass(frozen=True)
class UserCrypto:
    """A user's unwrapped data key, scoped to one request.

    Held only for the life of a request. `dek` is excluded from repr so it
    cannot leak into a traceback, a log line or an error report.
    """

    user_id: object
    dek: bytes

    def __repr__(self) -> str:  # pragma: no cover - defensive
        return f"UserCrypto(user_id={self.user_id!r}, dek=<redacted>)"

    # -- users -------------------------------------------------------------
    def read_user(self, user: User, column: str) -> str | None:
        return decrypt_field(
            self.dek, getattr(user, f"{column}_enc"), field_aad("users", column, user.id)
        )

    def write_user(self, user: User, column: str, value: str | None) -> None:
        setattr(
            user,
            f"{column}_enc",
            encrypt_field(self.dek, value, field_aad("users", column, user.id)),
        )

    # -- tags --------------------------------------------------------------
    def read_tag(self, tag: Tag, column: str) -> str | None:
        return decrypt_field(
            self.dek, getattr(tag, f"{column}_enc"), field_aad("tags", column, tag.id)
        )

    def write_tag(self, tag: Tag, column: str, value: str | None) -> None:
        setattr(
            tag,
            f"{column}_enc",
            encrypt_field(self.dek, value, field_aad("tags", column, tag.id)),
        )

    # -- relay -------------------------------------------------------------
    def read_message(self, message: RelayMessage) -> str:
        return (
            decrypt_field(
                self.dek, message.body_enc, field_aad("relay_messages", "body", message.id)
            )
            or ""
        )

    def write_message(self, message: RelayMessage, body: str) -> None:
        message.body_enc = encrypt_field(
            self.dek, body, field_aad("relay_messages", "body", message.id)
        )

    def read_thread(self, thread: RelayThread, column: str) -> str | None:
        return decrypt_field(
            self.dek,
            getattr(thread, f"{column}_enc"),
            field_aad("relay_threads", column, thread.id),
        )

    def write_thread(self, thread: RelayThread, column: str, value: str | None) -> None:
        setattr(
            thread,
            f"{column}_enc",
            encrypt_field(self.dek, value, field_aad("relay_threads", column, thread.id)),
        )

    # -- scans -------------------------------------------------------------
    def read_scan_location(self, scan) -> str | None:
        return decrypt_field(
            self.dek, scan.location_enc, field_aad("scan_events", "location", scan.id)
        )

    def write_scan_location(self, scan, value: str | None) -> None:
        scan.location_enc = encrypt_field(
            self.dek, value, field_aad("scan_events", "location", scan.id)
        )


def unlock(keyring: Keyring, user: User) -> UserCrypto:
    """Unwraps a user's data key. Raises DecryptionError if the KEK is wrong."""
    dek = keyring.unwrap(bytes(user.dek_wrapped), user.dek_version, owner_id=user.id)
    return UserCrypto(user_id=user.id, dek=dek)
