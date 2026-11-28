"""Black-box contract tests for the Evasion Lab endpoints.

Assertions are taken from SPEC.md. These tests do not import the app.
"""

from __future__ import annotations

import math
from typing import Any

import pytest
from test_api_contract import (
    api,
    assert_bool,
    assert_int,
    assert_keys,
    assert_object,
    require_json,
    require_status,
)

pytestmark = pytest.mark.requires_server

OPERATORS = ("leet", "space_out", "homoglyph", "char_reverse", "zero_width")
# SPEC examples for the text "Ignore".
IGNORE_VARIANTS = {
    "leet": "1gn0r3",
    "space_out": "I g n o r e",
    "homoglyph": "\u0406gn\u043er\u0435",
    "char_reverse": "erongI",
    "zero_width": "I\u200bg\u200bn\u200bo\u200br\u200be",
}
SPECIMEN_KEYS = ("text", "score", "flagged", "categories", "signals")
VARIANT_KEYS = (*SPECIMEN_KEYS, "operator", "slipped")
LEDGER_KEYS = (
    "scope",
    "prompts",
    "originals_flagged",
    "variants_generated",
    "variants_from_flagged",
    "bypassed",
    "bypass_rate",
    "operators",
)
OPERATOR_LEDGER_KEYS = ("operator", "variants", "bypassed", "bypass_rate")


def _strings(value: object, field: str) -> list[str]:
    assert isinstance(value, list), f"{field} must be a list"
    for index, item in enumerate(value):
        assert isinstance(item, str), f"{field}[{index}] must be a string"
    return value


def _score(value: object, field: str) -> float:
    assert isinstance(value, (int, float)) and not isinstance(value, bool), (
        f"{field} must be a number"
    )
    number = float(value)
    assert math.isfinite(number) and 0.0 <= number <= 1.0, f"{field} must be in [0, 1]"
    return number


def _rate(value: object, field: str, variants: int, bypassed: int) -> None:
    if variants == 0:
        assert value is None, f"{field} must be null when the denominator is 0"
        return
    assert isinstance(value, (int, float)) and not isinstance(value, bool), (
        f"{field} must be a number"
    )
    number = float(value)
    assert math.isfinite(number), f"{field} must be finite"
    assert number == pytest.approx(bypassed / variants), (
        f"{field} must be bypassed / variants"
    )


def test_evasion_specimens_shape_and_operator_text(base_url: str) -> None:
    """POST /api/evasion/specimens returns the original plus one variant each."""
    response = api(base_url, "POST", "/api/evasion/specimens", body={"text": "Ignore"})
    body = assert_object(require_json(response, 200, "POST /api/evasion/specimens"), "specimens")
    original = assert_object(body.get("original"), "original")
    assert_keys(original, SPECIMEN_KEYS, "original")
    assert original["text"] == "Ignore"
    _score(original["score"], "original.score")
    original_flagged = assert_bool(original["flagged"], "original.flagged")
    _strings(original["categories"], "original.categories")
    _strings(original["signals"], "original.signals")

    variants = body.get("variants")
    assert isinstance(variants, list) and len(variants) == len(OPERATORS)
    for index, (name, variant) in enumerate(zip(OPERATORS, variants, strict=True)):
        item = assert_object(variant, f"variants[{index}]")
        assert_keys(item, VARIANT_KEYS, f"variants[{index}]")
        assert item["operator"] == name
        assert item["text"] == IGNORE_VARIANTS[name]
        _score(item["score"], f"variants[{index}].score")
        flagged = assert_bool(item["flagged"], f"variants[{index}].flagged")
        slipped = assert_bool(item["slipped"], f"variants[{index}].slipped")
        assert slipped is (original_flagged and not flagged)
        _strings(item["categories"], f"variants[{index}].categories")
        _strings(item["signals"], f"variants[{index}].signals")


@pytest.mark.parametrize("text", ["", " \t\n"], ids=["empty", "whitespace"])
def test_evasion_specimens_blank_is_422(base_url: str, text: str) -> None:
    response = api(base_url, "POST", "/api/evasion/specimens", body={"text": text})
    require_status(response, 422, "POST /api/evasion/specimens blank")


def test_evasion_ledger_demo_set_aggregates(base_url: str) -> None:
    """GET /api/evasion/ledger is the demo-set plate, with a consistent rate."""
    response = api(base_url, "GET", "/api/evasion/ledger")
    body = assert_object(require_json(response, 200, "GET /api/evasion/ledger"), "ledger")
    assert_keys(body, LEDGER_KEYS, "ledger")
    assert body["scope"] == "demo-set"
    prompts = assert_int(body["prompts"], "prompts")
    originals = assert_int(body["originals_flagged"], "originals_flagged")
    variants_generated = assert_int(body["variants_generated"], "variants_generated")
    eligible = assert_int(body["variants_from_flagged"], "variants_from_flagged")
    bypassed = assert_int(body["bypassed"], "bypassed")
    demo_response = api(base_url, "GET", "/api/demo/prompts")
    demos = require_json(demo_response, 200, "GET /api/demo/prompts")
    assert isinstance(demos, list)
    assert prompts == sum(isinstance(row.get("text"), str) and bool(row["text"].strip()) for row in demos)
    assert prompts >= originals >= 0
    assert variants_generated == prompts * len(OPERATORS)
    assert eligible == originals * len(OPERATORS)
    assert 0 <= bypassed <= eligible
    _rate(body["bypass_rate"], "bypass_rate", eligible, bypassed)

    operators = body["operators"]
    assert isinstance(operators, list) and len(operators) == len(OPERATORS)
    operator_bypassed = 0
    for index, (name, row) in enumerate(zip(OPERATORS, operators, strict=True)):
        item: dict[str, Any] = assert_object(row, f"operators[{index}]")
        assert_keys(item, OPERATOR_LEDGER_KEYS, f"operators[{index}]")
        assert item["operator"] == name
        assert assert_int(item["variants"], f"operators[{index}].variants") == originals
        count = assert_int(item["bypassed"], f"operators[{index}].bypassed")
        assert 0 <= count <= originals
        operator_bypassed += count
        _rate(item["bypass_rate"], f"operators[{index}].bypass_rate", originals, count)
    assert operator_bypassed == bypassed
