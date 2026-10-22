"""Small deterministic ffprobe summary tests; no Kokoro model required."""

import tempfile
import unittest
from pathlib import Path

import codec_review


class CodecReviewTests(unittest.TestCase):
    def test_same_audio_variants_format_bitrate_and_sizes(self):
        with tempfile.TemporaryDirectory() as root:
            folder = Path(root)
            files = {}
            for name, pattern, codec, bitrate in codec_review.VARIANTS:
                path = folder / pattern.format(slug="bulkhead")
                path.write_bytes(b"x" * 50)
                files[path.name] = {
                    "codec": codec,
                    "sample_rate_hz": 24000,
                    "channels": 1,
                    "bitrate_bps": bitrate or 384000,
                    "duration_seconds": 42.05 if bitrate is not None else 42.0,
                    "bytes": {"mp3-96": 504000, "mp3-128": 672000,
                              "mp3-160": 840000, "wav-lossless": 2016000}[name],
                }
            report = codec_review.collect_review(
                "bulkhead", folder, probe=lambda path: files[path.name]
            )
            self.assertEqual(len(report["variants"]), 4)
            self.assertEqual(report["variants"][0]["size_vs_96_percent"], 100.0)
            self.assertEqual(report["variants"][1]["size_vs_96_percent"], 133.3)
            self.assertIn("128.0 kbps", codec_review.markdown(report))
            self.assertIn("PCM sem perdas", codec_review.markdown(report))

    def test_codec_duration_and_bitrate_mismatch_fails(self):
        with tempfile.TemporaryDirectory() as root:
            folder = Path(root)
            for _, template, _, _ in codec_review.VARIANTS:
                (folder / template.format(slug="bulkhead")).write_bytes(b"data")
            def bad_duration(path):
                return {
                    "codec": "pcm_s16le" if path.suffix == ".wav" else "mp3",
                    "sample_rate_hz": 24000,
                    "channels": 1,
                    "duration_seconds": 43.0 if path.suffix == ".wav" else 40.0,
                    "bitrate_bps": 384000 if path.suffix == ".wav" else
                                   (160000 if "160" in path.name else
                                    128000 if "128" in path.name else 96000),
                    "bytes": 10000,
                }
            with self.assertRaisesRegex(ValueError, "duration"):
                codec_review.collect_review("bulkhead", folder, probe=bad_duration)

    def test_missing_asset_fails_before_probe(self):
        with tempfile.TemporaryDirectory() as root:
            with self.assertRaisesRegex(ValueError, "Missing audio variant"):
                codec_review.collect_review("bulkhead", Path(root))


if __name__ == "__main__":
    unittest.main()
