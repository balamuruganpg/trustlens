# Local integration checklist

Run the whole product from a clone, in this order. Commands assume the clone is `~/workspace/trustlens`. `SPEC.md` is the contract these steps come from. Where the spec does not name a filename, a port, or a URL, the step says so and points at the file that fills the gap.

Do this in four terminals by the end: one for the API, one for the Vite dev server, and two short-lived shells for the build and the contract tests. Leave the API running for the tests.

## Gaps that change a command

- **Engine URLs.** The spec says PromptWarden and AgentSentinel are pip-installable from their GitHub repos, and that a local checkout is allowed in a dev venv. It does not pin versions or URLs. `server/requirements.txt` is the pin the backend checked in. Install that file. Do not invent a different URL in this checklist.
- **Backend manifest.** The spec does not name `requirements.txt`. This repo has `server/requirements.txt` (install target) and `server/pyproject.toml` (pytest and ruff settings, no dependencies). `pip install -e .` from `server/` does not install the API.
- **Database path.** The spec names `server/trustlens.db` and the `TRUSTLENS_DB` override. It does not say whether a relative path is resolved from the repo root or from the working directory of `uvicorn` (which is `server/`). Set an absolute `TRUSTLENS_DB`.
- **Ruff.** The spec requires `ruff check` clean. `server/requirements.txt` does not list ruff. Install it into the same venv before that step.
- **Node version.** The spec does not pin Node. Use a current Node.js with npm, new enough for the Vite app in `web/`.
- **Vite port.** The spec does not set it. The API port is 8000. Vite prints the URL it actually bound. The spec does require the dev server to proxy `/api` to port 8000.
- **Demo comparison.** Compare can load a built-in example pair that ships in the UI. The API defines `GET /api/demo/prompts` and `GET /api/demo/traces` only. There is nothing to seed for compare.
- **Frontend routes.** The frontend section of `SPEC.md` names them: `/` Case Files, `/scan` Dissection, `/traces` Replay Theater, `/compare` Compare, `/evasion` Evasion Lab. The left nav uses those labels.

## 1. Prerequisites

```bash
cd ~/workspace/trustlens
python3 -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 11) else "Python 3.11+ required, found %s" % sys.version)'
node -v
npm -v
```

Python must be 3.11 or newer. `node` and `npm` must print versions.

## 2. Demo data

The API reads these paths at request time. A missing file becomes an empty JSON list, not an error. The UI pickers are empty in that case, and the screenshot plan cannot be shot.

```bash
cd ~/workspace/trustlens
test -f demo/prompts.jsonl && echo "prompts: present" || echo "prompts: MISSING (demo endpoints return [])"
test -f demo/traces.json && echo "traces: present" || echo "traces: MISSING (demo endpoints return [])"
```

Expected file shapes, from the spec:

- `demo/prompts.jsonl` — one JSON object per line: `text`, `label`, `category`.
- `demo/traces.json` — the demo trace set. Each trace has `trace_id` and `steps` (`tool`, `args`, `result`) plus `label`.

If `demo/` also contains a loader note, follow that note. This checklist does not seed the database from those files. Rows land in SQLite when someone runs a scan or a trace, including the one-click demo controls.

A missing pair is not a failed boot. It is an empty picker. For a full click-through, both files are present and each has at least one row.

## 3. Backend virtualenv

```bash
cd ~/workspace/trustlens/server
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
python -m pip install ruff
python -c 'import fastapi, uvicorn, promptwarden, agentsentinel, pytest'
```

The last command exits 0 when FastAPI, uvicorn, both engines, and pytest import. PromptWarden and AgentSentinel need whatever the `git+https` lines in `requirements.txt` need: network access to GitHub, unless those lines have been changed to local checkouts.

If an engine import fails, `GET /api/health` can still return `ok: true` with that engine's flag set to `false`. The spec does not define a status code for a scan or a trace when the import failed. The contract tests expect `POST /api/scan` and `POST /api/traces` to return 200. Get the imports working before those tests.

`server/pyproject.toml` sets pytest `testpaths` to `tests` and configures ruff. It is not the install manifest.

## 4. Database and API process

Terminal A:

```bash
cd ~/workspace/trustlens/server
source .venv/bin/activate
export TRUSTLENS_DB="$HOME/workspace/trustlens/server/trustlens.db"
uvicorn app.main:app
```

That is the spec's boot command, run from `server/`, plus an absolute database path so the file is the one the spec names (`server/trustlens.db`) regardless of how the process resolves relative paths.

The spec's documented origin is `http://localhost:8000`. Uvicorn's default port is 8000. Leave this process running.

