"""Adapters for the PromptWarden and AgentSentinel scanning APIs."""

import math
from collections.abc import Sequence
from dataclasses import dataclass
from itertools import pairwise
from typing import TYPE_CHECKING, Any

try:
    from promptwarden import Warden
except ImportError:
    Warden = None

try:
    from agentsentinel import Sentinel
    from agentsentinel._shell import (
        SHELL_TOOLS,
        ShellScope,
        activate_scope,
        restore_scope,
        shell_directory_after,
    )
    from agentsentinel.classifier import extract_features
    from agentsentinel.rules import (
        _SECRET_BLOB_MAX,
        _SECRET_BLOB_MIN,
        READ_TOOLS,
        _directory_for_step,
        _path_candidates,
        _remember_sensitive,
        _sensitive_read,
        _shell_sensitive_operands,
        evaluate_rules,
        is_destructive,
        is_read,
        is_send,
    )
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
    # The public report has one score for the whole trace. Step risk needs the
    # fitted model that produced the classifier half of that score.
    scanner = Sentinel()
    report = scanner.scan(trace)
    return TraceEvidence(
        report.score,
        report.flagged,
        report.categories,
        report.signals,
        _annotate_trace(trace, tools, set(report.signals), scanner._model),
    )


def _annotate_trace(
    trace: dict[str, object],
    tools: list[str],
    signals: set[str],
    model: Any,
) -> list[StepAnnotation]:
    """Attribute AgentSentinel evidence to the input step that produced it.

    Rule signals attach to the steps whose content makes the rule fire, each
    with that rule's weight. A step's rule risk is the sum of those weights,
    capped at 1. An earlier read joins an ordered flow only when that read is
    why the pair fires, or when its content or path is evidence the later
    step uses.

    Classifier ``feature:tool:`` and ``feature:length:`` signals stay on the
    trace. A shared tool name is not evidence that this step caused the
    verdict, so those features do not copy the trace score onto the step.
    ``feature:family:`` and ``feature:bigram:`` are labels on the steps that
    exhibit them. They do not carry the trace score either.

    When the classifier probability is at or above its own threshold, a step
    also receives the drop in that probability from removing the step. Step
    risk is the greater of the rule sum and that drop, capped at 1. A step
    with no local evidence has risk 0.
    """
    if not signals:
        return [StepAnnotation(index, tool, 0.0, []) for index, tool in enumerate(tools)]

    # AgentSentinel skips blank tool names when normalizing. Keep their input
    # positions in the API response, with no evidence assigned to them.
    positions = [index for index, tool in enumerate(tools) if tool.strip()]
    steps = normalize_trace(trace)
    rule_evidence: list[dict[str, float]] = [{} for _ in steps]
    _add_rule_evidence(steps, signals, rule_evidence)
    labels = _feature_labels(steps, signals)
    margins = _classifier_margins(steps, model)

    attributed: list[tuple[float, list[str]]] = []
    for rules, label_names, margin in zip(rule_evidence, labels, margins, strict=True):
        rule_risk = min(1.0, math.fsum(rules.values())) if rules else 0.0
        # The leave-one-out margin measures how much the trace verdict depends
        # on this step's presence, which includes pure sequence effects (an
        # early benign step anchors the bigrams the classifier reads). Margin
        # may amplify a step that carries local evidence; it must not create
        # heat on a step with none, or the Theater pauses on innocent steps.
        if rules or label_names:
            risk = min(1.0, max(rule_risk, margin))
        else:
            risk = rule_risk
        attributed.append((risk, sorted(set(rules) | label_names)))

    by_position = dict(zip(positions, attributed, strict=True))
    return [
        StepAnnotation(index, tool, *by_position.get(index, (0.0, [])))
        for index, tool in enumerate(tools)
    ]


def _feature_labels(steps: "tuple[Step, ...]", signals: set[str]) -> list[set[str]]:
    """Family and bigram features the full scan emitted, on the steps that show them."""
    labels: list[set[str]] = [set() for _ in steps]
    wanted: set[str] = set()
    for signal in signals:
        if not signal.startswith("feature:"):
            continue
        name = signal.removeprefix("feature:")
        # Tool-name and length features are properties of the whole trace.
        # Copying them onto every matching step is what smears the trace score.
        if name.startswith(("tool:", "length:")):
            continue
        wanted.add(name)
    if not wanted or not steps:
        return labels
    for index, step in enumerate(steps):
        local = extract_features((step,)) & wanted
        labels[index].update(f"feature:{name}" for name in local if name.startswith("family:"))
    for index, pair in enumerate(pairwise(steps)):
        bigrams = {
            name
            for name in extract_features(pair) & wanted
            if name.startswith("bigram:")
        }
        labels[index].update(f"feature:{name}" for name in bigrams)
        labels[index + 1].update(f"feature:{name}" for name in bigrams)
    return labels


