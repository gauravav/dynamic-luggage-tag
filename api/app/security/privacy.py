"""Turning request metadata into the least identifying thing that still works.

Two problems this solves:

* Rate limiting and scan deduplication need to recognise "the same client
  again", but storing IP addresses would turn the scan log into a location
  history of whoever handled the bag.
* The sessions screen needs to say "Safari on iPhone", which does not require
  keeping a full user-agent string — a famously good fingerprinting surface.

So: IPs become a keyed hash salted with the UTC date, which correlates for
about a day and is inert after that. User agents become one of a fixed set of
labels, and anything unrecognised becomes "Unknown".
"""

from __future__ import annotations

import datetime as dt
import hashlib
import hmac
import ipaddress
import re

from flask import Request

_UA_RULES: tuple[tuple[re.Pattern[str], str], ...] = (
    (re.compile(r"iphone|ipad|ipod", re.I), "iOS"),
    (re.compile(r"android", re.I), "Android"),
    (re.compile(r"macintosh|mac os x", re.I), "macOS"),
    (re.compile(r"windows", re.I), "Windows"),
    (re.compile(r"cros", re.I), "ChromeOS"),
    (re.compile(r"linux", re.I), "Linux"),
)
_BROWSER_RULES: tuple[tuple[re.Pattern[str], str], ...] = (
    (re.compile(r"edg/", re.I), "Edge"),
    (re.compile(r"opr/|opera", re.I), "Opera"),
    (re.compile(r"firefox/", re.I), "Firefox"),
    (re.compile(r"chrome/|crios/", re.I), "Chrome"),
    (re.compile(r"safari/", re.I), "Safari"),
)


def client_ip(request: Request, *, trusted_proxy_hops: int) -> str | None:
    """The client address, trusting exactly `trusted_proxy_hops` proxies.

    Counting from the right is what makes this safe: a client can prepend any
    number of fake entries to X-Forwarded-For, but it cannot remove the ones
    appended by proxies we actually run. With zero trusted hops the header is
    ignored entirely, which is the correct default for a directly exposed app.
    """
    if trusted_proxy_hops > 0:
        forwarded = request.headers.get("X-Forwarded-For", "")
        chain = [part.strip() for part in forwarded.split(",") if part.strip()]
        if len(chain) >= trusted_proxy_hops:
            candidate = chain[-trusted_proxy_hops]
            if _is_ip(candidate):
                return candidate
    return request.remote_addr


def _is_ip(value: str) -> bool:
    try:
        ipaddress.ip_address(value)
    except ValueError:
        return False
    return True


def _truncate_ip(value: str) -> str:
    """Drops host bits before hashing: /24 for IPv4, /48 for IPv6.

    Hashing alone would still allow a dictionary attack over the whole IPv4
    space. Truncating first means even a recovered preimage names a subnet
    rather than a household, while staying stable enough to correlate a repeat
    scan from the same place.
    """
    try:
        addr = ipaddress.ip_address(value)
    except ValueError:
        return value
    if isinstance(addr, ipaddress.IPv4Address):
        return str(ipaddress.ip_network(f"{addr}/24", strict=False).network_address)
    return str(ipaddress.ip_network(f"{addr}/48", strict=False).network_address)


def hash_ip(pepper: bytes, ip: str | None, *, day: dt.date | None = None) -> bytes | None:
    """Keyed, day-salted hash of a truncated client address.

    The salt rolls at UTC midnight, so yesterday's hashes cannot be matched
    against today's — the value stops being a correlation handle on its own.
    """
    if not ip:
        return None
    day = day or dt.datetime.now(dt.UTC).date()
    message = f"ip\x00{day.isoformat()}\x00{_truncate_ip(ip)}".encode()
    return hmac.new(pepper, message, hashlib.sha256).digest()


def client_label(user_agent: str | None) -> str:
    """A coarse 'Safari on iOS' label. Never stores the raw user agent."""
    if not user_agent:
        return "Unknown"
    platform = next((label for pattern, label in _UA_RULES if pattern.search(user_agent)), None)
    browser = next((label for pattern, label in _BROWSER_RULES if pattern.search(user_agent)), None)
    if browser and platform:
        return f"{browser} on {platform}"
    return browser or platform or "Unknown"
