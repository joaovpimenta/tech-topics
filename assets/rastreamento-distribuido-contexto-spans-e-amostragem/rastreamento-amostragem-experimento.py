#!/usr/bin/env python3
"""Compara amostragem head aleatória e tail baseada no resultado da trace."""

from __future__ import annotations

import random
from dataclasses import dataclass


SEED = 20260923
TOTAL_TRACES = 100_000
HEAD_RATE = 0.05
TAIL_NORMAL_RATE = 0.01
SLOW_THRESHOLD_MS = 1_000


@dataclass(frozen=True)
class Trace:
    duration_ms: int
    error: bool

    @property
    def interesting(self) -> bool:
        return self.error or self.duration_ms >= SLOW_THRESHOLD_MS


def generate_trace(rng: random.Random) -> Trace:
    """Gera uma carga sintética declaradamente ilustrativa e reprodutível."""
    error = rng.random() < 0.008
    slow = rng.random() < 0.012
    if slow:
        duration_ms = rng.randint(SLOW_THRESHOLD_MS, 5_000)
    else:
        duration_ms = rng.randint(20, 350)
    return Trace(duration_ms=duration_ms, error=error)


def percentage(part: int, whole: int) -> float:
    return 100 * part / whole if whole else 0


def main() -> None:
    rng = random.Random(SEED)
    traces = [generate_trace(rng) for _ in range(TOTAL_TRACES)]

    # As duas políticas usam geradores separados para manter o resultado estável.
    head_rng = random.Random(SEED + 1)
    tail_rng = random.Random(SEED + 2)

    head_kept = [trace for trace in traces if head_rng.random() < HEAD_RATE]
    tail_kept = [
        trace
        for trace in traces
        if trace.interesting or tail_rng.random() < TAIL_NORMAL_RATE
    ]

    interesting = sum(trace.interesting for trace in traces)
    head_interesting = sum(trace.interesting for trace in head_kept)
    tail_interesting = sum(trace.interesting for trace in tail_kept)

    print(f"seed={SEED} traces={TOTAL_TRACES}")
    print(f"interessantes={interesting} ({percentage(interesting, TOTAL_TRACES):.2f}%)")
    print(
        "head_5pct: "
        f"mantidas={len(head_kept)} ({percentage(len(head_kept), TOTAL_TRACES):.2f}%), "
        f"interessantes_cobertas={head_interesting}/{interesting} "
        f"({percentage(head_interesting, interesting):.2f}%)"
    )
    print(
        "tail_erros_lentas_mais_1pct_normais: "
        f"mantidas={len(tail_kept)} ({percentage(len(tail_kept), TOTAL_TRACES):.2f}%), "
        f"interessantes_cobertas={tail_interesting}/{interesting} "
        f"({percentage(tail_interesting, interesting):.2f}%)"
    )


if __name__ == "__main__":
    main()
