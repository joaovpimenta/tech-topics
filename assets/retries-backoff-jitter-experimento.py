#!/usr/bin/env python3
"""Compara ondas sincronizadas e full jitter com uma simulação reproduzível."""
from collections import Counter
import random

CLIENTS = 1_000
CAPS_SECONDS = (1.0, 2.0, 4.0)
BIN_SECONDS = 0.5
SEED = 20_260_915


def schedule(with_jitter: bool) -> list[float]:
    random.seed(SEED)
    times = []
    for _ in range(CLIENTS):
        elapsed = 0.0
        for cap in CAPS_SECONDS:
            elapsed += random.uniform(0, cap) if with_jitter else cap
            times.append(elapsed)
    return times


def histogram(times: list[float]) -> Counter[int]:
    return Counter(int(t / BIN_SECONDS) for t in times)


if __name__ == "__main__":
    for name, jitter in (("sem jitter", False), ("full jitter", True)):
        bins = histogram(schedule(jitter))
        print(f"\n{name}: pico={max(bins.values())} tentativas/500ms")
        for index in range(15):
            start = index * BIN_SECONDS
            print(f"{start:>3.1f}–{start + BIN_SECONDS:>3.1f}s: {bins[index]:4d}")