Created on startup: the SQLite file and the `scans` and `traces` tables. There is no migration step.

Smoke check, from any directory:

```bash
curl -sS http://localhost:8000/api/health
```

Expect a JSON object:

- `ok` is `true`
- `engines.promptwarden` is a boolean
- `engines.agentsentinel` is a boolean

Both engine booleans should be `true` after step 3. `false` means that import did not succeed in this process.

Also confirm the file landed where you pointed:

```bash
test -f "$HOME/workspace/trustlens/server/trustlens.db" && echo "db: present"
```

The file may appear only after the process has finished startup. If it is missing, read the uvicorn log before continuing.

## 5. Frontend

Terminal B:

```bash
cd ~/workspace/trustlens/web
npm install
npm run build
npm run dev
```

`npm run build` must exit 0. The spec's frontend bar is a successful production build under TypeScript strict mode. `web/package.json` defines `build` as `tsc -b && vite build` and `dev` as `vite`.

`npm run dev` prints a local URL. Open it. The spec does not pin that port (Vite's usual default is 5173).

Proxy check, using the origin Vite printed (5173 only if that is the port in the log):

```bash
curl -sS http://127.0.0.1:5173/api/health
curl -sS http://127.0.0.1:8000/api/health
```

The two bodies match: the same `ok` and the same engine flags. The spec requires the Vite proxy `/api` → `:8000`. If the dev-server request returns the HTML shell instead of the health JSON, `web/vite.config.ts` does not proxy `/api` yet. That belongs to the web area. The API on port 8000 can still serve the contract tests.

In the browser, the shell shows **TrustLens**, a left nav, and the five pages: Case Files, Replay Theater, Dissection, Compare, Evasion Lab. The theme toggle switches pure black (`#000000`) and pure white (`#ffffff`); dark is the default. Each page has a loading state and an error state. Clicking a demo prompt or a demo trace calls the API; the figures you see are the JSON from that call. The Evasion Lab ledger measures the shipped demo set.

`npm run preview` exists on the web package and is optional. It serves the production build. The spec's day-to-day path is `npm run dev` with the proxy.

## 6. Contract tests

Terminal C, while Terminal A is still serving:

```bash
cd ~/workspace/trustlens
source server/.venv/bin/activate
python -m pytest contract-tests -q
```

Default origin is `http://localhost:8000`. Override it when the API is elsewhere:

```bash
TRUSTLENS_BASE_URL=http://127.0.0.1:8000 python -m pytest contract-tests -q
```

What you should see when the API is up: **33 passed**. Skips mean the probe could not open a connection. A skip is not a green contract. The skip text names the origin and the socket error. Details, the case list, and the `# SPEC-AMBIGUOUS:` notes are in `contract-tests/README.md`.

The suite **inserts** scans and traces into `TRUSTLENS_DB`. There is no delete API. Use a database you can throw away, or accept the extra rows. Screenshot capture in `docs/screenshot-plan.md` is cleaner before this step.

Pytest is in `server/requirements.txt`. The tests themselves do not import httpx; they use the stdlib. Running them does not need `cd server`.

To confirm the skip path on its own, point at a closed port:

```bash
TRUSTLENS_BASE_URL=http://127.0.0.1:9 python -m pytest contract-tests/test_api_contract.py::test_health_shape -rs
```

Expect a skip whose message says the server is unreachable, not a failure.

## 7. Backend quality bar

Terminal A can keep serving. In another shell:

```bash
cd ~/workspace/trustlens/server
source .venv/bin/activate
ruff check
pytest
```

Both exit 0. `pytest` here is the server area's tests (`server/tests` via `pyproject.toml`), not `contract-tests/`. Run the contract suite from the repository root, as in step 6.

`httpx` is installed because `requirements.txt` lists it. It is for the server tests. The contract suite does not use it.

## Done when

- `curl http://localhost:8000/api/health` returns `ok: true` and both engine flags are `true`.
- `server/trustlens.db` exists at the absolute `TRUSTLENS_DB` you set (or you deliberately chose another absolute path).
- `demo/prompts.jsonl` and `demo/traces.json` exist if you expect the pickers to have rows.
- `npm run build` in `web/` exits 0.
- The Vite origin's `/api/health` returns the same JSON as port 8000.
- `python -m pytest contract-tests -q` from the repo root reports 37 passed against that server.
- `ruff check` and `pytest` in `server/` both exit 0.
- The five pages — Case Files, Replay Theater, Dissection, Compare, Evasion Lab — render in the shell (pure black by default, pure white from the theme toggle), and a demo prompt plus a demo trace produce the screenshots in `docs/screenshot-plan.md`.
