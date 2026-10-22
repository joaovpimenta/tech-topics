#!/usr/bin/env python3
"""Experimento didático de hedged requests usando apenas a biblioteca padrão."""

from __future__ import annotations

import argparse
import math
import random
from dataclasses import dataclass


def percentile(values: list[float], p: float) -> float:
    if not values:
        raise ValueError("empty sample")
    ordered = sorted(values)
    if len(ordered) == 1:
        return ordered[0]
    position = (len(ordered) - 1) * p
    lower = math.floor(position)
    upper = math.ceil(position)
    if lower == upper:
        return ordered[lower]
    weight = position - lower
    return ordered[lower] * (1 - weight) + ordered[upper] * weight


def replica_latency_ms(rng: random.Random, shared_slowdown_ms: float = 0.0) -> float:
    # Corpo rápido, com uma pequena cauda lenta. O choque compartilhado modela
    # correlação entre réplicas: quando cresce, hedging ajuda menos.
    latency = max(1.0, rng.gauss(22.0, 4.0))
    if rng.random() < 0.025:
        latency += rng.expovariate(1 / 260.0)
    return latency + shared_slowdown_ms


@dataclass
class Result:
    latency_ms: float
    attempts: int
    hedge_won: bool


def simulate_one(rng: random.Random, hedge_delay_ms: float, correlated_tail: float) -> Result:
    shared_slowdown = 0.0
    if rng.random() < correlated_tail:
        shared_slowdown = rng.expovariate(1 / 180.0)

    primary = replica_latency_ms(rng, shared_slowdown)
    if primary <= hedge_delay_ms:
        return Result(primary, 1, False)

    hedge = replica_latency_ms(rng, shared_slowdown)
    hedge_finish = hedge_delay_ms + hedge
    finish = min(primary, hedge_finish)
    return Result(finish, 2, hedge_finish < primary)


def summarize(label: str, values: list[float]) -> None:
    print(
        f"{label:12s}"
        f" p50={percentile(values, 0.50):7.1f} ms"
        f" p95={percentile(values, 0.95):7.1f} ms"
        f" p99={percentile(values, 0.99):7.1f} ms"
        f" p99.9={percentile(values, 0.999):7.1f} ms"
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--requests", type=int, default=100_000)
    parser.add_argument("--delay-percentile", type=float, default=0.95)
    parser.add_argument(
        "--correlated-tail",
        type=float,
        default=0.0,
        help="probabilidade de um atraso compartilhado pelas duas réplicas, entre 0 e 1",
    )
    parser.add_argument("--seed", type=int, default=7)
    args = parser.parse_args()

    if args.requests < 100:
        raise SystemExit("--requests deve ser >= 100")
    if not 0 < args.delay_percentile < 1:
        raise SystemExit("--delay-percentile deve estar entre 0 e 1")
    if not 0 <= args.correlated_tail <= 1:
        raise SystemExit("--correlated-tail deve estar entre 0 e 1")

    warmup_rng = random.Random(args.seed)
    warmup = [replica_latency_ms(warmup_rng) for _ in range(30_000)]
    hedge_delay_ms = percentile(warmup, args.delay_percentile)

    baseline_rng = random.Random(args.seed + 1)
    baseline = [
        replica_latency_ms(
            baseline_rng,
            baseline_rng.expovariate(1 / 180.0)
            if baseline_rng.random() < args.correlated_tail
            else 0.0,
        )
        for _ in range(args.requests)
    ]

    hedged_rng = random.Random(args.seed + 2)
    hedged = [
        simulate_one(hedged_rng, hedge_delay_ms, args.correlated_tail)
        for _ in range(args.requests)
    ]

    hedged_latency = [item.latency_ms for item in hedged]
    hedge_count = sum(item.attempts == 2 for item in hedged)
    hedge_wins = sum(item.hedge_won for item in hedged)

    print(
        f"delay={hedge_delay_ms:.1f} ms "
        f"(percentil {args.delay_percentile:.3f} da amostra de aquecimento)"
    )
    summarize("sem hedge", baseline)
    summarize("com hedge", hedged_latency)
    print(
        f"hedge_rate={hedge_count / args.requests:.2%} "
        f"attempt_multiplier={(args.requests + hedge_count) / args.requests:.3f}x "
        f"hedge_win_rate={(hedge_wins / hedge_count if hedge_count else 0):.2%}"
    )


if __name__ == "__main__":
    main()
