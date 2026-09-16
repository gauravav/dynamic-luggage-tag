"""Uniform error responses.

Two rules shape this module:

* Clients get a stable machine-readable `code` and a short sentence. They never
  get a stack trace, a SQL fragment, or a driver message — those tell an
  attacker how the system is built.
* Messages avoid confirming facts the caller was not entitled to. "No such
  tag" is returned both when a tag does not exist and when it belongs to
  someone else, because distinguishing the two enumerates other people's ids.
"""

from __future__ import annotations

import logging
from typing import Any

from flask import Flask, g, jsonify
from werkzeug.exceptions import HTTPException

log = logging.getLogger(__name__)


class ApiError(Exception):
    """An error that is safe to describe to the caller."""

    def __init__(
        self,
        code: str,
        message: str,
        *,
        status: int = 400,
        fields: dict[str, str] | None = None,
        headers: dict[str, str] | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status
        self.fields = fields or {}
        self.headers = headers or {}

    def payload(self) -> dict[str, Any]:
        body: dict[str, Any] = {"error": {"code": self.code, "message": self.message}}
        if self.fields:
            body["error"]["fields"] = self.fields
        return body


def register_error_handlers(app: Flask) -> None:
    @app.errorhandler(ApiError)
    def _api_error(exc: ApiError):
        response = jsonify(exc.payload())
        response.status_code = exc.status
        for key, value in exc.headers.items():
            response.headers[key] = value
        return response

    @app.errorhandler(HTTPException)
    def _http_error(exc: HTTPException):
        response = jsonify(
            {
                "error": {
                    "code": _CODES.get(exc.code, "http_error"),
                    "message": _SAFE_MESSAGES.get(exc.code, "The request could not be completed."),
                }
            }
        )
        response.status_code = exc.code or 500
        # Preserve Retry-After and Allow, which clients act on.
        for header in ("Retry-After", "Allow"):
            if exc.get_response().headers.get(header):
                response.headers[header] = exc.get_response().headers[header]
        return response

    @app.errorhandler(Exception)
    def _unexpected(exc: Exception):
        # Logged in full server-side, described generically to the caller. The
        # request id is the bridge between the two.
        request_id = g.get("request_id", "-")
        log.exception("Unhandled error (request_id=%s)", request_id)
        response = jsonify(
            {
                "error": {
                    "code": "internal_error",
                    "message": "Something went wrong. Please try again.",
                    "request_id": request_id,
                }
            }
        )
        response.status_code = 500
        return response


_CODES = {
    400: "bad_request",
    401: "unauthenticated",
    403: "forbidden",
    404: "not_found",
    405: "method_not_allowed",
    409: "conflict",
    413: "payload_too_large",
    415: "unsupported_media_type",
    429: "rate_limited",
}

_SAFE_MESSAGES = {
    400: "The request could not be understood.",
    401: "Sign in to continue.",
    403: "You do not have access to that.",
    404: "Not found.",
    405: "That method is not allowed here.",
    409: "That conflicts with the current state.",
    413: "The request body is too large.",
    415: "Send the request as JSON.",
    429: "Too many requests. Please slow down.",
}