def _classifier_margins(steps: "tuple[Step, ...]", model: Any) -> list[float]:
    """How much each step raises classifier probability, or zeros when it did not fire.

    The value is the drop from removing that step, never the whole-trace score.
    A negative drop (the step was pulling probability down) contributes nothing.
    """
    if not steps:
        return []
    full = float(model.predict_probability(steps))
    threshold = float(model.threshold)
    if full < threshold:
        return [0.0] * len(steps)
    margins: list[float] = []
    for index in range(len(steps)):
        rest = steps[:index] + steps[index + 1 :]
        if not rest:
            margins.append(min(1.0, max(0.0, full)))
            continue
        drop = full - float(model.predict_probability(rest))
        margins.append(min(1.0, max(0.0, drop)))
    return margins


def _add_rule_evidence(
    steps: "tuple[Step, ...]", signals: set[str], evidence: list[dict[str, float]]
) -> None:
    hits = {hit.signal: hit.weight for hit in evaluate_rules(steps) if hit.signal in signals}
    if not hits:
        return

    destruction = {name for name in hits if name.startswith("destruction:")}
    ordered = {"exfil:read-then-send", "exfil:encoded-payload", "escalation:then-act"} & hits.keys()
    deletes = {index for index, step in enumerate(steps) if is_destructive(step)}
    # Same cd and assignment carry as evaluate_rules, so a relative read joins
    # the send that uses that path. Computed before the leave-one-out calls,
    # each of which installs its own scope.
    flow = _flow_evidence(steps) if ordered else ()
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
            # A shell can read a secret and post it in one step, so the pair
            # (earlier, later) fires even when the earlier step contributed
            # nothing. Copy a flow rule onto a previous read only when that
            # read is why the pair fires, or when its content or path is the
            # evidence this step uses.
            alone = _weights((step,), ordered)
            for previous_index, previous in enumerate(steps[:index]):
                shared = _weights((previous, step), ordered)
                local.update(shared)
                if not shared or not is_read(previous):
                    continue
                linked = any(
                    name.startswith("exfil:") and name in alone for name in shared
                ) and _flow_links(flow[previous_index], flow[index], step)
                caused = {
                    name: weight
                    for name, weight in shared.items()
                    if name not in alone or (linked and name.startswith("exfil:"))
                }
                evidence[previous_index].update(caused)


def _weights(steps: "Sequence[Step]", selected: set[str]) -> dict[str, float]:
    return {hit.signal: hit.weight for hit in evaluate_rules(steps) if hit.signal in selected}


@dataclass(frozen=True)
class _FlowEvidence:
    """Path identities and secret text one step contributes to an exfil flow."""

    identities: frozenset[str]
    secret: str


def _flow_evidence(steps: "tuple[Step, ...]") -> tuple[_FlowEvidence, ...]:
    """Evidence ``evaluate_rules`` would remember, under that function's scope.

    ``cd`` and shell assignments carry forward, and a relative path is joined
    the same way. Secret text is kept only for a sensitive read, and only
    inside the blob bounds the rules use for a substring match. A benign
    result that happens to occur inside a later command is not evidence.
    """
    scope = ShellScope()
    token = activate_scope(scope)
    try:
        found: list[_FlowEvidence] = []
        for step in steps:
            reported = next(
                (value for field, value in step.fields if field == "cwd"), ""
            )
            cwd = _directory_for_step(reported, scope)
            if not cwd.startswith("/"):
                cwd = ""
                if not scope.cwd.startswith("/"):
                    scope.cwd = ""
            identities = _sensitive_identities(step, cwd)
            secret = ""
            if _sensitive_read(step, cwd):
                text = step.result.strip()
                if _SECRET_BLOB_MIN <= len(text) <= _SECRET_BLOB_MAX:
                    secret = text
            found.append(_FlowEvidence(frozenset(identities), secret))
            if step.family_name in SHELL_TOOLS:
                scope.cwd = shell_directory_after(step, cwd)
        return tuple(found)
    finally:
        restore_scope(token)


def _sensitive_identities(step: "Step", cwd: str) -> set[str]:
    """Sensitive path identities the exfil rules would remember for this step.

    Shell operands resolve against the active rule scope, so this runs from
    ``_flow_evidence`` while that scope is installed.
    """
    identities: set[str] = set()
    if step.family_name in READ_TOOLS:
        for value in _path_candidates(step):
            _remember_sensitive(value, cwd, step.result, identities)
    for operand in _shell_sensitive_operands(step, cwd):
        _remember_sensitive(operand, cwd, "", identities)
    return identities


def _flow_links(
    earlier: _FlowEvidence, later: _FlowEvidence, later_step: "Step"
) -> bool:
    """True when the earlier read's path or secret text is used by the later step."""
    if earlier.identities and earlier.identities & later.identities:
        return True
    if not earlier.secret:
        return False
    return any(earlier.secret in value for value in later_step.arguments)
