#!/usr/bin/env python3
"""Compara relógios escalares de Lamport e relógios vetoriais.

O cenário é determinístico e usa apenas a biblioteca padrão.
"""

from dataclasses import dataclass, field


@dataclass
class Process:
    name: str
    index: int
    size: int
    lamport: int = 0
    vector: list[int] = field(init=False)

    def __post_init__(self) -> None:
        self.vector = [0] * self.size

    def local(self, label: str) -> tuple[str, int, tuple[int, ...]]:
        self.lamport += 1
        self.vector[self.index] += 1
        return label, self.lamport, tuple(self.vector)

    def send(self, label: str) -> tuple[str, int, tuple[int, ...]]:
        return self.local(label)

    def receive(
        self, label: str, message_lamport: int, message_vector: tuple[int, ...]
    ) -> tuple[str, int, tuple[int, ...]]:
        self.lamport = max(self.lamport, message_lamport) + 1
        self.vector = [max(a, b) for a, b in zip(self.vector, message_vector)]
        self.vector[self.index] += 1
        return label, self.lamport, tuple(self.vector)


def relation(left: tuple[int, ...], right: tuple[int, ...]) -> str:
    left_before = all(a <= b for a, b in zip(left, right)) and left != right
    right_before = all(b <= a for a, b in zip(left, right)) and left != right
    if left_before:
        return "antes"
    if right_before:
        return "depois"
    return "concorrente"


def show(event: tuple[str, int, tuple[int, ...]]) -> None:
    label, lamport, vector = event
    print(f"{label:20} Lamport={lamport:<2} vetor={list(vector)}")


def main() -> None:
    a = Process("A", 0, 3)
    b = Process("B", 1, 3)
    c = Process("C", 2, 3)

    a1 = a.local("A altera peça")
    a2 = a.send("A envia para B")
    c1 = c.local("C altera em paralelo")
    b1 = b.receive("B recebe de A", a2[1], a2[2])
    b2 = b.local("B finaliza")

    for event in (a1, a2, c1, b1, b2):
        show(event)

    print()
    print(f"A2 -> B1? {relation(a2[2], b1[2]) == 'antes'}")
    print(f"B2 versus C1: {relation(b2[2], c1[2])}")
    print(
        "Lamport ordena B2 e C1 por números, mas essa ordem não prova causalidade; "
        "os vetores permanecem incomparáveis."
    )


if __name__ == "__main__":
    main()
