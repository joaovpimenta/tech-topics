#!/usr/bin/env python3
"""Enumera interseções de quóruns e calcula disponibilidade binomial."""
from itertools import combinations
from math import comb


def disponibilidade(n: int, q: int, p: float) -> float:
    return sum(comb(n, k) * p**k * (1 - p) ** (n - k) for k in range(q, n + 1))


def analisar(n: int, r: int, w: int) -> None:
    replicas = tuple(chr(ord("A") + i) for i in range(n))
    leituras = list(combinations(replicas, r))
    escritas = list(combinations(replicas, w))
    menor = min(len(set(a) & set(b)) for a in leituras for b in escritas)
    disjuntos = sum(not (set(a) & set(b)) for a in leituras for b in escritas)
    print(f"N={n}, R={r}, W={w}: interseção mínima={menor}; pares disjuntos={disjuntos}")


if __name__ == "__main__":
    analisar(5, 3, 3)
    analisar(5, 2, 3)
    analisar(5, 2, 2)
    print("\nN=5, disponibilidade independente por réplica p=95%")
    for q in range(1, 6):
        print(f"q={q}: {100 * disponibilidade(5, q, 0.95):.8f}%")
