"""SQLite storage for submitted prompts and agent traces."""

from __future__ import annotations

import json
import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Literal

Table = Literal["scans", "traces"]
MAX_SQLITE_INTEGER = 2**63 - 1
# Wait this long for a writer to finish, then fail the request as JSON.
# WAL keeps readers off that wait in the common case.
BUSY_TIMEOUT_SECONDS = 5.0
BUSY_TIMEOUT_MS = int(BUSY_TIMEOUT_SECONDS * 1000)
CASE_KIND = "case"
CLAUSE_KIND = "clause"


class DatabaseBusy(Exception):
    """Another connection held the write lock past the busy timeout."""


class DatabaseFailure(Exception):
    """SQLite failed for a reason other than lock contention."""


class ParentScanNotFound(Exception):
    """parent_id does not match a stored scan."""


class ClauseParentRejected(Exception):
    """parent_id refers to a clause scan, which cannot own further clauses."""


def _translate(exc: sqlite3.OperationalError) -> Exception:
    message = str(exc).lower()
    if "locked" in message or "busy" in message:
        return DatabaseBusy("Database is locked")
    return DatabaseFailure("Database error")


class Database:
    def __init__(self, path: Path) -> None:
        self.path = path

    @contextmanager
    def _connection(self) -> Iterator[sqlite3.Connection]:
        try:
            connection = sqlite3.connect(self.path, timeout=BUSY_TIMEOUT_SECONDS)
        except sqlite3.OperationalError as exc:
            raise _translate(exc) from exc
        except sqlite3.Error as exc:
            raise DatabaseFailure("Database error") from exc
        try:
            connection.execute(f"PRAGMA busy_timeout = {BUSY_TIMEOUT_MS}")
            try:
                yield connection
            except sqlite3.IntegrityError:
                raise
            except sqlite3.OperationalError as exc:
                raise _translate(exc) from exc
            except sqlite3.Error as exc:
                raise DatabaseFailure("Database error") from exc
        finally:
            connection.close()

    def initialize(self) -> None:
        with self._connection() as connection:
            # journal_mode cannot change inside a transaction.
            connection.execute("PRAGMA journal_mode = WAL")
            with connection:
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
                self._ensure_scan_columns(connection)

    def _ensure_scan_columns(self, connection: sqlite3.Connection) -> None:
        columns = {row[1] for row in connection.execute("PRAGMA table_info(scans)")}
        if "kind" not in columns:
            connection.execute(
                "ALTER TABLE scans ADD COLUMN kind TEXT NOT NULL DEFAULT 'case'"
            )
        if "parent_id" not in columns:
            connection.execute("ALTER TABLE scans ADD COLUMN parent_id INTEGER")
        if "body_text" not in columns:
            connection.execute("ALTER TABLE scans ADD COLUMN body_text TEXT")
        self._backfill_body_text(connection)
        connection.execute(
            """
            CREATE UNIQUE INDEX IF NOT EXISTS scans_clause_text
            ON scans(parent_id, body_text)
            WHERE kind = 'clause'
            """
        )

    def _backfill_body_text(self, connection: sqlite3.Connection) -> None:
        rows = connection.execute(
            "SELECT id, payload FROM scans WHERE body_text IS NULL"
        )
        for row_id, payload in rows:
            try:
                text = json.loads(payload)["request"]["text"]
            except (KeyError, TypeError, json.JSONDecodeError):
                continue
            if isinstance(text, str):
                connection.execute(
                    "UPDATE scans SET body_text = ? WHERE id = ?", (text, row_id)
                )

    def insert(
        self,
        table: Table,
        submitted: dict[str, Any],
        result: dict[str, Any],
        parent_id: int | None = None,
    ) -> dict[str, Any]:
        if table == "scans":
            return self._insert_scan(submitted, result, parent_id)
        if parent_id is not None:
            raise ValueError("parent_id is only valid for scans")
        created_at = datetime.now(UTC).isoformat(timespec="microseconds")
        payload = json.dumps({"request": submitted, "result": result})
        with self._connection() as connection, connection:
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

    def _insert_scan(
        self,
        submitted: dict[str, Any],
        result: dict[str, Any],
        parent_id: int | None,
    ) -> dict[str, Any]:
        text = submitted.get("text")
        if not isinstance(text, str):
            text = ""
        kind = CLAUSE_KIND if parent_id is not None else CASE_KIND
        with self._connection() as connection:
            if parent_id is not None:
                self._require_case_parent(connection, parent_id)
                existing = self._find_clause(connection, parent_id, text)
                if existing is not None:
                    return existing
            created_at = datetime.now(UTC).isoformat(timespec="microseconds")
            payload = json.dumps({"request": submitted, "result": result})
            try:
                with connection:
                    cursor = connection.execute(
                        """
                        INSERT INTO scans (
                            payload, score, flagged, categories, created_at,
                            kind, parent_id, body_text
                        )
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            payload,
                            result["score"],
                            result["flagged"],
                            json.dumps(result["categories"]),
                            created_at,
                            kind,
                            parent_id,
                            text,
                        ),
                    )
                    row_id = cursor.lastrowid
            except sqlite3.IntegrityError:
                if parent_id is None:
                    raise
                raced = self._find_clause(connection, parent_id, text)
                if raced is None:
                    raise
                return raced
            stored = self._read_scan(connection, row_id)
            if stored is None:
                raise DatabaseFailure("Database error")
            return stored

    def _require_case_parent(self, connection: sqlite3.Connection, parent_id: int) -> None:
        if isinstance(parent_id, bool) or not 1 <= parent_id <= MAX_SQLITE_INTEGER:
            raise ParentScanNotFound
        row = connection.execute(
            "SELECT kind FROM scans WHERE id = ?", (parent_id,)
        ).fetchone()
        if row is None:
            raise ParentScanNotFound
        if row[0] != CASE_KIND:
            raise ClauseParentRejected

    def _find_clause(
        self, connection: sqlite3.Connection, parent_id: int, text: str
    ) -> dict[str, Any] | None:
        row = connection.execute(
            """
            SELECT id, created_at, payload, kind, parent_id, body_text
            FROM scans
            WHERE kind = ? AND parent_id = ? AND body_text = ?
            """,
            (CLAUSE_KIND, parent_id, text),
        ).fetchone()
        return self._scan_result(row) if row is not None else None

    def _read_scan(self, connection: sqlite3.Connection, row_id: int | None) -> dict[str, Any] | None:
        if row_id is None:
            return None
        row = connection.execute(
            """
            SELECT id, created_at, payload, kind, parent_id, body_text
            FROM scans WHERE id = ?
            """,
            (row_id,),
        ).fetchone()
        return self._scan_result(row) if row is not None else None

    def list(self, table: Table, limit: int) -> list[dict[str, Any]]:
        with self._connection() as connection:
            if table == "scans":
                # Clause rows are evidence inside a dissection, not cases.
                rows = connection.execute(
                    """
                    SELECT id, created_at, payload, kind, parent_id, body_text
                    FROM scans
                    WHERE kind = ?
                    ORDER BY created_at DESC, id DESC LIMIT ?
                    """,
                    (CASE_KIND, limit),
                )
                return [self._scan_result(row) for row in rows]
            rows = connection.execute(
                """
                SELECT id, created_at, payload FROM traces
                ORDER BY created_at DESC, id DESC LIMIT ?
                """,
                (limit,),
            )
            return [self._trace_result(row) for row in rows]

    def get(self, table: Table, row_id: int) -> dict[str, Any] | None:
        if isinstance(row_id, bool) or not 1 <= row_id <= MAX_SQLITE_INTEGER:
            return None
        with self._connection() as connection:
            if table == "scans":
                return self._read_scan(connection, row_id)
            row = connection.execute(
                "SELECT id, created_at, payload FROM traces WHERE id = ?",
                (row_id,),
            ).fetchone()
            return self._trace_result(row) if row is not None else None

    def activity(self) -> Iterator[tuple[Table, float, bool, list[str], str]]:
        with self._connection() as connection:
            rows = connection.execute(
                """
                SELECT 'scans', score, flagged, categories, substr(created_at, 1, 10)
                FROM scans
                WHERE kind = ?
                UNION ALL
                SELECT 'traces', score, flagged, categories, substr(created_at, 1, 10)
                FROM traces
                """,
                (CASE_KIND,),
            )
            for kind, score, flagged, categories, day in rows:
                yield kind, score, bool(flagged), json.loads(categories), day

    @staticmethod
    def _scan_result(row: tuple[Any, ...]) -> dict[str, Any]:
        row_id, created_at, payload, kind, parent_id, body_text = row
        stored = json.loads(payload)
        request = stored.get("request")
        if isinstance(body_text, str):
            text = body_text
        elif isinstance(request, dict) and isinstance(request.get("text"), str):
            text = request["text"]
        else:
            text = ""
        if kind not in (CASE_KIND, CLAUSE_KIND):
            kind = CASE_KIND
        return {
            "id": row_id,
            "created_at": created_at,
            **stored["result"],
            "text": text,
            "kind": kind,
            "parent_id": parent_id,
        }

    @staticmethod
    def _trace_result(row: tuple[int, str, str]) -> dict[str, Any]:
        row_id, created_at, payload = row
        return {"id": row_id, "created_at": created_at, **json.loads(payload)["result"]}
