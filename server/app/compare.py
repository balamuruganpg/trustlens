"""Paired score comparisons using only the Python standard library."""

import math
import random
import sys
from dataclasses import dataclass
from statistics import mean
from typing import Literal


@dataclass(frozen=True)
class Comparison:
    n: int
    baseline_mean: float
    candidate_mean: float
    mean_diff: float
    ci_low: float
    ci_high: float
    mcnemar_p: float
    gate: Literal["PASS", "FAIL"]


def compare_scores(
    baseline: list[float], candidate: list[float], alpha: float = 0.05
) -> Comparison:
    """Bootstrap candidate minus baseline, paired by list position."""
    n = len(baseline)

    # Scale very large inputs by a power of two to keep the differences and
    # resample sums finite whenever their final means are representable.
    magnitude = max(max(map(abs, baseline)), max(map(abs, candidate)))
    shift = (2 * n).bit_length() if magnitude >= sys.float_info.max / (2 * n) else 0
    pairs = list(zip(baseline, candidate, strict=True))
    diffs = [math.ldexp(after, -shift) - math.ldexp(before, -shift) for before, after in pairs]

    rng = random.Random(13)
    samples = sorted(
        math.fsum(diffs[rng.randrange(n)] for _ in range(n)) / n
        for _ in range(10_000)
    )
    low = math.ldexp(_percentile(samples, alpha / 2), shift)
    high = math.ldexp(_percentile(samples, 1 - alpha / 2), shift)

    baseline_only = sum(before >= 0.5 > after for before, after in pairs)
    candidate_only = sum(after >= 0.5 > before for before, after in pairs)
    return Comparison(
        n=n,
        baseline_mean=mean(baseline),
        candidate_mean=mean(candidate),
        mean_diff=math.ldexp(mean(diffs), shift),
        ci_low=low,
        ci_high=high,
        mcnemar_p=_mcnemar_exact(baseline_only, candidate_only),
        gate="FAIL" if high < 0 else "PASS",
    )


def _percentile(samples: list[float], probability: float) -> float:
    """Interpolate linearly between the enclosing sample ranks."""
    rank = probability * (len(samples) - 1)
    lower = math.floor(rank)
    upper = math.ceil(rank)
    fraction = rank - lower
    return samples[lower] * (1 - fraction) + samples[upper] * fraction


def _mcnemar_exact(baseline_only: int, candidate_only: int) -> float:
    """Two-sided exact binomial test on discordant pairs (score >= 0.5 passes)."""
    if baseline_only == candidate_only:
        return 1.0
    discordant = baseline_only + candidate_only
    coefficient = tail = 1
    for k in range(1, min(baseline_only, candidate_only) + 1):
        coefficient = coefficient * (discordant - k + 1) // k
        tail += coefficient
    return (2 * tail) / (1 << discordant)
