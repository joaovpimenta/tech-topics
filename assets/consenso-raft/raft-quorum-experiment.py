#!/usr/bin/env python3
"""Experimento determinístico sobre quórum, eleição e commit em Raft."""

from dataclasses import dataclass


@dataclass(frozen=True)
class LogTip:
    last_term: int
    last_index: int


def majority(cluster_size: int) -> int:
    return cluster_size // 2 + 1


def is_up_to_date(candidate: LogTip, voter: LogTip) -> bool:
    """Regra do RequestVote: termo final primeiro; índice desempata."""
    return (candidate.last_term, candidate.last_index) >= (
        voter.last_term,
        voter.last_index,
    )


def can_elect(votes: int, cluster_size: int) -> bool:
    return votes >= majority(cluster_size)


def can_commit(acks: int, cluster_size: int) -> bool:
    return acks >= majority(cluster_size)


def main() -> None:
    cluster_size = 5
    quorum = majority(cluster_size)
    print(f"cluster={cluster_size}, maioria={quorum}")

    # A, B e C guardam uma entrada criada no termo 4; D e E ainda terminam no termo 3.
    tips = {
        "A": LogTip(4, 8),
        "B": LogTip(4, 8),
        "C": LogTip(4, 8),
        "D": LogTip(3, 9),
        "E": LogTip(3, 9),
    }

    stale_candidate = tips["D"]
    votes_for_d = sum(is_up_to_date(stale_candidate, tip) for tip in tips.values())
    print(f"D pede votos com ponta {stale_candidate}: {votes_for_d} votos")
    print(f"D pode virar líder? {can_elect(votes_for_d, cluster_size)}")

    current_candidate = tips["A"]
    votes_for_a = sum(is_up_to_date(current_candidate, tip) for tip in tips.values())
    print(f"A pede votos com ponta {current_candidate}: {votes_for_a} votos")
    print(f"A pode virar líder? {can_elect(votes_for_a, cluster_size)}")

    majority_partition = {"A", "B", "C"}
    minority_partition = {"D", "E"}
    print(
        "partição A-B-C pode confirmar entrada?",
        can_commit(len(majority_partition), cluster_size),
    )
    print(
        "partição D-E pode confirmar entrada?",
        can_commit(len(minority_partition), cluster_size),
    )

    # Interseção: quaisquer duas maiorias de 3 em um universo de 5 compartilham um nó.
    other_majority = {"C", "D", "E"}
    print("interseção entre maiorias:", majority_partition & other_majority)


if __name__ == "__main__":
    main()
