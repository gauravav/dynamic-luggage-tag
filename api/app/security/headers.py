"""Response hardening applied to every API response."""

from __future__ import annotations

import secrets

from flask import Flask, Response, g, request

from ..config import Config

# The API returns JSON, images and PDFs — never HTML that runs script. The
# policy therefore denies essentially everything; it is a backstop in case a
# response is ever rendered in a browser context.
_API_CSP = (
    "default-src 'none'; "
    "img-src 'self' data:; "
    "style-src 'none'; "
    "script-src 'none'; "
    "frame-ancestors 'none'; "
    "form-action 'none'; "
    "base-uri 'none'; "
    "sandbox"
)

_PERMISSIONS_POLICY = (
    "accelerometer=(), autoplay=(), camera=(), display-capture=(), "
    "encrypted-media=(), fullscreen=(), geolocation=(), gyroscope=(), "
    "magnetometer=(), microphone=(), midi=(), payment=(), usb=(), "
    "interest-cohort=(), browsing-topics=()"
)


def register_security_headers(app: Flask, config: Config) -> None:
    @app.before_request
    def _assign_request_id() -> None:
        # Correlates a log line and an audit row without identifying anyone.
        g.request_id = secrets.token_hex(8)

    @app.after_request
    def _apply(response: Response) -> Response:
        response.headers.setdefault("Content-Security-Policy", _API_CSP)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault("Referrer-Policy", "no-referrer")
        response.headers.setdefault("Permissions-Policy", _PERMISSIONS_POLICY)
        response.headers.setdefault("Cross-Origin-Opener-Policy", "same-origin")
        response.headers.setdefault("Cross-Origin-Resource-Policy", "same-site")
        response.headers.setdefault("X-Request-Id", g.get("request_id", ""))

        # Responses are per-user and often carry decrypted personal data;
        # nothing here may be held by a shared cache.
        response.headers.setdefault("Cache-Control", "no-store, private")
        response.headers.setdefault("Pragma", "no-cache")

        if config.cookie_secure:
            response.headers.setdefault(
                "Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload"
            )

        # Server fingerprints tell an attacker which CVE list to work from.
        response.headers.pop("Server", None)
        response.headers["Server"] = "dlt"
        return response


def register_cors(app: Flask, config: Config) -> None:
    """A single-origin CORS policy with credentials.

    There is no wildcard and no reflected-origin fallback: an unlisted origin
    simply gets no CORS headers, so the browser blocks the read.
    """
    allowed = {config.frontend_origin.rstrip("/")}

    @app.after_request
    def _cors(response: Response) -> Response:
        origin = request.headers.get("Origin")
        if origin and origin.rstrip("/") in allowed:
            response.headers["Access-Control-Allow-Origin"] = origin
            response.headers["Access-Control-Allow-Credentials"] = "true"
            response.headers["Access-Control-Allow-Headers"] = "Content-Type, X-CSRF-Token"
            response.headers["Access-Control-Allow-Methods"] = "GET, POST, PATCH, DELETE, OPTIONS"
            response.headers["Access-Control-Max-Age"] = "600"
            response.headers["Access-Control-Expose-Headers"] = "X-Request-Id"
        # The response varies by Origin even when no header is added; without
        # this a cache could serve an allowed response to a different origin.
        response.headers.add("Vary", "Origin")
        return response
