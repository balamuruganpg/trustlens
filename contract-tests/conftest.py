"""Skip TrustLens contract tests when the API process is not reachable.

The suite is black-box and talks only to a running server. A refused
connection, a DNS failure, or a timeout is a skip. Any HTTP status means
the process answered, so the tests run and a contract miss stays a failure.
"""

from __future__ import annotations

import http.client
import os
import urllib.error
import urllib.request

import pytest

DEFAULT_BASE_URL = "http://localhost:8000"
_PROBE_TIMEOUT_SECONDS = 3


def pytest_configure(config: pytest.Config) -> None:
    config.addinivalue_line(
        "markers",
        "requires_server: needs a running TrustLens API; "
        "skipped when TRUSTLENS_BASE_URL is unreachable",
    )


def resolve_base_url() -> str:
    """Origin only, with no ``/api`` suffix and no trailing slash."""
    raw = os.environ.get("TRUSTLENS_BASE_URL", "").strip()
    return (raw or DEFAULT_BASE_URL).rstrip("/")


def _probe(base_url: str) -> str | None:
    """Return an error string when no HTTP response arrives."""
    request = urllib.request.Request(
        base_url + "/api/health",
        method="GET",
        headers={"Accept": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=_PROBE_TIMEOUT_SECONDS) as response:
            response.read()
    except urllib.error.HTTPError:
        return None
    except (urllib.error.URLError, TimeoutError, OSError, ValueError, http.client.InvalidURL) as exc:
        return str(exc)
    return None


class _Target:
    def __init__(self, base_url: str, error: str | None) -> None:
        self.base_url = base_url
        self.error = error


@pytest.fixture(scope="session")
def _trustlens_target() -> _Target:
    base_url = resolve_base_url()
    return _Target(base_url, _probe(base_url))


@pytest.fixture(autouse=True)
def base_url(_trustlens_target: _Target) -> str:
    """Base origin for one test. Skips when the probe could not connect."""
    if _trustlens_target.error is not None:
        pytest.skip(
            "TrustLens server is unreachable at "
            f"{_trustlens_target.base_url} ({_trustlens_target.error}). "
            "These contract tests need a running API. From server/, start "
            "`uvicorn app.main:app`. If it is not on http://localhost:8000, "
            "set TRUSTLENS_BASE_URL to the origin with no /api suffix. "
            "This test is skipped, not failed."
        )
    return _trustlens_target.base_url
