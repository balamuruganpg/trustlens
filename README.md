# TrustLens — LLM Trust Studio

**A visual, full-stack studio for LLM safety work — built as an Inspection Theater, not a dashboard.** TrustLens puts a real product UI in front of three engines from the same trustworthy-LLM-systems line — [PromptWarden](https://github.com/balamuruganpg/promptwarden) (prompt injection + PII scanning), [AgentSentinel](https://github.com/balamuruganpg/agentsentinel) (agent execution-trace scanning), and PromptRegress-style paired comparison statistics. Instead of tables of scores, you open a case, press play, and watch the exact step — or the exact sentence — get caught. Pure black (`#000000`) dark theme, pure white (`#ffffff`) light theme, one toggle.

![FastAPI](https://img.shields.io/badge/backend-FastAPI-009688)
![React](https://img.shields.io/badge/frontend-React%20%2B%20TypeScript-61dafb)
![SQLite](https://img.shields.io/badge/storage-SQLite-003b57)
![Engines](https://img.shields.io/badge/engines-PromptWarden%20%C2%B7%20AgentSentinel-purple)
![Contract tests](https://img.shields.io/badge/contract%20tests-37%20passing-brightgreen)
![CI](https://github.com/balamuruganpg/trustlens/actions/workflows/ci.yml/badge.svg)

![Replay Theater — press play, the agent reads a secrets file, and playback freezes on the catch](docs/demo-replay.gif)

## What it does

| Page | What you see |
| --- | --- |
| **Case Files** | Every scan and trace is a case with a one-line story — *"Read sensitive data, then sent it out — flagged at 0.85"* — plus an intake block to inspect something new and one-click demo cases. Totals shrink to a single slim strip. |
| **Replay Theater** | Press play and an agent trace replays frame by frame: a data-flow ribbon follows data from a file to an external host, a risk meter climbs, and playback **auto-pauses on the first dangerous step** with an incident card that names the pattern and links the steps that form it. |
| **Dissection** | A prompt is split into clauses and each clause is scored on its own, so the one attack sentence lights up red inside a normal paragraph, with an evidence panel explaining every signal in plain English. |
| **Compare** | Paired model comparison, PromptRegress-style: mean difference with a bootstrap 95% CI (10,000 resamples), McNemar's exact test, and a PASS/FAIL gate badge with a paired-difference chart. |
| **Evasion Lab** (`/evasion`) | Pick a demo prompt and inspect the original beside its five mutated specimens, stamped with PromptWarden's verdict and score. The robustness ledger measures bypasses on the shipped demo set live. |

## Screenshots

![Replay Theater — playback frozen at the catch: the .env read, the incident card, the data-flow ribbon](docs/screenshots/replay-theater.png)

![Case Files — every case leads with its story, on pure black](docs/screenshots/case-files.png)

![Dissection — the attack clause boxed in red inside a normal paragraph, evidence on the right](docs/screenshots/dissection.png)

![Compare — gate FAIL with bootstrap CI and McNemar p](docs/screenshots/compare.png)

![Case Files in the light theme — pure white](docs/screenshots/case-files-light.png)

```mermaid
flowchart LR
    UI["React + TypeScript UI<br/>case files · replay theater · dissection · compare · evasion lab"] -->|"/api (Vite proxy)"| API["FastAPI backend"]
    API --> PW["PromptWarden<br/>injection + PII"]
    API --> AS["AgentSentinel<br/>trace policies + classifier"]
    API --> CMP["Paired comparison<br/>bootstrap CI · McNemar"]
    API --> MUT["Local mutation operators<br/>leet · space_out · homoglyph<br/>char_reverse · zero_width"]
    API --> DB[("SQLite<br/>scans + traces history")]
    API --> DEMO["demo/ datasets<br/>24 prompts · 8 traces"]
```

## Quick start

```bash
# backend (terminal 1)
cd server
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
TRUSTLENS_DB=$PWD/trustlens.db .venv/bin/python -m uvicorn app.main:app --port 8000

# frontend (terminal 2)
cd web
npm install
npm run dev   # http://localhost:5173
```

Open the app, load a demo prompt or trace, and everything runs against the real engines — no mocks. The demo datasets are labeled, and the engines' verdicts agree with **24/24 prompt labels** and **8/8 trace labels**.

### Run with Docker

From the repository root:

```bash
docker compose up --build
```

The `trustlens` service publishes port 8000. SQLite is the named volume `trustlens-db`, and `TRUSTLENS_DB` is `/data/trustlens.db` on that volume. Open http://localhost:8000 — the same process serves `/api` and the built Inspection Theater.

## API (v1)

`POST /api/scan` · `GET /api/scans[/{id}]` · `POST /api/traces` · `GET /api/traces[/{id}]` · `POST /api/compare` · `GET /api/insights/overview` · `GET /api/demo/prompts` · `GET /api/demo/traces` · `POST /api/evasion/specimens` · `GET /api/evasion/ledger` · `GET /api/health` — full contract in [SPEC.md](SPEC.md), black-box contract tests in [contract-tests/](contract-tests/) (37 passing against a live server), architecture notes in [docs/architecture.md](docs/architecture.md).

## Honest notes

- Every number in the UI comes from an API response or a labeled demo file — nothing is hard-coded or invented.
- The comparison gate is a statistical summary of the scores you give it, not a deployment decision.
- Demo PII is obviously fake (test card numbers, `example.com` addresses).
- The Evasion Lab ledger covers `demo/prompts.jsonl`. Its bypass rate uses variants of flagged originals as the denominator. See the TrustBreaker and PromptWarden project READMEs for their published corpus benchmarks. TrustLens implements the five operators directly in `server/app/mutations.py` under TrustBreaker's names, using only the Python standard library.
