import json
import sqlite3
from collections.abc import Iterator
from contextlib import closing
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient


@pytest.fixture(scope="session")
def database_path(tmp_path_factory: pytest.TempPathFactory) -> Iterator[Path]:
    path = tmp_path_factory.mktemp("trustlens") / "tests.sqlite3"
    with pytest.MonkeyPatch.context() as env:
        env.setenv("TRUSTLENS_DB", str(path))
        yield path


@pytest.fixture
def client(database_path: Path) -> Iterator[TestClient]:
    from app.main import app

    with TestClient(app) as test_client:
        yield test_client

    # Keep one temporary database for the session with empty histories per test.
    with closing(sqlite3.connect(database_path)) as connection, connection:
        connection.execute("DELETE FROM scans")
        connection.execute("DELETE FROM traces")


@pytest.fixture(scope="session")
def trace_cases() -> dict[str, dict[str, Any]]:
    path = Path(__file__).resolve().parents[2] / "demo" / "traces.json"
    rows = json.loads(path.read_text(encoding="utf-8"))
    return {
        row["trace_id"]: {"trace_id": row["trace_id"], "steps": row["steps"]}
        for row in rows
    }
