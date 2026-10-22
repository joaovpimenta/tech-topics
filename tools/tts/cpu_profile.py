"""Lightweight sampling of Kokoro CPU-only synthesis. Standard library only.

Samples the current Python process (including ONNX Runtime native threads),
not just the interpreter's GIL thread. CPU use is in *logical-core equivalents*:
1.0 = one CPU running fully busy over an interval.
"""

from __future__ import annotations

import json
import math
import os
import statistics
import threading
import time
from pathlib import Path


def effective_cores() -> dict:
    affinity = len(os.sched_getaffinity(0)) if hasattr(os, "sched_getaffinity") else os.cpu_count() or 1
    quota = None
    try:
        amount, period = Path("/sys/fs/cgroup/cpu.max").read_text().split()[:2]
        if amount != "max":
            quota = int(amount) / int(period)
    except (OSError, ValueError, ZeroDivisionError):
        pass
    allowed = max(0.1, min(float(affinity), quota if quota is not None else float(affinity)))
    return {"cpu_affinity": affinity, "cgroup_quota_cores": quota, "effective_cores": allowed}


def read_kb(path: str, field: str) -> float | None:
    try:
        for line in Path(path).read_text().splitlines():
            if line.startswith(field + ":"):
                return float(line.split()[1]) / 1024
    except (OSError, ValueError, IndexError):
        pass
    return None


def percentile(data: list[float], fraction: float) -> float | None:
    if not data:
        return None
    values = sorted(data)
    position = (len(values) - 1) * fraction
    before = math.floor(position)
    after = math.ceil(position)
    return values[before] * (after - position) + values[after] * (position - before) if before != after else values[before]


def summary(samples: list[dict], cores: dict, elapsed: float) -> dict:
    busy = [row["cpu_budget_pct"] for row in samples if row.get("cpu_budget_pct") is not None]
    rss = [row["process_rss_mb"] for row in samples if row.get("process_rss_mb") is not None]
    return {
        "elapsed_seconds": round(elapsed, 2),
        "sample_count": len(samples),
        "effective_cpu_cores": cores["effective_cores"],
        "mean_cpu_budget_pct": round(statistics.mean(busy), 1) if busy else None,
        "p90_cpu_budget_pct": round(percentile(busy, 0.9), 1) if busy else None,
        "max_process_rss_mb": round(max(rss), 1) if rss else None,
        "potential_headroom_for_parallel_test": (
            len(busy) >= 10 and cores["effective_cores"] >= 2
            and statistics.mean(busy) < 55 and percentile(busy, 0.9) < 75
        ),
        "interpretation": (
            "Indicative only: CPU headroom does not guarantee parallel speedup. "
            "Validate against a serial baseline with identical article, model and runner."
        ),
    }


class CpuSampler:
    def __init__(self, interval: float = 1.0):
        self.interval = interval
        self.cores = effective_cores()
        self.started = time.perf_counter()
        self.samples: list[dict] = []
        self._last_wall = self.started
        self._last_cpu = time.process_time()
        self._halt = threading.Event()
        self._thread: threading.Thread | None = None

    def sample(self) -> None:
        now = time.perf_counter()
        cpu = time.process_time()
        wall_delta = now - self._last_wall
        cpu_delta = cpu - self._last_cpu
        self._last_wall, self._last_cpu = now, cpu
        if wall_delta <= 0:
            return
        cpu_cores = max(0.0, cpu_delta / wall_delta)
        self.samples.append({
            "elapsed_seconds": round(now - self.started, 2),
            "process_cpu_cores": round(cpu_cores, 2),
            "cpu_budget_pct": round(100 * cpu_cores / self.cores["effective_cores"], 1),
            "process_rss_mb": read_kb("/proc/self/status", "VmRSS"),
            "host_mem_available_mb": read_kb("/proc/meminfo", "MemAvailable"),
        })

    def start(self) -> "CpuSampler":
        def run():
            while not self._halt.wait(self.interval):
                self.sample()
        self._thread = threading.Thread(target=run, name="kokoro-cpu-sampler", daemon=True)
        self._thread.start()
        return self

    def stop(self, segment_times: list[dict] | None = None) -> dict:
        self._halt.set()
        if self._thread:
            self._thread.join(timeout=max(2.0, self.interval * 2))
        self.sample()
        elapsed = time.perf_counter() - self.started
        return {
            "schema_version": 1,
            "sample_interval_seconds": self.interval,
            "cpu_limits": self.cores,
            "summary": summary(self.samples, self.cores, elapsed),
            "samples": self.samples,
            "segments": segment_times or [],
        }


def format_markdown(report: dict) -> str:
    stats = report["summary"]
    cores = report["cpu_limits"]
    value = lambda key: "n/a" if stats.get(key) is None else str(stats[key])
    return "\n".join([
        "### Kokoro CPU profiling — execução sequencial",
        f"- CPUs efetivas (afinidade / cgroup): **{cores['effective_cores']}**"
        f" ({cores['cpu_affinity']} / {cores['cgroup_quota_cores'] or 'sem quota'})",
        f"- Tempo observado: **{value('elapsed_seconds')} s**",
        f"- Amostras: **{value('sample_count')}**",
        f"- CPU média no orçamento: **{value('mean_cpu_budget_pct')}%**",
        f"- CPU p90 no orçamento: **{value('p90_cpu_budget_pct')}%**",
        f"- RSS máximo do processo: **{value('max_process_rss_mb')} MiB**",
        f"- Indício de capacidade para um experimento paralelo: **{'sim' if stats['potential_headroom_for_parallel_test'] else 'não demonstrado'}**",
        "",
        "A utilização sozinha não prova ganho de velocidade. O próximo passo é um benchmark "
        "isolado 1x/2x com o mesmo texto, comparando tempo total, memória e qualidade.",
    ])


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("report", type=Path)
    args = parser.parse_args()
    print(format_markdown(json.loads(args.report.read_text(encoding="utf-8"))))
