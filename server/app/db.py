"""SQLite storage for submitted prompts and agent traces."""

from __future__ import annotations

import json
import sqlite3
from collections.abc import Iterator
from contextlib import closing
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Literal

Table = Literal["scans", "traces"]
MAX_SQLITE_INTEGER = 2**63 - 1


class Database:
    def __init__(self, path: Path) -> None:
        self.path = path

    def initialize(self) -> None:
        with closing(sqlite3.connect(self.path)) as connection:
            for table in ("scans", "traces"):
                connection.execute(
                    f"""
                    CREATE TABLE IF NOT EXISTS {table} (
                        id INTEGER PRIMARY KEY,
                        payload TEXT NOT NULL,
                        score REAL NOT NULL,
                        flagged INTEGER NOT NULL,
                        categories TEXT NOT NULL,
                        created_at TEXT NOT NULL
                    )
                    """
                )

    def insert(
        self, table: Table, submitted: dict[str, Any], result: dict[str, Any]
    ) -> dict[str, Any]:
        created_at = datetime.now(UTC).isoformat(timespec="microseconds")
        payload = json.dumps({"request": submitted, "result": result})
        with closing(sqlite3.connect(self.path)) as connection, connection:
            cursor = connection.execute(
                f"""
                INSERT INTO {table} (payload, score, flagged, categories, created_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                (
                    payload,
                    result["score"],
                    result["flagged"],
                    json.dumps(result["categories"]),
                    created_at,
                ),
            )
            return {"id": cursor.lastrowid, "created_at": created_at, **result}

    def list(self, table: Table, limit: int) -> list[dict[str, Any]]:
        with closing(sqlite3.connect(self.path)) as connection:
            rows = connection.execute(
                f"""
                SELECT id, created_at, payload FROM {table}
                ORDER BY created_at DESC, id DESC LIMIT ?
                """,
                (limit,),
            )
            return [self._result(row) for row in rows]

    def get(self, table: Table, row_id: int) -> dict[str, Any] | None:
        if not 1 <= row_id <= MAX_SQLITE_INTEGER:
            return None
        with closing(sqlite3.connect(self.path)) as connection:
            row = connection.execute(
                f"SELECT id, created_at, payload FROM {table} WHERE id = ?",
                (row_id,),
            ).fetchone()
            return self._result(row) if row is not None else None

    def activity(self) -> Iterator[tuple[Table, float, bool, list[str], str]]:
        with closing(sqlite3.connect(self.path)) as connection:
            rows = connection.execute(
                """
                SELECT 'scans', score, flagged, categories, substr(created_at, 1, 10)
                FROM scans
                UNION ALL
                SELECT 'traces', score, flagged, categories, substr(created_at, 1, 10)
                FROM traces
                """
            )
            for kind, score, flagged, categories, day in rows:
                yield kind, score, bool(flagged), json.loads(categories), day

    @staticmethod
    def _result(row: tuple[int, str, str]) -> dict[str, Any]:
        row_id, created_at, payload = row
        return {"id": row_id, "created_at": created_at, **json.loads(payload)["result"]}
