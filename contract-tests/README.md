# Contract tests

Black-box tests for the TrustLens HTTP API. They are written from `SPEC.md` only. They do not import the FastAPI app, and they do not read `server/`, `web/`, or `demo/`.

The HTTP client is the Python standard library (`urllib`). The only install these tests need is pytest itself.

Every test in `test_api_contract.py` and `test_evasion_contract.py` is marked `requires_server`. A server that cannot be contacted produces a **skip**, with a message that names the URL and the connection error. A process that answers with any HTTP status is treated as up, and a contract mismatch is a failure.

## Run

From the repository root, with the API already running:

```bash
python -m pytest contract-tests -q
```

`server/requirements.txt` includes pytest. After that install, from the repository root:

```bash
source server/.venv/bin/activate
python -m pytest contract-tests -q
```

If you are not using that venv:

```bash
python -m pip install pytest
python -m pytest contract-tests -q
```

Python 3.11 or newer. The product's own quality bar is the same floor.

### Base URL

`TRUSTLENS_BASE_URL` is the server **origin**, with no `/api` suffix and no trailing slash. The default is `http://localhost:8000`.

```bash
TRUSTLENS_BASE_URL=http://127.0.0.1:8000 python -m pytest contract-tests -q
```

An empty `TRUSTLENS_BASE_URL` uses the default.

Paths from the spec are appended to that origin. `POST /api/scan` is singular. `GET /api/scans` and `GET /api/scans/{id}` are plural. Traces use `/api/traces` for both the create and the collection.

### When the server is down

`conftest.py` probes `GET /api/health` once per session, with a 3 second timeout. Connection refused, DNS failure, timeout, and an invalid origin skip the run. Each request the tests make after a successful probe waits up to 60 seconds, so a cold engine import still has time to answer.

A skip is not a passing contract. Start the API (`uvicorn app.main:app` from `server/`) and run the suite again. Expect passes, not skips.

Show the skip reason:

```bash
python -m pytest contract-tests/test_api_contract.py::test_health_shape -rs
```

Run a single endpoint group with `-k`:

```bash
python -m pytest contract-tests -q -k compare
```

## These tests write to the server's database

`POST /api/scan` and `POST /api/traces` insert rows into whatever SQLite file the running process is using (`server/trustlens.db`, or `TRUSTLENS_DB`). There is no delete endpoint in the spec, so the rows stay. Point the server at a database you are willing to grow before you run the suite. The overview test also inserts one scan and one trace and expects those totals to rise.

Run pytest in one process against one server. The newest-first checks only compare the two ids created inside that test.

## What is covered

22 test functions — 19 in `test_api_contract.py` and 3 in `test_evasion_contract.py`, one of them parametrized — 38 collected cases. Shared helpers check field presence, JSON types, and ranges; the table names what each test adds.

