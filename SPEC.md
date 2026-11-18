# TrustLens — LLM Trust Studio (SPEC v1)

A **visual, full-stack product** in Krish's trustworthy-LLM-systems line: it puts a real web UI and API in front of the engines he already built — **PromptWarden** (prompt injection + PII scanning), **AgentSentinel** (agent trace scanning), and PromptRegress-style **paired comparison** statistics — so the work is something you can *see and click*, not just a CLI.

## Stack

- **Backend**: Python 3.11+, FastAPI, SQLite (stdlib `sqlite3`), uvicorn. Typed, tested with pytest.
- **Frontend**: React + Vite + TypeScript + Tailwind CSS. Charts with `recharts`. Inspection Theater UI: pure black (`#000000`) dark theme, pure white (`#ffffff`) light theme, one toggle.
- **Engines**: the real `promptwarden` and `agentsentinel` packages (pip-installable from their GitHub repos; local checkouts may be used in dev venvs). Comparison stats are implemented in the server with stdlib only (paired bootstrap CI + McNemar), mirroring PromptRegress's method.

## Layout (each area is owned by one builder; do not edit outside your area)

```
server/          backend (FastAPI app in server/app/, tests in server/tests/)
web/             frontend (Vite app)
demo/            demo datasets + seed content (JSON/JSONL + a loader spec)
docs/            README support: architecture notes, screenshot plan
contract-tests/  black-box API contract tests written from this SPEC only
SPEC.md          this contract — read-only for builders
```

## API contract (v1) — all JSON, prefix `/api`

### Prompt scanning (PromptWarden)
- `POST /api/scan` body `{"text": str}` → `200 {"id": int, "score": float 0..1, "flagged": bool, "categories": [str], "signals": [str], "created_at": iso8601}`. Empty/whitespace text → `422`.
- `GET /api/scans?limit=50` → `{"items": [scan...]}` newest first.
- `GET /api/scans/{id}` → one scan or `404`.

### Agent traces (AgentSentinel)
- `POST /api/traces` body `{"trace": {"trace_id": str, "steps": [{"tool": str, "args": dict, "result": str}]}}` → `200 {"id": int, "trace_id": str, "score": float, "flagged": bool, "categories": [str], "signals": [str], "steps": [{"index": int, "tool": str, "risk": float 0..1, "signals": [str]}], "created_at": iso8601}`. The per-step `risk` is derived from the trace's signals/evidence (a step is annotated when it participates in a flagged pattern; document the derivation). Malformed trace (not an object / steps not a list) → `422`.
- `GET /api/traces?limit=50`, `GET /api/traces/{id}` — same shapes as scans.

### Paired comparison (PromptRegress-style)
- `POST /api/compare` body `{"baseline": [float...], "candidate": [float...], "alpha": 0.05}` — equal-length lists, length ≥ 2, all finite → `200 {"n": int, "baseline_mean": float, "candidate_mean": float, "mean_diff": float, "ci_low": float, "ci_high": float, "mcnemar_p": float, "gate": "PASS"|"FAIL"}`. Method: paired bootstrap 95% CI on the mean difference (10,000 resamples, seed 13), McNemar's exact test on pass/fail at score ≥ 0.5... — no: pass means score > 0 unless a case is exactly 0/1-scored; keep it simple and document: a case is a "pass" when its score ≥ 0.5. Gate FAIL when the CI's upper bound < 0 (candidate worse), else PASS. Mismatched lengths / n < 2 / non-finite → `422`.

### Insights (dashboard)
- `GET /api/insights/overview` → `{"scans": {"total": int, "flagged": int, "avg_score": float}, "traces": {same}, "categories": [{"category": str, "count": int}], "trend": [{"date": "YYYY-MM-DD", "scans": int, "traces": int, "flagged": int}]}` — computed from stored rows; empty DB returns zeros and empty lists, never an error.

### Demo
- `GET /api/demo/prompts` → the demo prompt set (from `demo/prompts.jsonl`: `{"text","label","category"}` rows; `category` is `"injection"`, `"pii"`, or `null` for benign rows).
- `GET /api/demo/traces` → the demo trace set (from `demo/traces.json`: full trace objects with an added `"label"` field).
- Demo endpoints read the files under `demo/` at runtime; missing files → empty lists.

### Evasion Lab (PromptWarden + local operators)

TrustLens implements the five deterministic operators in `server/app/mutations.py` under TrustBreaker's names. These operators require only the Python standard library. Both endpoints run on demand without adding scans or traces to history.

Operators, in this order:

- `leet` — `a/e/i/o/s/t` and `A/E/I/O/S/T` become `4/3/1/0/5/7`. Other characters stay.
- `space_out` — a word is a run of letters, digits, and underscores; combining marks stay on their base character. Words of four or more of those characters gain a space between characters. Shorter words and the separators stay.
- `homoglyph` — a fixed Latin-to-look-alike map: `a c e i j o p s x y` and `A B C E H I K M O P T X Y` (Y maps to Greek upsilon, the others to Cyrillic look-alikes). Other characters stay.
- `char_reverse` — reverse each word; combining marks stay on their base character.
- `zero_width` — insert U+200B between the characters of each word; combining marks stay on their base character.

