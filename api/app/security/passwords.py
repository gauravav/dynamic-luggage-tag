"""Password hashing and policy.

Argon2id with parameters from config, so a deployment on bigger hardware can
raise the cost without a code change. Hashes carry their own parameters, which
lets `needs_rehash` upgrade a user's hash transparently at their next login.
"""

from __future__ import annotations

import contextlib
import secrets
import unicodedata

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError
from argon2.low_level import Type

# A short list of the shapes that show up constantly in credential-stuffing
# lists. This is a speed bump, not a substitute for a breach corpus — see
# `check_password_policy` for the hook to plug one in.
_OBVIOUS = frozenset(
    {
        "password",
        "passw0rd",
        "letmein",
        "welcome",
        "iloveyou",
        "admin",
        "qwerty",
        "qwertyuiop",
        "123456",
        "1234567890",
        "111111",
        "abc123",
        "monkey",
        "dragon",
        "sunshine",
        "princess",
        "football",
        "baseball",
        "trustno1",
        "changeme",
        "secret",
        "starwars",
        "whatever",
        "luggage",
        "luggagetag",
        "dynamicluggagetag",
    }
)


class PasswordPolicyError(ValueError):
    """The candidate password does not meet policy."""


def build_hasher(*, time_cost: int, memory_cost: int, parallelism: int) -> PasswordHasher:
    return PasswordHasher(
        time_cost=time_cost,
        memory_cost=memory_cost,
        parallelism=parallelism,
        hash_len=32,
        salt_len=16,
        type=Type.ID,
    )


def normalize(password: str) -> str:
    """NFKC so a password typed on a different keyboard still matches."""
    return unicodedata.normalize("NFKC", password)


def check_password_policy(password: str, *, min_length: int, context: tuple[str, ...] = ()) -> None:
    """Raises PasswordPolicyError if the password is unacceptable.

    Length is the dominant factor, so there is no character-class requirement:
    those push people toward `Passw0rd!` and buy very little. What is rejected
    is short, repetitive, sequential, obvious, or derived from the user's own
    email address.
    """
    password = normalize(password)

    if len(password) < min_length:
        raise PasswordPolicyError(f"Use at least {min_length} characters.")
    if len(password) > 1024:
        raise PasswordPolicyError("Passwords are limited to 1024 characters.")

    lowered = password.casefold()
    stripped = "".join(ch for ch in lowered if ch.isalnum())

    if _is_obvious(stripped, lowered):
        raise PasswordPolicyError("That password is among the most commonly used ones.")
    if len(set(password)) < 5:
        raise PasswordPolicyError("Use a wider mix of characters.")
    if _is_sequential(lowered):
        raise PasswordPolicyError("Avoid sequences like 'abcdefgh' or '12345678'.")

    for item in context:
        item = item.casefold().strip()
        if len(item) >= 4 and item in lowered:
            raise PasswordPolicyError("Your password cannot contain your email address or name.")
        local = item.partition("@")[0]
        if len(local) >= 4 and local in lowered:
            raise PasswordPolicyError("Your password cannot contain your email address or name.")


def _is_obvious(stripped: str, lowered: str) -> bool:
    """Catches a common password, and a common password with padding.

    `password1234` and `!!letmein!!` are not meaningfully stronger than the
    words inside them, so an exact-match blocklist alone lets most of the
    interesting cases straight through. Anything whose recognisable core is a
    blocklisted word — or that a blocklisted word makes up half of — is out.
    """
    if stripped in _OBVIOUS:
        return True
    if stripped.strip("0123456789") in _OBVIOUS:
        return True
    return any(
        len(word) >= 5 and word in lowered and len(word) * 2 >= len(stripped) for word in _OBVIOUS
    )


def _is_sequential(value: str) -> bool:
    """True when most of the string is one ascending or descending run."""
    if len(value) < 6:
        return False
    deltas = {ord(b) - ord(a) for a, b in zip(value, value[1:], strict=False)}
    return deltas in ({1}, {-1})


def hash_password(hasher: PasswordHasher, password: str) -> str:
    return hasher.hash(normalize(password))


def verify_password(hasher: PasswordHasher, stored_hash: str, password: str) -> bool:
    try:
        hasher.verify(stored_hash, normalize(password))
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False
    return True


def needs_rehash(hasher: PasswordHasher, stored_hash: str) -> bool:
    try:
        return hasher.check_needs_rehash(stored_hash)
    except InvalidHashError:
        return True


_DUMMY_CACHE: dict[tuple[int, int, int], str] = {}


def dummy_verify(hasher: PasswordHasher) -> None:
    """Burns a real Argon2 verification against a throwaway hash.

    Run on the "no such account" path so signing in with an unknown address
    costs the same wall-clock time as signing in with a known one. Without it,
    response timing enumerates which addresses are registered.

    The hash is produced by this same hasher, so it carries the same cost
    parameters as a genuine one; a hand-written constant would be rejected as
    malformed in microseconds and leak exactly the timing it is meant to hide.
    """
    params = (hasher.time_cost, hasher.memory_cost, hasher.parallelism)
    stored = _DUMMY_CACHE.get(params)
    if stored is None:
        stored = _DUMMY_CACHE.setdefault(params, hasher.hash(secrets.token_urlsafe(32)))
    with contextlib.suppress(VerifyMismatchError, VerificationError, InvalidHashError):
        hasher.verify(stored, "not-the-password")


def warm_dummy_hash(hasher: PasswordHasher) -> None:
    """Primes the dummy hash at startup so the first failed login is not slower."""
    dummy_verify(hasher)
