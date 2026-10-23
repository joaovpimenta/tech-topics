"""Model-independent segmentation checks; Python stdlib only."""
import unittest
from segmentation import plan_segments

class SentencePlannerTests(unittest.TestCase):
    @staticmethod
    def measure(runs):
        text = "".join(piece["text"] for piece in runs)
        return len(text.split()), len(text)

    def test_sentence_identity(self):
        text = "Uma frase curta. Outra frase, com vírgula."
        item = {"text": text, "runs": [{"text": text, "lang": "pt-br"}],
                "block_index": 4, "pause_after_seconds": 0.38}
        chunks = plan_segments([item], self.measure)
        self.assertEqual([chunk["sentence_index"] for chunk in chunks], [0, 1])
        self.assertTrue(all(chunk["sentence_start"] for chunk in chunks))

    def test_long_sentence_fragments_have_same_id(self):
        text = ("Capacidade disponível, " * 17).strip() + "."
        item = {"text": text, "runs": [{"text": text, "lang": "pt-br"}],
                "block_index": 2, "pause_after_seconds": 0.38}
        parts = plan_segments([item], self.measure, max_tokens=12,
                              target_tokens=10, max_phonemes=95)
        self.assertGreater(len(parts), 2)
        self.assertEqual({part["sentence_index"] for part in parts}, {0})
        self.assertEqual(sum(bool(part["sentence_start"]) for part in parts), 1)
        self.assertTrue(all(part["token_count"] <= 12 and part["phoneme_length"] <= 95
                            for part in parts))
        self.assertTrue(all(part["pause_after_seconds"] == 0.025 for part in parts[:-1]))

if __name__ == "__main__":
    unittest.main()
