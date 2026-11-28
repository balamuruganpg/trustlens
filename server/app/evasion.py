"""Evasion Lab measurements against the vendored PromptWarden engine.

Specimens and the ledger are computed on request and are not stored.
A bypass is a variant whose original scan was flagged and whose own scan
was clear. Only variants of flagged originals enter the denominator.
The ledger measures the shipped demo prompts.
"""

from dataclasses import dataclass

from . import demo_data, engines
from .mutations import OPERATOR_NAMES, mutate

SCOPE = "demo-set"


@dataclass(frozen=True)
class SpecimenScan:
    text: str
    score: float
    flagged: bool
    categories: list[str]
    signals: list[str]


@dataclass(frozen=True)
class VariantSpecimen:
    operator: str
    text: str
    score: float
    flagged: bool
    categories: list[str]
    signals: list[str]
    slipped: bool


@dataclass(frozen=True)
class Specimens:
    original: SpecimenScan
    variants: list[VariantSpecimen]


@dataclass(frozen=True)
class OperatorLedger:
    operator: str
    variants: int
    bypassed: int
    bypass_rate: float | None


@dataclass(frozen=True)
class Ledger:
    scope: str
    prompts: int
    originals_flagged: int
    variants_generated: int
    variants_from_flagged: int
    bypassed: int
    bypass_rate: float | None
    operators: list[OperatorLedger]


def _view(text: str, report: engines.Evidence) -> SpecimenScan:
    return SpecimenScan(
        text,
        report.score,
        report.flagged,
        list(report.categories),
        list(report.signals),
    )


def _rate(bypassed: int, variants: int) -> float | None:
    if variants == 0:
        return None
    return bypassed / variants


def _prompt_texts() -> list[str]:
    texts: list[str] = []
    for row in demo_data.prompts():
        text = row.get("text")
        if isinstance(text, str) and text.strip():
            texts.append(text)
    return texts


def specimens(text: str) -> Specimens:
    """Scan ``text`` and one variant for each operator, in ledger order."""
    original = engines.scan_prompt(text)
    variants: list[VariantSpecimen] = []
    for name in OPERATOR_NAMES:
        mutated = mutate(text, name)
        report = engines.scan_prompt(mutated)
        variants.append(
            VariantSpecimen(
                name,
                mutated,
                report.score,
                report.flagged,
                list(report.categories),
                list(report.signals),
                original.flagged and not report.flagged,
            )
        )
    return Specimens(_view(text, original), variants)


def ledger() -> Ledger:
    """Scan every demo row and count bypasses of flagged originals."""
    texts = _prompt_texts()
    flagged = 0
    bypassed_by_operator = dict.fromkeys(OPERATOR_NAMES, 0)
    for text in texts:
        result = specimens(text)
        flagged += int(result.original.flagged)
        for variant in result.variants:
            bypassed_by_operator[variant.operator] += int(variant.slipped)

    operators = [
        OperatorLedger(
            name,
            flagged,
            bypassed_by_operator[name],
            _rate(bypassed_by_operator[name], flagged),
        )
        for name in OPERATOR_NAMES
    ]
    variants_from_flagged = flagged * len(OPERATOR_NAMES)
    bypassed = sum(bypassed_by_operator.values())
    return Ledger(
        scope=SCOPE,
        prompts=len(texts),
        originals_flagged=flagged,
        variants_generated=len(texts) * len(OPERATOR_NAMES),
        variants_from_flagged=variants_from_flagged,
        bypassed=bypassed,
        bypass_rate=_rate(bypassed, variants_from_flagged),
        operators=operators,
    )
