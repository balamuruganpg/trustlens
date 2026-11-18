# Screenshot plan

The root README embeds the Inspection Theater. The files it uses:

1. `docs/demo-replay.gif` — Replay Theater, playback freezing on the catch
2. `docs/screenshots/replay-theater.png` — Replay Theater held on the catch: the step, the incident card, the data-flow ribbon
3. `docs/screenshots/case-files.png` — Case Files on pure black, each case leading with its story
4. `docs/screenshots/dissection.png` — Dissection, the risky clause marked, evidence beside it
5. `docs/screenshots/compare.png` — Compare, gate FAIL, bootstrap CI, McNemar p
6. `docs/screenshots/case-files-light.png` — Case Files in the pure white light theme

Capture them from a running app (`docs/integration-checklist.md`). Take them **before** `contract-tests/`, or point the server at a fresh database first. The contract suite inserts its own scans and traces, and those rows show up as stored cases.

Every number in a shot comes from the API response or from the demo files. Do not edit digits in an image tool, and do not stage a mock JSON file in the browser.

## Framing

- Desktop window, **1440×900**.
- Left nav expanded. The labels are **Case Files**, **Replay Theater**, **Dissection**, **Compare**, and **Evasion Lab** (`/evasion`). Wait for the first demo specimen and its five variant cards. Capture the tray with the original verdict, variant stamps, and scores. Scroll to the robustness ledger for the shipped demo counts and bypass rate. Use the live `POST /api/evasion/specimens` and `GET /api/evasion/ledger` responses for captions.
- Default theme is pure black (`#000000`). One shot, Case Files, is the pure white (`#ffffff`) theme from the shell toggle.
- Wait until loading indicators have cleared. If an error banner is up, fix the cause and shoot again.

If `GET /api/demo/prompts` or `GET /api/demo/traces` is `[]`, stop. A missing demo file returns an empty list, and an empty picker cannot supply the demo cases. Put the demo files in place and shoot again.

## What each page shows

**Case Files** (`/`). Slim strip of scan and trace totals, flagged counts, and category counts from `GET /api/insights/overview`. Intake block. Demo cases from the demo endpoints. Stored cases, each leading with its one-line story. Shoot this after a demo prompt and a demo trace exist, so the docket is not empty. There is no category bar chart and no trend chart.

**Replay Theater** (`/traces`). Open a demo trace so the submitted arguments are still in the page (a stored-only open has no arguments, so the data-flow ribbon stays empty). Press play. Playback auto-pauses on the first step whose risk is at least 0.5. The shot shows that step, the incident card, and the ribbon.

**Dissection** (`/scan`). Open a demo prompt that contains more than one clause. The exhibit marks the clause scores from `POST /api/scan`. The verdict and the evidence panel show the API's score, flagged flag, categories, and signals. Do not paste a different string than the demo row you name in the caption.

**Compare** (`/compare`). Run a pair the API marks **FAIL** — the built-in example, or any equal-length lists of at least two finite scores whose CI upper bound is below 0. The shot shows both inputs, the gate badge, the means, the mean difference, the CI, McNemar's p, and the paired-difference chart. Record the p the API returns.

**Evasion Lab** (`/evasion`). Wait for the ledger and the first attack specimen. The shot shows the demo-set plate (originals flagged, variants generated, bypassed, bypass rate) and the original beside variant cards stamped caught or slipped past. The numbers are the live `GET /api/evasion/ledger` and `POST /api/evasion/specimens` bodies. Do not paste corpus percentages into the frame.

Write captions from the JSON: prompt `text`, `label`, and `category`; trace `trace_id` and `label`; compare fields copied from `POST /api/compare`.
