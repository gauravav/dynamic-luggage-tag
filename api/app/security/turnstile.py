"""Cloudflare Turnstile: proof that a request came from a real browser.

Rate limits slow an attacker down; they do not tell a person from a script.
Turnstile does, without making anyone pick out traffic lights: the widget runs
checks in the browser and hands the page a single-use token, and the API asks
Cloudflare whether that token is genuine before doing anything expensive or
abusable.

Where it is required, and where it deliberately is not
-------------------------------------------------------
Required on the unauthenticated actions bots actually target: creating an
account, signing in, asking for a password reset or another confirmation link,
and sending a message to a bag's owner.

Not required to *view* a scan page, record the scan, or share a city. Those
are the only things a finder does before deciding to engage, they carry no
free text for a spammer to abuse, and gating them would hand every stranger
who scans a bag to a third party before they have chosen to do anything.

Privacy
-------
The client IP is not forwarded to Cloudflare in the verification call
(``remoteip`` is optional). Cloudflare already saw the browser when it served
the widget; there is no reason for this server to confirm the address too.

Failure policy
--------------
If Cloudflare cannot be reached, verification fails and the request is refused
with a "try again" message. The protected actions are exactly the ones an
attacker would want to push through during an outage, and none of them is
urgent enough to justify an unguarded window.
"""

from __future__ import annotations

import functools
import json
import logging
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Callable

from flask import request

from ..config import Config
from ..errors import ApiError

log = logging.getLogger(__name__)

HEADER = "X-Turnstile-Token"
# Cloudflare tokens are at most 2048 characters; anything longer is not one.
MAX_TOKEN_LENGTH = 2048


class TurnstileUnavailable(Exception):
    """Cloudflare could not be reached, or answered with something unusable."""


def verify(token: str, *, action: str, config: Config) -> bool:
    """Asks Cloudflare whether a token is genuine, unused, and for this action.

    The action check matters: a token solved on the sign-in page must not be
    replayable against registration. Cloudflare records the action the widget
    was rendered with, and it has to match the endpoint being called.
    """
    if not token or len(token) > MAX_TOKEN_LENGTH:
        return False

    body = urllib.parse.urlencode(
        {"secret": config.turnstile_secret_key, "response": token}
    ).encode()
    outgoing = urllib.request.Request(  # noqa: S310 - URL comes from trusted config
        config.turnstile_verify_url,
        data=body,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(  # noqa: S310 - URL comes from trusted config
            outgoing, timeout=config.turnstile_timeout_seconds
        ) as response:
            result = json.loads(response.read())
    except (urllib.error.URLError, TimeoutError, ValueError) as exc:
        raise TurnstileUnavailable(str(exc)) from exc

    if not result.get("success"):
        # Error codes name the failure (expired, duplicate, invalid secret)
        # without any client data, so they are safe and useful to log.
        log.info("Turnstile rejected a token: %s", result.get("error-codes"))
        return False
    if (result.get("metadata") or {}).get("result_with_testing_key") and "action" not in result:
        # Cloudflare's published test keys answer without an action at all.
        # Accepting that only when Cloudflare itself flags the result as a
        # test-key result keeps setup with test keys working, while a real
        # key — which always reports the action — is still held to it.
        log.warning("Turnstile is using Cloudflare test keys; every token passes")
        return True
    if result.get("action") != action:
        log.warning("Turnstile token for action %r presented to %r", result.get("action"), action)
        return False
    return True


def require(action: str) -> Callable:
    """Refuses the request unless it carries a valid token for ``action``.

    A no-op when Turnstile is not configured, so self-hosted deployments and
    local development work without a Cloudflare account.
    """

    def decorator(view: Callable) -> Callable:
        @functools.wraps(view)
        def wrapper(*args, **kwargs):
            from ..extensions import app_config

            config = app_config()
            if not config.turnstile_enabled:
                return view(*args, **kwargs)

            token = request.headers.get(HEADER, "")
            try:
                ok = verify(token, action=action, config=config)
            except TurnstileUnavailable:
                log.exception("Turnstile verification unavailable")
                raise ApiError(
                    "verification_unavailable",
                    "We couldn't confirm you're not a bot just now. Please try again.",
                    status=503,
                ) from None
            if not ok:
                raise ApiError(
                    "verification_failed",
                    "Please complete the verification check and try again.",
                    status=403,
                )
            return view(*args, **kwargs)

        return wrapper

    return decorator
