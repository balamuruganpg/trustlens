"""Read the repository's demo data on demand."""

import json
from pathlib import Path
from typing import Any

DEMO_DIR = Path(__file__).resolve().parents[2] / "demo"


def prompts() -> list[dict[str, Any]]:
    try:
        with (DEMO_DIR / "prompts.jsonl").open(encoding="utf-8") as stream:
            return [json.loads(line) for line in stream if line.strip()]
    except FileNotFoundError:
        return []


def traces() -> list[dict[str, Any]]:
    try:
        with (DEMO_DIR / "traces.json").open(encoding="utf-8") as stream:
            return json.load(stream)
    except FileNotFoundError:
        return []
