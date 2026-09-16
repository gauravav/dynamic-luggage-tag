"""Envelope encryption for personal data.

Layout
------
Each user row carries its own 256-bit data-encryption key (DEK). The DEK is
stored wrapped by a key-encryption key (KEK) that lives only in the process
environment, never in the database. Personal fields are encrypted with the
user's DEK.

Two properties fall out of that:

* A database dump on its own is inert — without the KEK there is no way back
  to a DEK, and without a DEK there is no way back to a name or a phone number.
* Deleting a user's wrapped DEK destroys every field encrypted under it. That
  is how account deletion is implemented ("crypto-shredding"): the ciphertext
  may survive in a backup, but nothing can read it again.

Every ciphertext is bound to its location with AES-GCM associated data
(``table:column:row_id``). Moving a ciphertext from one row or column to
another — say, pasting a victim's encrypted phone number into the attacker's
own row to have the app decrypt it — fails authentication instead of
decrypting.
"""

from __future__ import annotations

import hashlib
import hmac
import os
import secrets
import unicodedata

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

# Ciphertext framing: version || nonce || ciphertext+tag
_FORMAT_VERSION = 1
_NONCE_BYTES = 12
_KEY_BYTES = 32


class DecryptionError(Exception):
    """Ciphertext failed authentication, or the key is wrong."""


class CryptoError(Exception):
    """A key or ciphertext is structurally invalid."""


def new_key() -> bytes:
    """A fresh 256-bit key from the OS CSPRNG."""
    return os.urandom(_KEY_BYTES)


def _seal(key: bytes, plaintext: bytes, aad: bytes) -> bytes:
    if len(key) != _KEY_BYTES:
        raise CryptoError("key must be 32 bytes")
    nonce = os.urandom(_NONCE_BYTES)
    ciphertext = AESGCM(key).encrypt(nonce, plaintext, aad)
    return bytes([_FORMAT_VERSION]) + nonce + ciphertext


def _open(key: bytes, blob: bytes, aad: bytes) -> bytes:
    if not blob or len(blob) < 1 + _NONCE_BYTES + 16:
        raise DecryptionError("ciphertext is truncated")
    if blob[0] != _FORMAT_VERSION:
        raise DecryptionError(f"unsupported ciphertext version {blob[0]}")
    nonce = blob[1 : 1 + _NONCE_BYTES]
    body = blob[1 + _NONCE_BYTES :]
    try:
        return AESGCM(key).decrypt(nonce, body, aad)
    except InvalidTag as exc:
        raise DecryptionError("ciphertext failed authentication") from exc


def field_aad(table: str, column: str, row_id: object) -> bytes:
    """Associated data pinning a ciphertext to one column of one row."""
    return f"{table}:{column}:{row_id}".encode()


class Keyring:
    """Holds every KEK version so old rows stay readable across a rotation.

    New wrapping always uses ``active_version``. ``rewrap`` moves a single
    wrapped DEK onto the active version without ever exposing the DEK outside
    this object's caller.
    """

    def __init__(self, keys: dict[int, bytes], active_version: int) -> None:
        if not keys:
            raise CryptoError("keyring requires at least one key")
        for version, key in keys.items():
            if len(key) != _KEY_BYTES:
                raise CryptoError(f"KEK v{version} must be 32 bytes")
        if active_version not in keys:
            raise CryptoError(f"active KEK version {active_version} is not in the keyring")
        self._keys = dict(keys)
        self.active_version = active_version

    def wrap(self, dek: bytes, *, owner_id: object) -> tuple[bytes, int]:
        aad = f"dek:{owner_id}".encode()
        return _seal(self._keys[self.active_version], dek, aad), self.active_version

    def unwrap(self, wrapped: bytes, version: int, *, owner_id: object) -> bytes:
        key = self._keys.get(version)
        if key is None:
            raise DecryptionError(
                f"KEK v{version} is not loaded — set DLT_KEK_V{version} to read this row"
            )
        aad = f"dek:{owner_id}".encode()
        return _open(key, wrapped, aad)

    def rewrap(self, wrapped: bytes, version: int, *, owner_id: object) -> tuple[bytes, int]:
        dek = self.unwrap(wrapped, version, owner_id=owner_id)
        try:
            return self.wrap(dek, owner_id=owner_id)
        finally:
            del dek


def encrypt_field(dek: bytes, value: str | None, aad: bytes) -> bytes | None:
    """Encrypts one field. ``None`` stays ``None`` so NULL remains meaningful."""
    if value is None:
        return None
    return _seal(dek, value.encode("utf-8"), aad)


def decrypt_field(dek: bytes, blob: bytes | None, aad: bytes) -> str | None:
    if blob is None:
        return None
    return _open(dek, bytes(blob), aad).decode("utf-8")


def encrypt_bytes(dek: bytes, value: bytes, aad: bytes) -> bytes:
    return _seal(dek, value, aad)


def decrypt_bytes(dek: bytes, blob: bytes, aad: bytes) -> bytes:
    return _open(dek, bytes(blob), aad)


# --------------------------------------------------------------------------
# Deterministic lookup
# --------------------------------------------------------------------------


def normalize_email(email: str) -> str:
    """Casefolds and NFKC-normalizes so one address maps to one index value.

    The local part is left otherwise untouched: stripping dots or plus-tags
    would silently merge addresses that some providers treat as distinct.
    """
    email = unicodedata.normalize("NFKC", email.strip())
    local, _, domain = email.rpartition("@")
    if not local:
        return email.casefold()
    return f"{local}@{domain.casefold()}".casefold()


def blind_index(key: bytes, namespace: str, value: str) -> bytes:
    """Deterministic, keyed index for equality lookups on encrypted columns.

    Keyed so an attacker holding the database cannot test guesses offline, and
    namespaced so the same value in two columns produces two different indexes.
    """
    message = f"{namespace}\x00{value}".encode()
    return hmac.new(key, message, hashlib.sha256).digest()


def hash_token(pepper: bytes, namespace: str, token: str) -> bytes:
    """HMACs a bearer token for storage.

    Session, scan and relay tokens are all stored this way: a stolen database
    yields hashes, not usable tokens. HMAC rather than a slow KDF is right here
    because the tokens are full-entropy random values, not passwords.
    """
    return hmac.new(pepper, f"{namespace}\x00{token}".encode(), hashlib.sha256).digest()


def new_token(byte_length: int = 32) -> str:
    """A URL-safe bearer token with `byte_length` bytes of entropy."""
    return secrets.token_urlsafe(byte_length)


def constant_time_equals(a: bytes, b: bytes) -> bool:
    return hmac.compare_digest(a, b)
