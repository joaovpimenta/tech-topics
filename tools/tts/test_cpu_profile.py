"""Fast and model-free checks for CPU/RSS profiling and parallelism evidence."""

import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

from cpu_profile import CpuSampler, format_markdown, percentile, read_kb, summary, sparkline


class CpuProfileTests(unittest.TestCase):
    def test_percentile_and_resource_reader(self):
        self.assertIsNone(percentile([], 0.9))
        self.assertEqual(percentile([2.5], 0.9), 2.5)
        self.assertEqual(percentile([1, 2, 3, 4, 5], 0.9), 4.6)
        with tempfile.TemporaryDirectory() as dirname:
            path = Path(dirname) / "status"
            path.write_text("Name: python\nVmRSS: 1048576 kB\n", encoding="utf-8")
            self.assertEqual(read_kb(str(path), "VmRSS"), 1024)
            self.assertIsNone(read_kb(str(path), "NotPresent"))

    def test_headroom_only_proposed_with_consistent_evidence(self):
        cores = {"cpu_affinity": 4, "cgroup_quota_cores": 4, "effective_cores": 4.0}
        light = [{"cpu_budget_pct": 30, "process_rss_mb": 200} for _ in range(15)]
        stats = summary(light, cores, 10.25)
        self.assertTrue(stats["potential_headroom_for_parallel_test"])
        self.assertEqual(stats["mean_cpu_budget_pct"], 30)
        self.assertEqual(stats["max_process_rss_mb"], 200)
        self.assertFalse(summary(light[:3], cores, 0.25)["potential_headroom_for_parallel_test"])
        self.assertFalse(summary([{"cpu_budget_pct": 95, "process_rss_mb": 200} for _ in light],
                                 cores, 10)["potential_headroom_for_parallel_test"])
        self.assertFalse(summary(light, {**cores, "effective_cores": 1.0}, 10)
                         ["potential_headroom_for_parallel_test"])
        self.assertIn("paralelo", format_markdown({
            "summary": stats, "cpu_limits": cores,
        }))

    def test_cpu_timeline_is_readable_and_bounded(self):
        self.assertEqual(sparkline([], "cpu_budget_pct"), "Sem amostras")
        samples = [{"cpu_budget_pct": i * 5} for i in range(21)]
        graph = sparkline(samples, "cpu_budget_pct", max_points=10)
        self.assertEqual(len(graph), 10)
        self.assertEqual(graph[-1], "█")

    def test_sampler_collects_native_cpu_time_without_tts_dependencies(self):
        sampler = CpuSampler(interval=0.025).start()
        deadline = time.perf_counter() + 0.15
        while time.perf_counter() < deadline:
            pass
        report = sampler.stop([{"segment": 1, "inference_seconds": 0.15}])
        self.assertGreaterEqual(report["summary"]["sample_count"], 2)
        self.assertGreaterEqual(report["cpu_limits"]["effective_cores"], 0.1)
        self.assertEqual(report["segments"][0]["segment"], 1)
        self.assertTrue(all(row["cpu_budget_pct"] >= 0 for row in report["samples"]))


if __name__ == "__main__":
    unittest.main()