For the text `Ignore`, the five variant texts are exactly `1gn0r3`, `I g n o r e`, `Іgnоrе` (I → U+0406, o → U+043E, e → U+0435), `erongI`, and `I` + U+200B + `g` + U+200B + `n` + U+200B + `o` + U+200B + `r` + U+200B + `e`.

- `POST /api/evasion/specimens` body `{"text": str}` → `200 {"original": {"text": str, "score": float 0..1, "flagged": bool, "categories": [str], "signals": [str]}, "variants": [variant...]}`. `variants` has one object per operator, in the order above: `{"operator": str, "text": str, "score": float 0..1, "flagged": bool, "categories": [str], "signals": [str], "slipped": bool}`. `original.text` is the submitted text. `slipped` is true only when the original is flagged and that variant is not. Empty or whitespace text → `422`. Scores come from PromptWarden.
- `GET /api/evasion/ledger` → `200 {"scope": "demo-set", "prompts": int, "originals_flagged": int, "variants_generated": int, "variants_from_flagged": int, "bypassed": int, "bypass_rate": float|null, "operators": [{"operator": str, "variants": int, "bypassed": int, "bypass_rate": float|null}, ...]}`. `prompts` counts demo rows with nonblank string text. PromptWarden scans each original and its five variants, so `variants_generated` is `prompts * 5`. `originals_flagged` is the number of originals PromptWarden flagged, and `variants_from_flagged` is `originals_flagged * 5`. A bypass is a clear variant of a flagged original. The demo-set bypass rate is `bypassed / variants_from_flagged`, or `null` when that denominator is zero. The five operator rows follow the same order as the specimen response. Each row's `variants` is the number of eligible variants for that operator, equal to `originals_flagged`. Each row has the same rate formula and null rule. A missing demo file yields zero counts, five operator rows, and null rates.

### Health
- `GET /api/health` → `{"ok": true, "engines": {"promptwarden": bool, "agentsentinel": bool}}` — engine flags reflect import success.

## Persistence

SQLite file `server/trustlens.db` (path overridable via `TRUSTLENS_DB` env). Tables: `scans`, `traces` (payload JSON + extracted score/flagged/categories + created_at). Created on startup; no migrations framework.

## Frontend pages

The UI is an **Inspection Theater**: five pages in one shell, not a score dashboard. Pure black (`#000000`) dark theme and pure white (`#ffffff`) light theme, switched by one toggle. Product name **TrustLens**. Loading and error states on every page. Dev API base `http://localhost:8000` via the Vite proxy (`/api` → `:8000`).

1. **Case Files** (`/`) — every stored scan and trace is a case that leads with a one-line story from that row's signals, categories, flagged flag, and score. A slim strip shows scan and trace totals, flagged counts, and category counts from `GET /api/insights/overview`. An intake block opens Dissection or Replay Theater. One-click demo cases come from `GET /api/demo/prompts` and `GET /api/demo/traces`. Stored cases come from the scan and trace list endpoints.
2. **Dissection** (`/scan`) — paste a prompt or open a demo prompt. The wording is split into clauses and each clause is scored with `POST /api/scan`, so the risky sentence is marked in place. A verdict shows the whole-text score, flagged badge, categories, and signals, with an evidence panel for the selected clause. Past dissections reload from `GET /api/scans` and `GET /api/scans/{id}`.
3. **Replay Theater** (`/traces`) — paste a trace or open a demo trace (`POST /api/traces`, the trace list and by-id reads, `GET /api/demo/traces`). Press play and the trace replays step by step: a data-flow ribbon follows paths and hosts in the submitted arguments, a risk meter tracks the highest risk played so far, and playback auto-pauses on the first step whose risk is at least 0.5 with an incident card that names the pattern and links the steps that carry it. The header shows score, verdict, and categories.
4. **Compare** (`/compare`) — two score-list inputs (comma or newline separated) or a built-in example pair. That example is not an API demo: demo endpoints exist only for prompts and traces. Stats show means, mean difference, bootstrap CI, McNemar p, and a PASS/FAIL gate badge, plus a paired-difference chart. `POST /api/compare`.
5. **Evasion Lab** (`/evasion`) — pick a shipped attack prompt or submit your own text to `POST /api/evasion/specimens`. The tray displays the original scan beside one specimen card per operator, with the PromptWarden score and a caught or slipped-past stamp. Clear scans of unflagged originals are labeled clear. Dotted underlines mark look-alike substitutions, and ZW marks U+200B. The robustness ledger displays the live demo-set measurement from `GET /api/evasion/ledger` and names the bypass rate's denominator. Red marks slipped-past stamps and errors.
6. Shell: left nav labeled Case Files, Replay Theater, Dissection, Compare, and Evasion Lab; engine readiness from `GET /api/health`; theme toggle.

## Quality bar

- Backend: `pytest` green, `ruff check` clean, app boots with `uvicorn app.main:app` from `server/`.
- Frontend: `npm run build` succeeds (TypeScript strict), no placeholder lorem ipsum — every control wired to the real API or demo data.
- No invented metrics anywhere: every number the UI shows comes from an API response or the demo files' labels.
