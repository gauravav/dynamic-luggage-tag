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

# The same policy for the responses a browser is *meant* to open or save: the
# print PDF and the QR symbol.
#
# A bare `sandbox` puts the response in an opaque origin with every sandbox
# flag set, and one of those flags is the one that permits downloads — so
# Chrome refuses to save the PDF at all, and renders neither it nor the SVG.
# `allow-downloads` restores exactly that one capability and nothing else;
# script, forms, plugins and same-origin access all stay denied.
_ASSET_CSP = _API_CSP.replace("sandbox", "sandbox allow-downloads")

# Content types served for the browser to open or save rather than parse.
_ASSET_TYPES = ("application/pdf", "image/svg+xml", "image/png")

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
        content_type = (response.headers.get("Content-Type") or "").split(";")[0].strip()
        policy = _ASSET_CSP if content_type in _ASSET_TYPES else _API_CSP
        response.headers.setdefault("Content-Security-Policy", policy)
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
            response.headers["Access-Control-Allow-Headers"] = (
                "Content-Type, X-CSRF-Token, X-Turnstile-Token"
            )
            response.headers["Access-Control-Allow-Methods"] = "GET, POST, PATCH, DELETE, OPTIONS"
            response.headers["Access-Control-Max-Age"] = "600"
            response.headers["Access-Control-Expose-Headers"] = "X-Request-Id"
        # The response varies by Origin even when no header is added; without
        # this a cache could serve an allowed response to a different origin.
        response.headers.add("Vary", "Origin")
        return response
