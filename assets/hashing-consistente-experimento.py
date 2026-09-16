#!/usr/bin/env python3
"""Experimento determinístico de remapeamento; Python 3, sem dependências."""

from bisect import bisect_left
from collections import Counter
from hashlib import sha256

KEYS = 20_000
VNODES = 256
BEFORE = ("A", "B", "C")
AFTER = ("A", "B", "C", "D")


def h(value: str) -> int:
    return int.from_bytes(sha256(value.encode()).digest()[:8], "big")


def modulo(key: str, nodes: tuple[str, ...]) -> str:
    return nodes[h(key) % len(nodes)]


def make_ring(nodes: tuple[str, ...]) -> tuple[list[int], list[str]]:
    entries = sorted((h(f"{node}:{vnode}"), node) for node in nodes for vnode in range(VNODES))
    return [token for token, _ in entries], [node for _, node in entries]


def ring_owner(key: str, ring: tuple[list[int], list[str]]) -> str:
    tokens, owners = ring
    index = bisect_left(tokens, h(key))
    return owners[index % len(tokens)]


def compare(selector, before, after) -> tuple[int, Counter, Counter]:
    old = [selector(f"key-{i}", before) for i in range(KEYS)]
    new = [selector(f"key-{i}", after) for i in range(KEYS)]
    moved = sum(a != b for a, b in zip(old, new))
    return moved, Counter(old), Counter(new)


mod = compare(modulo, BEFORE, AFTER)
ring_before, ring_after = make_ring(BEFORE), make_ring(AFTER)
ring = compare(ring_owner, ring_before, ring_after)

print(f"chaves={KEYS}; vnodes_por_no={VNODES}")
print(f"modulo: moveram={mod[0]} ({100 * mod[0] / KEYS:.2f}%)")
print(f"anel:   moveram={ring[0]} ({100 * ring[0] / KEYS:.2f}%)")
print("carga do anel antes:", dict(sorted(ring[1].items())))
print("carga do anel depois:", dict(sorted(ring[2].items())))
