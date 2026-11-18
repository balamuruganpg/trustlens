# Server tests

From the repository root, with the server virtualenv set up and both engines installed:

```bash
cd server && .venv/bin/python -m pytest tests/ -q
```

The suite runs the real PromptWarden and AgentSentinel engines through FastAPI's TestClient. It sets `TRUSTLENS_DB` to a temporary SQLite file before importing the app and clears the test histories between cases.
