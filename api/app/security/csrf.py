"""CSRF protection for cookie-authenticated requests.

Three independent checks, because each has a known failure mode:

1. SameSite=Strict on the session cookie — the browser does not attach it to
   cross-site requests at all. Strong, but only as good as the browser.
2. Origin header check — rejects a cross-origin request even if a cookie did
   arrive. Fails open on clients that omit Origin, which is why it is not alone.
3. Double-submit token — the request must echo a value that only a same-origin
   script could have read. Independent of the two above.

Public endpoints (a scan page, a finder's message) carry no ambient
credentials, so there is nothing for a cross-site request to abuse; they are
exempt and rate-limited instead.
"""

from __future__ import annotations

from urllib.parse import urlsplit

from flask import Request

from ..config import Config
from ..models import Session
from .crypto import constant_time_equals
from .sessions import CSRF_HEADER

SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS", "TRACE"})


class CsrfError(Exception):
    """The request failed a cross-site request forgery check."""


def _same_origin(candidate: str, allowed: set[str]) -> bool:
    try:
        parts = urlsplit(candidate)
    except ValueError:
        return False
    if not parts.scheme or not parts.netloc:
        return False
    return f"{parts.scheme}://{parts.netloc}".rstrip("/") in allowed


def verify(request: Request, session: Session | None, *, config: Config) -> None:
    if request.method in SAFE_METHODS:
        return
    if session is None:
        # Nothing is authenticated by cookie, so there is no ambient authority
        # to forge against.
        return

    allowed = {
        config.frontend_origin.rstrip("/"),
        config.public_base_url.rstrip("/"),
        request.host_url.rstrip("/"),
    }

    origin = request.headers.get("Origin")
    if origin and origin != "null":
        if not _same_origin(origin, allowed):
            raise CsrfError("Request origin is not allowed.")
    else:
        # No Origin: fall back to Referer, and refuse if neither is present on
        # a state-changing request.
        referer = request.headers.get("Referer")
        if not referer or not _same_origin(referer, allowed):
            raise CsrfError("Request is missing a verifiable origin.")

    presented = request.headers.get(CSRF_HEADER, "")
    if not presented or not constant_time_equals(
        presented.encode("utf-8"), session.csrf_token.encode("utf-8")
    ):
        raise CsrfError("CSRF token is missing or does not match.")