| Test | Cases | What it asserts |
| --- | --- | --- |
| `test_health_shape` | 1 | `GET /api/health` is 200 JSON. `ok` is boolean `true`. `engines.promptwarden` and `engines.agentsentinel` are booleans. Either boolean value is accepted. |
| `test_scan_happy_path` | 1 | `POST /api/scan` with non-empty text is 200. Body has `id` (int), `score` in `[0, 1]`, `flagged` (bool), `categories` and `signals` (lists of strings), `created_at` (ISO-8601). Does **not** require `flagged == (score >= 0.5)`. |
| `test_scan_empty_or_whitespace_is_422` | 5 | `""`, `" "`, `"\n"`, `"\t"`, and mixed ASCII whitespace each return **422**. The error body is not checked. |
| `test_scans_list_shape_and_newest_first` | 1 | `GET /api/scans?limit=50` is 200 `{"items": [scan, ...]}` with at most 50 items, each a scan object. The later of two creates appears before the earlier one. |
| `test_scan_round_trip` | 1 | `GET /api/scans/{id}` is 200 and is the posted scan: same id, score, and flagged; categories and signals equal as multisets; `created_at` is the same instant when both timestamps are comparable. |
| `test_scan_missing_id_is_404` | 1 | `GET /api/scans/2147483647` is **404**. |
| `test_dissection_reopen_keeps_case_counts_and_returns_text` | 1 | A whole-text scan plus its clause scans: the detail's `text` is the submitted prompt. Clause rows use `kind: "clause"` and `parent_id`. Overview scan total rises for the case and does not rise for the clauses or for posting those clauses again. The case list contains the parent id and not the clause ids. Re-posting a clause returns the same id. |
| `test_trace_happy_path_step_annotations` | 1 | `POST /api/traces` with a trace object is 200. Trace fields are present. `score` is a finite number with no unit-interval check. Each returned step has `index` (int), `tool` (str), `risk` in `[0, 1]`, `signals` (list of str). `trace_id` echoes the request. The step list is not required to match the request step-for-step. |
| `test_traces_list_shape_and_newest_first` | 1 | `GET /api/traces?limit=50` is a newest-first page of trace objects, at most 50, same list pattern as scans. |
| `test_trace_round_trip` | 1 | `GET /api/traces/{id}` returns that stored trace, including `trace_id`, score, flagged, category and signal multisets, the same step array, and a comparable `created_at`. |
| `test_trace_missing_id_is_404` | 1 | `GET /api/traces/2147483647` is **404**. |
| `test_trace_malformed_is_422` | 8 | **422** when `trace` is null, a string, a number, a boolean, or an array, and when `steps` is null, an object, or a string. |
| `test_compare_happy_path_means_ci_and_gate` | 2 | `POST /api/compare` with `alpha: 0.05` and two length-4 constant series. `n` is the length. Means match the arithmetic means. `mean_diff` is candidate mean minus baseline mean. `ci_low <= mean_diff <= ci_high`. `gate` is `FAIL` when `ci_high < 0`, otherwise `PASS`. The all-worse series must come back `FAIL` with `ci_high < 0`. The all-better series must come back `PASS`. `mcnemar_p` is a finite number in `[0, 1]`. Exact bootstrap endpoints and the numeric p-value are not locked. |
| `test_compare_mismatched_lengths_is_422` | 1 | Lengths 2 and 3 return **422**. |
| `test_compare_n_below_two_is_422` | 2 | Two empty lists, and two length-1 lists, each return **422**. |
| `test_compare_non_finite_is_422` | 3 | A body containing the tokens `NaN`, `Infinity`, or `-Infinity` returns **422**. |
| `test_insights_overview_shape_any_db_state` | 1 | `GET /api/insights/overview` is 200 on the current database, including all zeros. `scans` and `traces` each have `total`, `flagged`, and `avg_score`. Totals are `>= 0`, `flagged <= total`, and `avg_score` is 0 when that side's total is 0. Scan average is in `[0, 1]` when scans exist. `categories` is a list of `{category, count}`. `trend` is a list of `{date: YYYY-MM-DD, scans, traces, flagged}`. After one create of each kind, the matching total increases by at least 1. |
| `test_demo_prompts_returns_list` | 1 | `GET /api/demo/prompts` is 200 and a JSON list. An empty list is valid. Each row has string `text`, string `category`, and a `label` key of any JSON type. |
| `test_demo_traces_returns_list` | 1 | `GET /api/demo/traces` is 200 and a JSON list. An empty list is valid. Each row has string `trace_id`, a `label` key, and `steps` of `{tool, args, result}`. |
| `test_evasion_specimens_shape_and_operator_text` | 1 | `POST /api/evasion/specimens` with `Ignore` is 200. Original echoes the text and has a score in `[0, 1]`, a boolean `flagged`, and string lists for categories and signals. Five variants, in operator order `leet`, `space_out`, `homoglyph`, `char_reverse`, `zero_width`, with the spec's exact texts. `slipped` is true only when the original is flagged and that variant is not. |
| `test_evasion_specimens_blank_is_422` | 2 | `""` and mixed ASCII whitespace each return **422**. |
| `test_evasion_ledger_demo_set_aggregates` | 1 | `GET /api/evasion/ledger` is 200 with `scope` `demo-set`. `prompts` matches the demo API. `variants_generated` is `prompts * 5`. `variants_from_flagged` is `originals_flagged * 5`, and `bypassed` is within that count. `bypass_rate` is `bypassed / variants_from_flagged`, or null for a zero denominator. The five operator rows are in specimen order, with bypass counts that sum to `bypassed`. |

Choices the spec does not settle are marked in `test_api_contract.py` with `# SPEC-AMBIGUOUS:`. Search that token before treating a failure as an obvious server bug.

```bash
grep -n SPEC-AMBIGUOUS contract-tests/test_api_contract.py
```

## Marker

`requires_server` is registered in `conftest.py` and applied to the whole module. Select it with:

```bash
python -m pytest contract-tests -q -m requires_server
```

There are no tests in this directory without the marker. `-m "not requires_server"` collects nothing.
