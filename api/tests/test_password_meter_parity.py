"""The sign-up password meter must agree with the server's password policy.

`web/src/lib/passwordStrength.ts` ports `check_password_policy()`. If the two
drift, the meter can show a password as acceptable — even "strong" — that the
server then rejects. This runs both over the same candidates and compares the
outcome and the message for every one.
"""

from __future__ import annotations

import json
import random
import shutil
import string
import subprocess
from pathlib import Path

import pytest

from app.security.passwords import _OBVIOUS, PasswordPolicyError, check_password_policy

SCRIPT = Path(__file__).resolve().parents[2] / "web" / "scripts" / "password-parity.mjs"
NODE = shutil.which("node")


def _node_can_strip_types() -> bool:
    if NODE is None:
        return False
    probe = subprocess.run(  # noqa: S603 - fixed arguments, no external input
        [NODE, "-p", "Boolean(process.features.typescript)"],
        capture_output=True,
        text=True,
        check=False,
    )
    return probe.stdout.strip() == "true"


pytestmark = pytest.mark.skipif(
    not _node_can_strip_types(), reason="needs Node 22.6+ to run the TypeScript port directly"
)

CONTEXT = ["rosa.fernandez@example.com", "Rosa Fernandez"]


def _candidates() -> list[str]:
    rng = random.Random(20260917)  # fixed seed: the same cases every run
    out: list[str] = [
        "",
        "short",
        "exactly12chr",
        "elevenchars",
        "correct horse battery staple",
        "abcdefghijkl",
        "zyxwvutsrqpo",
        "123456789012",
        "aaaaaaaaaaaaaaaa",
        "abababababababab",
        "rosa-fernandez-2026",
        "fernandez-rules-ok",
        "Rosa Fernandez!!!",
        "ROSA.FERNANDEZ@EXAMPLE.COM",
        "my-rosa.fernandez-key",  # the email's local part alone, not the address
        "Straße-Fährt-Überall",
        "ｆｕｌｌｗｉｄｔｈｐａｓｓ",  # NFKC folds these to ASCII
        "日本語のパスワードです長い",
        "emoji🔐🔐🔐🔐🔐🔐🔐🔐x",
        "   spaced   out   ",
        "x" * 1025,
        # Cases that only come out right if normalisation happens first.
        "ｐａｓｓｗｏｒｄ１２３４",  # full-width: banned only once NFKC folds it
        "ﬃﬃﬃﬃabcd",  # 8 code points raw, 16 after NFKC: flips the length rule
        "ﬁﬂﬁﬂﬁﬂﬁﬂﬁﬂ",  # ligatures expand to a 4-letter alphabet
        # Cases that only come out right if code points are counted, not
        # UTF-16 units: 4 distinct code points, but 5 distinct UTF-16 units.
        "ab🔐c🔐🔐🔐🔐🔐🔐🔐🔐",
        "🔐🔐🔐🔐🔐🔐🔐🔐🔐🔐🔐x",  # 12 code points, 23 UTF-16 units
        "abcd🔐🔐🔐🔐🔐",  # 9 code points but 14 UTF-16 units: too short
    ]
    for word in sorted(_OBVIOUS):
        out += [word, f"{word}1234", f"!!{word}!!", f"{word}{word}", f"My{word.title()}Is-Long-99"]
        # Digit padding long enough that only the strip-the-digits rule
        # catches it; the "word is half the password" rule no longer does.
        out.append(word + "4097153862" * 2)
    alphabets = [
        string.ascii_lowercase,
        string.ascii_letters + string.digits,
        string.ascii_letters + string.digits + string.punctuation + " ",
        "abcde",
        "0123456789",
    ]
    for _ in range(3000):
        alphabet = rng.choice(alphabets)
        out.append("".join(rng.choice(alphabet) for _ in range(rng.randint(8, 24))))
    return out


def _python(password: str, context: list[str]) -> str | None:
    try:
        check_password_policy(password, min_length=12, context=tuple(context))
    except PasswordPolicyError as exc:
        return str(exc)
    return None


def test_meter_policy_matches_server_policy():
    cases = [
        {"password": password, "context": context}
        for password in _candidates()
        for context in ([], CONTEXT)
    ]
    result = subprocess.run(  # noqa: S603 - fixed arguments; cases go via stdin
        [NODE, str(SCRIPT)],
        input=json.dumps({"cases": cases}),
        capture_output=True,
        text=True,
        check=False,
        timeout=60,
    )
    assert result.returncode == 0, result.stderr
    typescript = json.loads(result.stdout)

    mismatches = [
        (
            case["password"][:40],
            bool(case["context"]),
            _python(case["password"], case["context"]),
            ts,
        )
        for case, ts in zip(cases, typescript, strict=True)
        if _python(case["password"], case["context"]) != ts
    ]
    assert not mismatches, f"{len(mismatches)} of {len(cases)} disagree, e.g. {mismatches[:5]}"
