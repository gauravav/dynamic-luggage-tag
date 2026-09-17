"""Request payload validation.

Every endpoint parses its body through one of these models. Three settings do
most of the work:

* ``extra="forbid"`` — an unexpected key is an error, not something silently
  ignored. Mass-assignment bugs start with a tolerated extra key.
* ``str_strip_whitespace`` — surrounding whitespace never reaches storage or a
  uniqueness check.
* explicit ``max_length`` everywhere — an unbounded string is an unbounded
  ciphertext, an unbounded row and an unbounded response.
"""

from __future__ import annotations

import json
from typing import Any, TypeVar

from flask import Request
from pydantic import BaseModel, ConfigDict, EmailStr, Field, ValidationError, field_validator

from ..errors import ApiError

T = TypeVar("T", bound=BaseModel)


class Payload(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        str_strip_whitespace=True,
        str_max_length=4096,
        frozen=True,
    )


def parse(request: Request, model: type[T]) -> T:
    """Parses and validates a JSON body, or raises a 400 with field errors."""
    if not request.is_json:
        raise ApiError("unsupported_media_type", "Send the request as JSON.", status=415)
    try:
        raw = request.get_json(silent=False)
    except Exception as exc:  # noqa: BLE001 - werkzeug raises several types
        raise ApiError("invalid_json", "The request body is not valid JSON.") from exc
    if not isinstance(raw, dict):
        raise ApiError("invalid_json", "The request body must be a JSON object.")

    try:
        return model.model_validate(raw)
    except ValidationError as exc:
        fields: dict[str, str] = {}
        for error in exc.errors():
            location = ".".join(str(part) for part in error["loc"]) or "body"
            # Pydantic echoes the offending input in some messages; the message
            # is shown to the caller, so only the reason is forwarded.
            fields[location] = _readable(error["type"], error.get("msg", "Invalid value."))
        raise ApiError("validation_failed", "Some fields need attention.", fields=fields) from exc


def _readable(error_type: str, message: str) -> str:
    return {
        "missing": "This field is required.",
        "string_too_short": "This is too short.",
        "string_too_long": "This is too long.",
        "value_error": message,
        "extra_forbidden": "This field is not accepted here.",
    }.get(error_type, message)


# --------------------------------------------------------------------------
# Auth
# --------------------------------------------------------------------------


class RegisterIn(Payload):
    email: EmailStr = Field(max_length=254)
    password: str = Field(min_length=1, max_length=1024)
    name: str | None = Field(default=None, max_length=120)
    accept_terms: bool = Field(default=False)

    @field_validator("name")
    @classmethod
    def _non_blank(cls, value: str | None) -> str | None:
        return value or None


class LoginIn(Payload):
    email: EmailStr = Field(max_length=254)
    password: str = Field(min_length=1, max_length=1024)
    totp_code: str | None = Field(default=None, max_length=12)
    recovery_code: str | None = Field(default=None, max_length=64)


class PasswordChangeIn(Payload):
    current_password: str = Field(min_length=1, max_length=1024)
    new_password: str = Field(min_length=1, max_length=1024)


class PasswordResetRequestIn(Payload):
    email: EmailStr = Field(max_length=254)


class PasswordResetIn(Payload):
    token: str = Field(min_length=16, max_length=256)
    new_password: str = Field(min_length=1, max_length=1024)


class EmailVerifyIn(Payload):
    token: str = Field(min_length=16, max_length=256)


class ResendVerificationIn(Payload):
    email: EmailStr = Field(max_length=254)


class TotpEnableIn(Payload):
    code: str = Field(min_length=6, max_length=8)


class TotpDisableIn(Payload):
    password: str = Field(min_length=1, max_length=1024)


# --------------------------------------------------------------------------
# Account
# --------------------------------------------------------------------------


class AccountUpdateIn(Payload):
    name: str | None = Field(default=None, max_length=120)
    phone: str | None = Field(default=None, max_length=32)
    address: str | None = Field(default=None, max_length=512)
    notify_on_scan: bool | None = None

    @field_validator("phone")
    @classmethod
    def _plausible_phone(cls, value: str | None) -> str | None:
        if value is None or value == "":
            return None
        digits = [ch for ch in value if ch.isdigit()]
        if not 6 <= len(digits) <= 18:
            raise ValueError("Enter a phone number with between 6 and 18 digits.")
        if any(ch not in "+-() ." and not ch.isdigit() for ch in value):
            raise ValueError("Use digits and + - ( ) . only.")
        return value


class AccountDeleteIn(Payload):
    password: str = Field(min_length=1, max_length=1024)
    confirm: str = Field(max_length=32)

    @field_validator("confirm")
    @classmethod
    def _must_confirm(cls, value: str) -> str:
        if value.strip().upper() != "DELETE":
            raise ValueError("Type DELETE to confirm.")
        return value


# --------------------------------------------------------------------------
# Tags
# --------------------------------------------------------------------------


class TagCreateIn(Payload):
    label: str | None = Field(default=None, max_length=80)


class TagUpdateIn(Payload):
    label: str | None = Field(default=None, max_length=80)
    status: str | None = Field(default=None, max_length=8)
    reveal_name: bool | None = None
    reveal_message_relay: bool | None = None
    notify_on_scan: bool | None = None

    @field_validator("status")
    @classmethod
    def _known_status(cls, value: str | None) -> str | None:
        if value is None:
            return None
        if value not in {"safe", "lost"}:
            raise ValueError("Status must be 'safe' or 'lost'.")
        return value


class NfcChipIn(Payload):
    """A chip serial number as Web NFC reports it, e.g. ``04:a2:3b:1c:5d:80:00``."""

    serial: str = Field(min_length=1, max_length=64)

    @field_validator("serial")
    @classmethod
    def _normalized_serial(cls, value: str) -> str:
        serial = value.replace(":", "").replace("-", "").lower()
        # NFC Forum tags carry a 4, 7 or 10 byte UID.
        if not 8 <= len(serial) <= 20 or any(ch not in "0123456789abcdef" for ch in serial):
            raise ValueError("This does not look like an NFC chip serial number.")
        return serial


class NfcBindIn(NfcChipIn):
    # Set once the owner has confirmed moving a chip between their own tags, or
    # swapping this tag's sticker for a new one.
    replace: bool = False


# --------------------------------------------------------------------------
# Public scan surface
# --------------------------------------------------------------------------


class ScanLocationIn(Payload):
    """A finder choosing to share where they are. Opt-in, coarse, one-time."""

    share: bool = True
    city: str | None = Field(default=None, max_length=64)
    region: str | None = Field(default=None, max_length=64)
    country: str | None = Field(default=None, max_length=2)


class FinderMessageIn(Payload):
    body: str = Field(min_length=1, max_length=2000)
    contact: str | None = Field(default=None, max_length=120)
    # Where to send the conversation link and reply notices. Never shown to the owner.
    email: EmailStr | None = Field(default=None, max_length=254)


class RelayReplyIn(Payload):
    body: str = Field(min_length=1, max_length=2000)


def dumps(value: Any) -> str:
    return json.dumps(value, separators=(",", ":"), sort_keys=True)
