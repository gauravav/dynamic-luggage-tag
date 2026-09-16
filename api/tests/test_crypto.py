"""Envelope encryption, blind indexes and token hashing."""

from __future__ import annotations

import os

import pytest

from app.security import crypto


def test_roundtrip_preserves_value():
    key = crypto.new_key()
    aad = crypto.field_aad("users", "name", "row-1")
    sealed = crypto.encrypt_field(key, "Rosa Fernández", aad)
    assert crypto.decrypt_field(key, sealed, aad) == "Rosa Fernández"


def test_ciphertext_is_not_the_plaintext():
    key = crypto.new_key()
    sealed = crypto.encrypt_field(key, "555-0100", crypto.field_aad("users", "phone", "r"))
    assert b"555-0100" not in sealed


def test_same_plaintext_encrypts_differently_each_time():
    """A fresh nonce per encryption, so equal values are not visibly equal."""
    key = crypto.new_key()
    aad = crypto.field_aad("users", "name", "row-1")
    first = crypto.encrypt_field(key, "Ana", aad)
    second = crypto.encrypt_field(key, "Ana", aad)
    assert first != second


def test_ciphertext_cannot_be_moved_to_another_row():
    """The AAD pins a ciphertext to one row, defeating a copy-paste attack."""
    key = crypto.new_key()
    victim = crypto.encrypt_field(key, "555-0100", crypto.field_aad("users", "phone", "victim"))
    with pytest.raises(crypto.DecryptionError):
        crypto.decrypt_field(key, victim, crypto.field_aad("users", "phone", "attacker"))


def test_ciphertext_cannot_be_moved_to_another_column():
    key = crypto.new_key()
    sealed = crypto.encrypt_field(key, "secret", crypto.field_aad("users", "phone", "r"))
    with pytest.raises(crypto.DecryptionError):
        crypto.decrypt_field(key, sealed, crypto.field_aad("users", "address", "r"))


def test_tampering_is_detected():
    key = crypto.new_key()
    aad = crypto.field_aad("users", "name", "r")
    sealed = bytearray(crypto.encrypt_field(key, "Ana", aad))
    sealed[-1] ^= 0x01
    with pytest.raises(crypto.DecryptionError):
        crypto.decrypt_field(key, bytes(sealed), aad)


def test_wrong_key_cannot_decrypt():
    aad = crypto.field_aad("users", "name", "r")
    sealed = crypto.encrypt_field(crypto.new_key(), "Ana", aad)
    with pytest.raises(crypto.DecryptionError):
        crypto.decrypt_field(crypto.new_key(), sealed, aad)


def test_none_stays_none():
    key = crypto.new_key()
    aad = crypto.field_aad("users", "phone", "r")
    assert crypto.encrypt_field(key, None, aad) is None
    assert crypto.decrypt_field(key, None, aad) is None


class TestKeyring:
    def test_wrap_and_unwrap(self):
        ring = crypto.Keyring({1: crypto.new_key()}, 1)
        dek = crypto.new_key()
        wrapped, version = ring.wrap(dek, owner_id="user-1")
        assert version == 1
        assert ring.unwrap(wrapped, version, owner_id="user-1") == dek

    def test_wrapped_key_is_bound_to_its_owner(self):
        ring = crypto.Keyring({1: crypto.new_key()}, 1)
        wrapped, version = ring.wrap(crypto.new_key(), owner_id="user-1")
        with pytest.raises(crypto.DecryptionError):
            ring.unwrap(wrapped, version, owner_id="user-2")

    def test_rotation_keeps_old_rows_readable(self):
        """After rotating, v1 rows still open and new wraps use v2."""
        old, new = crypto.new_key(), crypto.new_key()
        dek = crypto.new_key()

        v1_ring = crypto.Keyring({1: old}, 1)
        wrapped, version = v1_ring.wrap(dek, owner_id="u")

        v2_ring = crypto.Keyring({1: old, 2: new}, 2)
        assert v2_ring.unwrap(wrapped, version, owner_id="u") == dek

        rewrapped, new_version = v2_ring.rewrap(wrapped, version, owner_id="u")
        assert new_version == 2
        assert v2_ring.unwrap(rewrapped, new_version, owner_id="u") == dek

    def test_missing_key_version_is_reported_clearly(self):
        ring = crypto.Keyring({2: crypto.new_key()}, 2)
        with pytest.raises(crypto.DecryptionError, match="DLT_KEK_V1"):
            ring.unwrap(b"\x01" + os.urandom(40), 1, owner_id="u")

    def test_active_version_must_be_present(self):
        with pytest.raises(crypto.CryptoError):
            crypto.Keyring({1: crypto.new_key()}, 7)


class TestBlindIndex:
    def test_is_deterministic(self):
        key = crypto.new_key()
        first = crypto.blind_index(key, "user.email", "ana@example.com")
        second = crypto.blind_index(key, "user.email", "ana@example.com")
        assert first == second

    def test_differs_per_namespace(self):
        key = crypto.new_key()
        assert crypto.blind_index(key, "user.email", "a@b.c") != crypto.blind_index(
            key, "other.email", "a@b.c"
        )

    def test_differs_per_key(self):
        assert crypto.blind_index(crypto.new_key(), "n", "v") != crypto.blind_index(
            crypto.new_key(), "n", "v"
        )

    def test_does_not_contain_the_value(self):
        index = crypto.blind_index(crypto.new_key(), "user.email", "ana@example.com")
        assert b"ana" not in index


class TestNormalizeEmail:
    @pytest.mark.parametrize(
        ("raw", "expected"),
        [
            ("Ana@Example.COM", "ana@example.com"),
            ("  ana@example.com  ", "ana@example.com"),
            ("ANA@example.com", "ana@example.com"),
        ],
    )
    def test_case_and_whitespace(self, raw, expected):
        assert crypto.normalize_email(raw) == expected

    def test_plus_tags_are_kept_distinct(self):
        """Some providers treat these as different mailboxes; do not merge them."""
        assert crypto.normalize_email("ana+travel@example.com") != crypto.normalize_email(
            "ana@example.com"
        )


class TestTokens:
    def test_hash_is_deterministic_and_namespaced(self):
        pepper = crypto.new_key()
        token = crypto.new_token()
        assert crypto.hash_token(pepper, "tag", token) == crypto.hash_token(pepper, "tag", token)
        assert crypto.hash_token(pepper, "tag", token) != crypto.hash_token(pepper, "relay", token)

    def test_tokens_are_unique_and_long(self):
        tokens = {crypto.new_token(32) for _ in range(200)}
        assert len(tokens) == 200
        assert all(len(token) >= 40 for token in tokens)
