# TrustLens demo datasets

These hand-crafted fixtures contain synthetic text, tool-call records, and scores. Labels describe the expected scanner verdicts for the demo. Trace steps represent recorded actions for inspection.

## Prompts

[`prompts.jsonl`](prompts.jsonl) contains one UTF-8 JSON object per line with `text`, `label`, and `category`. `GET /api/demo/prompts` returns the rows in file order. Submit the `text` field to `POST /api/scan`.

| Label | Category | Count | Coverage |
| --- | --- | ---: | --- |
| `benign` | `null` | 10 | Three everyday requests, three coding questions, and four security discussions |
| `malicious` | `injection` | 8 | Direct override, role-play, an instruction inside a quoted ticket, a Spanish override, a Base64 payload, a fake system turn, prompt extraction, and a concealed approval |
| `malicious` | `pii` | 6 | Two example-domain email addresses, two fictional 555 phone numbers, and two test card numbers |

Security discussion is benign when it describes an attack or asks how to detect it. Injection requires an operative instruction that attempts to override the assistant's instructions, impersonate a trusted message, or extract protected instructions. PII labels indicate that the prompt contains an identifier of a sensitive type, including test values in otherwise routine requests.

## Traces

[`traces.json`](traces.json) contains an array of eight trace objects returned by `GET /api/demo/traces`. Each has a unique `trace_id`, a picker `title`, a `label`, and three to six ordered `steps`. Every step has a string `tool`, an object `args`, and a string `result`. For `POST /api/traces`, wrap `trace_id` and `steps` in a `trace` object.

| Label | Count | Coverage |
| --- | ---: | --- |
| `benign` | 4 | Checkout bug fix with inspected build-directory cleanup, public-source research summary, staging deploy check, and read-only warehouse queries |
| `exfiltration` | 2 | Token read followed by an external webhook POST, and credential-file read followed by a shell `curl` POST |
| `destruction` | 1 | Recursive deletion of protected live ledger data outside the approved cleanup scope |
| `privilege_escalation` | 1 | An agent grants itself admin access and queues a signing-key rotation |

Trace labels describe the ordered sequence and its scope. The checkout cleanup targets generated artifacts after inspection. Exfiltration moves sensitive data outside the trusted environment. Destruction removes protected data, and privilege escalation changes the agent's access to perform a restricted action.

## Comparison

[`comparison.json`](comparison.json) contains a display `name` and 14 paired `baseline` and `candidate` scores on a 0–1 scale. Each position represents the same support triage case in both model versions. The candidate scores lower on four cases, ties nine, and improves one. The mean drops from 0.8414 to 0.8221.

Paste the two score lists into Compare as comma-separated values, or send the two arrays to `POST /api/compare`. Keep both arrays in their original order to preserve the pairing.
