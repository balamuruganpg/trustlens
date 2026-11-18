"""Aggregate scores, categories and daily activity across the two histories."""

from collections import Counter
from dataclasses import dataclass

from .db import Database


@dataclass
class Summary:
    total: int = 0
    flagged: int = 0
    avg_score: float = 0.0


@dataclass(frozen=True)
class CategoryCount:
    category: str
    count: int


@dataclass
class Day:
    date: str
    scans: int = 0
    traces: int = 0
    flagged: int = 0


@dataclass(frozen=True)
class Overview:
    scans: Summary
    traces: Summary
    categories: list[CategoryCount]
    trend: list[Day]


def overview(db: Database) -> Overview:
    scans, traces = Summary(), Summary()
    totals = {"scans": scans, "traces": traces}
    scores = {"scans": 0.0, "traces": 0.0}
    categories: Counter[str] = Counter()
    days: dict[str, Day] = {}

    for kind, score, flagged, row_categories, date in db.activity():
        summary = totals[kind]
        summary.total += 1
        summary.flagged += flagged
        scores[kind] += score
        categories.update(set(row_categories))

        day = days.setdefault(date, Day(date))
        day.scans += kind == "scans"
        day.traces += kind == "traces"
        day.flagged += flagged

    for kind, summary in totals.items():
        if summary.total:
            summary.avg_score = scores[kind] / summary.total

    return Overview(
        scans=scans,
        traces=traces,
        categories=[
            CategoryCount(category, count)
            for category, count in sorted(categories.items(), key=lambda item: (-item[1], item[0]))
        ],
        trend=[days[date] for date in sorted(days)],
    )
