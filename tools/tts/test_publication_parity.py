"""The publication audit fails closed without generating audio."""
import importlib.util
from pathlib import Path
import unittest

path = Path(__file__).resolve().parents[2] / "scripts/audit-publication-parity.py"
spec = importlib.util.spec_from_file_location("publication_parity", path)
parity = importlib.util.module_from_spec(spec)
spec.loader.exec_module(parity)


class PublicationParityTests(unittest.TestCase):
    def test_compares_all_common_slugs_and_allows_new_articles(self):
        original = {"clone": [1, 2], "mounted": [1, 2]}
        self.assertEqual(parity.compare_records({"a": original}, {"a": original, "b": original}),
                         {"compared": 1, "added": ["b"]})
        with self.assertRaisesRegex(ValueError, "removidos"):
            parity.compare_records({"a": original}, {})
        with self.assertRaisesRegex(ValueError, "fala ou mapeamento"):
            parity.compare_records({"a": original}, {"a": {"clone": [2], "mounted": [2]}})
        with self.assertRaisesRegex(ValueError, "player montado"):
            parity.compare_records({"a": original}, {"a": {"clone": [1], "mounted": [2]}})

    def test_speech_instrumentation_fails_closed_if_contract_changes(self):
        source = (path.parents[1] / "speech.js").read_text(encoding="utf-8")
        self.assertIn("separatorBefore", parity.instrument_speech(source))
        with self.assertRaisesRegex(ValueError, "instrumentar"):
            parity.instrument_speech("window.TechTopicsSpeech = {}")
