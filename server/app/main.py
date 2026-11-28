"""TrustLens HTTP API."""

import os
import sqlite3
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import asdict
from pathlib import Path
from typing import Annotated, Any, Literal

from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from pydantic import BaseModel, Field, field_validator, model_validator

from . import demo_data, engines, evasion
from .compare import Comparison, compare_scores
from .db import (
    MAX_SQLITE_INTEGER,
    ClauseParentRejected,
    Database,
    DatabaseBusy,
    DatabaseFailure,
    ParentScanNotFound,
    Table,
)
from .insights import Overview, overview

DEFAULT_DB = Path(__file__).resolve().parents[1] / "trustlens.db"


@asynccontextmanager
async def lifespan(application: FastAPI) -> AsyncIterator[None]:
    db = Database(Path(os.environ.get("TRUSTLENS_DB", DEFAULT_DB)).expanduser())
    db.initialize()
    application.state.db = db
    yield


app = FastAPI(title="TrustLens", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"https?://(?:localhost|127\.0\.0\.1|\[::1\])(?::[0-9]+)?",
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


class PromptRequest(BaseModel):
    text: str
    # Set only when this string is one clause of an existing case scan.
    # Strict so JSON booleans and numeric strings are not coerced into an id.
    parent_id: Annotated[
        int, Field(strict=True, ge=1, le=MAX_SQLITE_INTEGER)
    ] | None = None

    @field_validator("text")
    @classmethod
    def require_nonblank(cls, text: str) -> str:
        if not text.strip():
            raise ValueError("text must contain non-whitespace characters")
        return text


class TraceStep(BaseModel):
    tool: str
    args: dict[str, Any]
    result: str


class TraceInput(BaseModel):
    trace_id: str
    steps: list[TraceStep]


class TraceRequest(BaseModel):
    trace: TraceInput


FiniteNumber = Annotated[float, Field(strict=True, allow_inf_nan=False)]


class CompareRequest(BaseModel):
    baseline: Annotated[list[FiniteNumber], Field(min_length=2)]
    candidate: Annotated[list[FiniteNumber], Field(min_length=2)]
    alpha: Annotated[FiniteNumber, Field(gt=0, lt=1)] = 0.05

    @model_validator(mode="after")
    def require_equal_lengths(self) -> "CompareRequest":
        if len(self.baseline) != len(self.candidate):
            raise ValueError("baseline and candidate must have equal lengths")
        return self


class Analysis(BaseModel):
    id: int
    score: float
    flagged: bool
    categories: list[str]
    signals: list[str]
    created_at: str


class Scan(Analysis):
    text: str
    kind: Literal["case", "clause"]
    parent_id: int | None = None


class Trace(Analysis):
    trace_id: str
    steps: list[engines.StepAnnotation]


class ScanList(BaseModel):
    items: list[Scan]


class TraceList(BaseModel):
    items: list[Trace]


@app.exception_handler(RequestValidationError)
async def validation_error(_: Request, error: RequestValidationError) -> JSONResponse:
    # Pydantic includes the offending input, which may be NaN or Infinity
    # and therefore cannot be serialized as JSON in the error response.
    return JSONResponse(
        status_code=422,
        content={
            "detail": [
                {key: item[key] for key in ("loc", "msg", "type")} for item in error.errors()
            ]
        },
    )


@app.exception_handler(engines.EngineUnavailable)
async def engine_unavailable(_: Request, error: engines.EngineUnavailable) -> JSONResponse:
    return JSONResponse(status_code=503, content={"detail": str(error)})


def _database_error(status: int, detail: str) -> JSONResponse:
    return JSONResponse(status_code=status, content={"detail": detail})


@app.exception_handler(DatabaseBusy)
async def database_busy(_: Request, error: DatabaseBusy) -> JSONResponse:
    return _database_error(503, "Database is locked")


@app.exception_handler(DatabaseFailure)
async def database_failure(_: Request, error: DatabaseFailure) -> JSONResponse:
    return _database_error(500, "Database error")


@app.exception_handler(sqlite3.Error)
async def sqlite_error(_: Request, error: sqlite3.Error) -> JSONResponse:
    # Backstop for a driver error that escaped the database helper.
    message = str(error).lower()
    if "locked" in message or "busy" in message:
        return _database_error(503, "Database is locked")
    return _database_error(500, "Database error")


def get_database(request: Request) -> Database:
    return request.app.state.db


DB = Annotated[Database, Depends(get_database)]
Limit = Annotated[int, Query(ge=0, le=MAX_SQLITE_INTEGER)]


def _get_or_404(db: Database, table: Table, row_id: int) -> dict[str, Any]:
    result = db.get(table, row_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Record not found")
    return result


@app.get("/api/health")
def health() -> dict[str, Any]:
    return {"ok": True, "engines": engines.available()}


@app.post("/api/scan")
def scan_prompt(body: PromptRequest, db: DB) -> Scan:
    result = asdict(engines.scan_prompt(body.text))
    try:
        stored = db.insert("scans", body.model_dump(), result, parent_id=body.parent_id)
    except ParentScanNotFound as exc:
        raise HTTPException(status_code=404, detail="Record not found") from exc
    except ClauseParentRejected as exc:
        raise HTTPException(
            status_code=422, detail="parent_id must reference a case scan"
        ) from exc
    return Scan.model_validate(stored)


@app.get("/api/scans")
def list_scans(db: DB, limit: Limit = 50) -> ScanList:
    return ScanList.model_validate({"items": db.list("scans", limit)})


@app.get("/api/scans/{id}")
def get_scan(id: int, db: DB) -> Scan:
    return Scan.model_validate(_get_or_404(db, "scans", id))


@app.post("/api/traces")
def scan_trace(body: TraceRequest, db: DB) -> Trace:
    trace = body.trace.model_dump()
    report = engines.scan_trace(trace, [step.tool for step in body.trace.steps])
    result = {"trace_id": body.trace.trace_id, **asdict(report)}
    return Trace.model_validate(db.insert("traces", {"trace": trace}, result))


@app.get("/api/traces")
def list_traces(db: DB, limit: Limit = 50) -> TraceList:
    return TraceList.model_validate({"items": db.list("traces", limit)})


@app.get("/api/traces/{id}")
def get_trace(id: int, db: DB) -> Trace:
    return Trace.model_validate(_get_or_404(db, "traces", id))


@app.post("/api/compare")
def compare(body: CompareRequest) -> Comparison:
    try:
        return compare_scores(body.baseline, body.candidate, body.alpha)
    except OverflowError as exc:
        raise HTTPException(status_code=422, detail="Comparison exceeds the finite float range") from exc


@app.get("/api/insights/overview")
def get_overview(db: DB) -> Overview:
    return overview(db)


@app.get("/api/demo/prompts")
def demo_prompts() -> list[dict[str, Any]]:
    return demo_data.prompts()


@app.get("/api/demo/traces")
def demo_traces() -> list[dict[str, Any]]:
    return demo_data.traces()


@app.post("/api/evasion/specimens")
def evasion_specimens(body: PromptRequest) -> evasion.Specimens:
    """Scan one text and a variant from each local mutation operator."""
    return evasion.specimens(body.text)


@app.get("/api/evasion/ledger")
def evasion_ledger() -> evasion.Ledger:
    """Measure bypasses on the shipped demo prompts."""
    return evasion.ledger()


@app.api_route(
    "/api/{path:path}",
    methods=["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"],
    include_in_schema=False,
)
def unmatched_api(path: str) -> None:
    # Registered after the real /api routes. Keeps an unknown /api path on
    # FastAPI's JSON 404 when the frontend mount below is active.
    raise HTTPException(status_code=404, detail="Not Found")


# Built Inspection Theater. Registered only when `web/dist` exists, so a
# source checkout without a production build stays API-only. `app.frontend`
# is lower priority than the `/api` routes above.
_FRONTEND_DIST = Path(__file__).resolve().parents[2] / "web" / "dist"
if _FRONTEND_DIST.is_dir():
    app.frontend("/", directory=_FRONTEND_DIST)

    @app.exception_handler(404)
    def spa_fallback(request: Request, exc: HTTPException) -> Response:
        # Unknown /api paths keep the JSON 404; any other unmatched GET is a
        # client-side route and gets the app shell.
        if request.url.path.startswith("/api"):
            return JSONResponse(status_code=404, content={"detail": "Not Found"})
        return FileResponse(_FRONTEND_DIST / "index.html")
