#!/usr/bin/env python3
"""Compara fila ilimitada e admissão limitada em uma simulação determinística."""

from collections import deque

STEP_SECONDS = 0.01
SERVICE_PER_STEP = 1
DEADLINE_SECONDS = 0.5
QUEUE_LIMIT = 25
TOTAL_SECONDS = 30


def arrival_rate(second):
    if second < 5:
        return 80
    if second < 20:
        return 180
    return 80


def simulate(queue_limit=None):
    queue = deque()
    arrival_credit = 0.0
    arrived = accepted = rejected = completed = useful = 0
    max_queue = 0
    latency_sum = 0.0

    for tick in range(int(TOTAL_SECONDS / STEP_SECONDS)):
        now = tick * STEP_SECONDS
        arrival_credit += arrival_rate(now) * STEP_SECONDS

        while arrival_credit >= 1.0:
            arrived += 1
            arrival_credit -= 1.0
            if queue_limit is not None and len(queue) >= queue_limit:
                rejected += 1
            else:
                queue.append(now)
                accepted += 1

        for _ in range(SERVICE_PER_STEP):
            if not queue:
                break
            entered = queue.popleft()
            latency = now + STEP_SECONDS - entered
            completed += 1
            latency_sum += latency
            if latency <= DEADLINE_SECONDS:
                useful += 1

        max_queue = max(max_queue, len(queue))

    return {
        "arrived": arrived,
        "accepted": accepted,
        "rejected": rejected,
        "completed": completed,
        "useful": useful,
        "expired": completed - useful,
        "remaining": len(queue),
        "max_queue": max_queue,
        "mean_latency_ms": round(1000 * latency_sum / completed, 1),
    }


def print_result(label, result):
    print(label)
    for key, value in result.items():
        print(f"  {key:>16}: {value}")


if __name__ == "__main__":
    print("Modelo: 80 req/s, depois 180 req/s, depois 80 req/s")
    print("Capacidade: 100 req/s; deadline: 500 ms; duração: 30 s\n")
    print_result("Fila ilimitada", simulate())
    print()
    print_result(f"Admissão limitada (fila <= {QUEUE_LIMIT})", simulate(QUEUE_LIMIT))
