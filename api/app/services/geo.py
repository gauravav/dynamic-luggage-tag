"""Coarse location for a scan.

Only ever city, region and country. There is no street, no coordinate pair and
no precise geolocation API call: the owner needs to know their bag reached
Dallas, and nothing finer than that serves them while a finer answer would
track the stranger holding the bag.

Providers:

* ``null``   — never resolves anything. The default, and the right choice for
  a self-hoster who has not thought about this yet.
* ``header`` — reads city headers a CDN already computed (Cloudflare and
  similar). Nothing is sent anywhere; the edge did the lookup.

The finder must opt in before any of this is stored, whatever the provider.
"""

from __future__ import annotations

import re
from abc import ABC, abstractmethod
from dataclasses import dataclass

from flask import Request

from ..config import Config

# Place names only: letters, marks, spaces and a few separators. Anything else
# is a header an upstream proxy let through unsanitised.
_PLACE = re.compile(r"^[\w\s.'’-]{1,64}$", re.UNICODE)
_COUNTRY = re.compile(r"^[A-Za-z]{2}$")


@dataclass(frozen=True)
class CoarseLocation:
    city: str | None = None
    region: str | None = None
    country: str | None = None

    def is_empty(self) -> bool:
        return not any((self.city, self.region, self.country))

    def label(self) -> str:
        parts = [part for part in (self.city, self.region or self.country) if part]
        return ", ".join(parts) if parts else "Unknown location"

    def to_dict(self) -> dict[str, str | None]:
        return {"city": self.city, "region": self.region, "country": self.country}


class GeoProvider(ABC):
    @abstractmethod
    def resolve(self, request: Request) -> CoarseLocation: ...


class NullGeoProvider(GeoProvider):
    def resolve(self, request: Request) -> CoarseLocation:  # noqa: ARG002
        return CoarseLocation()


class HeaderGeoProvider(GeoProvider):
    """Trusts city headers set by an edge proxy in front of the API.

    Only safe when something upstream strips these headers from client
    requests; otherwise any scanner can claim to be anywhere. That is a
    deployment contract, restated in docs/self-hosting.md.
    """

    def __init__(self, config: Config) -> None:
        self._headers = config.geo_headers

    def resolve(self, request: Request) -> CoarseLocation:
        return CoarseLocation(
            city=_clean(request.headers.get(self._headers["city"]), _PLACE),
            region=_clean(request.headers.get(self._headers["region"]), _PLACE),
            country=_clean(request.headers.get(self._headers["country"]), _COUNTRY),
        )


def _clean(value: str | None, pattern: re.Pattern[str]) -> str | None:
    if not value:
        return None
    value = value.strip()
    if not pattern.match(value):
        return None
    return value.upper() if pattern is _COUNTRY else value


def build_geo_provider(config: Config) -> GeoProvider:
    if config.geo_provider == "header":
        return HeaderGeoProvider(config)
    if config.geo_provider == "null":
        return NullGeoProvider()
    raise ValueError(f"Unknown DLT_GEO_PROVIDER: {config.geo_provider}")


def sanitize_declared(city: str | None, region: str | None, country: str | None) -> CoarseLocation:
    """Validates a location the finder typed in themselves."""
    return CoarseLocation(
        city=_clean(city, _PLACE),
        region=_clean(region, _PLACE),
        country=_clean(country, _COUNTRY),
    )
