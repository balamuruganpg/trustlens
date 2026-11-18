"""Adapters for the PromptWarden and AgentSentinel scanning APIs."""

from collections.abc import Sequence
from dataclasses import dataclass
from typing import TYPE_CHECKING

try:
    from promptwarden import Warden
except ImportError:
    Warden = None

try:
    from agentsentinel import Sentinel
    from agentsentinel.classifier import extract_features
    from agentsentinel.rules import evaluate_rules, is_destructive, is_send
    from agentsentinel.trace import normalize_trace
except ImportError:
    Sentinel = None

if TYPE_CHECKING:
    from agentsentinel.trace import Step


@dataclass(frozen=True)
class Evidence:
    score: float
    flagged: bool
    categories: tuple[str, ...]
    signals: tuple[str, ...]


@dataclass(frozen=True)
class StepAnnotation:
    index: int
    tool: str
    risk: float
    signals: list[str]


@dataclass(frozen=True)
class TraceEvidence(Evidence):
    steps: list[StepAnnotation]


class EngineUnavailable(RuntimeError):
    pass


def available() -> dict[str, bool]:
    return {"promptwarden": Warden is not None, "agentsentinel": Sentinel is not None}


def scan_prompt(text: str) -> Evidence:
    if Warden is None:
        raise EngineUnavailable("PromptWarden is unavailable")
    report = Warden().scan(text)
    return Evidence(report.score, report.flagged, report.categories, report.signals)


def scan_trace(trace: dict[str, object], tools: list[str]) -> TraceEvidence:
    if Sentinel is None:
        raise EngineUnavailable("AgentSentinel is unavailable")
    report = Sentinel().scan(trace)
    return TraceEvidence(
        report.score,
        report.flagged,
        report.categories,
        report.signals,
        _annotate_trace(trace, tools, report.score, set(report.signals)),
    )


def _annotate_trace(
    trace: dict[str, object], tools: list[str], score: float, signals: set[str]
) -> list[StepAnnotation]:
    """Attribute AgentSentinel evidence to zero-based input steps.

    Replay only rule hits present in the full scan. Attach standalone privilege
    hits and contextual deletion hits to the responsible action. For ordered
    patterns, attach both steps in a replay that reproduces the signal. Omit
    each step in turn as well to find dependencies on more than two steps.

    Classifier tool and family features attach to matching steps, and bigrams
    attach to both adjacent steps. Length features stay at trace level.
    Risk is the largest attributed rule weight or the trace score for
    classifier evidence. A step without local evidence has zero risk.
    """
    if not signals:
        return [StepAnnotation(index, tool, 0.0, []) for index, tool in enumerate(tools)]

    # AgentSentinel skips blank tool names when normalizing. Keep their input
    # positions in the API response, with no evidence assigned to them.
    positions = [index for index, tool in enumerate(tools) if tool.strip()]
    steps = normalize_trace(trace)
    evidence: list[dict[str, float]] = [{} for _ in steps]
    _add_rule_evidence(steps, signals, evidence)

    features = {signal.removeprefix("feature:") for signal in signals if signal.startswith("feature:")}
    if features:
        for index, step in enumerate(steps):
            local = extract_features((step,)) & features
            evidence[index].update(
                (f"feature:{name}", score) for name in local if not name.startswith("length:")
            )
        for index, pair in enumerate(zip(steps, steps[1:])):
            bigrams = {
                f"feature:{name}": score
                for name in extract_features(pair) & features
                if name.startswith("bigram:")
            }
            evidence[index].update(bigrams)
            evidence[index + 1].update(bigrams)

    by_position = dict(zip(positions, evidence, strict=True))
    return [
        StepAnnotation(index, tool, max(local.values(), default=0.0), sorted(local))
        for index, tool in enumerate(tools)
        for local in (by_position.get(index, {}),)
    ]


def _add_rule_evidence(
    steps: "tuple[Step, ...]", signals: set[str], evidence: list[dict[str, float]]
) -> None:
    hits = {hit.signal: hit.weight for hit in evaluate_rules(steps) if hit.signal in signals}
    if not hits:
        return

    destruction = {name for name in hits if name.startswith("destruction:")}
    ordered = {"exfil:read-then-send", "exfil:encoded-payload", "escalation:then-act"} & hits.keys()
    deletes = {index for index, step in enumerate(steps) if is_destructive(step)}
    for index, step in enumerate(steps):
        local = evidence[index]
        if "escalation:privilege-op" in hits:
            local.update(_weights((step,), {"escalation:privilege-op"}))
        if destruction and index in deletes:
            context = tuple(
                other for position, other in enumerate(steps)
                if position == index or position not in deletes
            )
            local.update(_weights(context, destruction))

        if not ordered:
            continue
        remaining = _weights(steps[:index] + steps[index + 1:], ordered)
        local.update((name, hits[name]) for name in ordered if name not in remaining)
        if index in deletes or is_send(step):
            for previous_index, previous in enumerate(steps[:index]):
                shared = _weights((previous, step), ordered)
                local.update(shared)
                evidence[previous_index].update(shared)


def _weights(steps: "Sequence[Step]", selected: set[str]) -> dict[str, float]:
    return {hit.signal: hit.weight for hit in evaluate_rules(steps) if hit.signal in selected}
