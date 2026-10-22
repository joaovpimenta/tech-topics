"""Offline tests: code-switching without adding an English narrator or model."""

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import article_selection
import kokoro_release
from precommit import article_narration


class FakeG2P:
    def __init__(self, language):
        self.language = language

    def __call__(self, text):
        return f"<{self.language}:{text}>", None


class KokoroReleaseTests(unittest.TestCase):
    def setUp(self):
        self.lexicon = {
            "HTTP": {"lang": "pt-BR", "speak": "agá tê tê pê"},
            "SRE": {"lang": "pt-BR", "speak": "ésse érre ê"},
        }

    def test_title_and_body_inherit_english_tags(self):
        article = {
            "slug": "bulkhead",
            "language": "pt-BR",
            "title": "Bulkhead: manter o sistema",
            "speechMarkup": {
                "title": [
                    {"text": "Bulkhead", "lang": "en-US"},
                    {"text": ": manter o sistema", "lang": "pt-BR"},
                ]
            },
            "dek": "Sobre o padrão.",
            "bodyHtml": (
                '<p>O padrão <span lang="en-US">Bulkhead</span> evita falhas '
                'e aplica <span lang="en-US">retry budget</span>.</p>'
                '<nav>Ignorar menu</nav><pre>Ignorar código</pre>'
            ),
        }
        segments = kokoro_release.segments_for_article(article, self.lexicon)
        all_runs = [r for s in segments for r in s["runs"]]
        english = [r["text"].strip() for r in all_runs if r["lang"] == "en-us"]
        self.assertEqual(english, ["Bulkhead", "Bulkhead", "retry budget"])
        self.assertTrue(all("Ignore" not in s["text"] for s in segments))
        text = " ".join(s["text"] for s in segments)
        self.assertNotIn("Ignorar menu", text)
        self.assertNotIn("Ignorar código", text)
        self.assertEqual(" ".join(text.split()), " ".join(article_narration(article, self.lexicon).split()))
        # A single sentence has both languages in one Kokoro segment.
        sample = next(s for s in segments if "O padrão" in s["text"])
        self.assertEqual({r["lang"] for r in sample["runs"]}, {"pt-br", "en-us"})

    def test_lexicon_and_explicit_overrides_precede_language(self):
        html = (
            '<p><span lang="en-US">HTTP</span> '
            '<span lang="en-US" data-tts-say="bâlk-héd">Bulkhead</span> '
            '<span lang="en-US" data-tts-mode="spell">API</span> '
            '<span lang="en-US" data-tts-mode="word">REST</span></p>'
        )
        article = {"title": "Teste", "bodyHtml": html}
        runs = [r for s in kokoro_release.segments_for_article(article, self.lexicon)
                for r in s["runs"]]
        result = "".join(r["text"] for r in runs)
        self.assertIn("agá tê tê pê", result)
        self.assertIn("bâlk-héd", result)
        self.assertIn("ay pee eye", result.lower().replace(",", ""))
        self.assertIn("REST", result)
        self.assertTrue(any(r["lang"] == "pt-br" and "agá" in r["text"] for r in runs))
        self.assertTrue(any(r["lang"] == "en-us" and "bâlk" in r["text"] for r in runs))

    def test_phonemizer_switches_languages_without_splitting_sentence_audio(self):
        ph = {"pt-br": FakeG2P("PT"), "en-us": FakeG2P("EN")}
        runs = [
            {"text": "O padrão ", "lang": "pt-br"},
            {"text": "Bulkhead", "lang": "en-us"},
            {"text": " evita falhas.", "lang": "pt-br"},
        ]
        output, english = kokoro_release.phonemize_runs(runs, ph)
        self.assertEqual(output, "<PT:O padrão> <EN:Bulkhead> <PT:evita falhas.>")
        self.assertEqual([s["text"] for s in english], ["Bulkhead"])

    def test_chunking_preserves_spaces_and_languages(self):
        text = "O padrão "
        runs = [
            {"text": text, "lang": "pt-br"},
            {"text": "Bulkhead", "lang": "en-us"},
            {"text": " mantém o isolamento. " * 40, "lang": "pt-br"},
        ]
        parts = kokoro_release.split_runs(runs, max_chars=120)
        self.assertTrue(parts)
        self.assertEqual(
            " ".join("".join(r["text"] for r in p) for p in parts).split(),
            "".join(r["text"] for r in runs).split(),
        )
        self.assertTrue(any(r["lang"] == "en-us" and r["text"].strip() == "Bulkhead"
                            for p in parts for r in p))
        self.assertTrue(all(len("".join(r["text"] for r in p)) <= 120 for p in parts))

    def test_sections_pacing_and_preview(self):
        article = {
            "title": "Uma API segura",
            "dek": "Descrição técnica.",
            "bodyHtml": '<h2>Primeira seção</h2><p>Texto normal.</p>'
                        '<p>' + "Frases curtas e claras. " * 90 + "</p>",
        }
        segments = kokoro_release.segments_for_article(article, self.lexicon, max_chars=300)
        self.assertEqual(segments[0]["pause_after_seconds"], 0.8)
        self.assertEqual(segments[2]["pause_after_seconds"], 0.8)
        self.assertEqual(segments[3]["pause_after_seconds"], 0.45)
        self.assertLessEqual(sum(len(s["text"]) for s in segments), 300 + 240)

    def test_prepare_writes_structured_runs_and_utf8(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            directory = root / "articles"
            directory.mkdir()
            article = {
                "slug": "teste", "language": "pt-BR", "title": "Bulkhead",
                "speechMarkup": {"title": [{"lang": "en-US", "text": "Bulkhead"}]},
                "dek": "A narração funciona.",
                "bodyHtml": '<p>O <span lang="en-US">retry budget</span> importa.</p>',
            }
            (directory / "teste.json").write_text(json.dumps(article), encoding="utf-8")
            with patch.object(article_selection, "ARTICLE_DIR", directory):
                kokoro_release.prepare("teste", root / "output", max_chars=300)
            segments = json.loads((root / "output/teste.segments.json").read_text(encoding="utf-8"))
            self.assertEqual(
                (root / "output/teste.txt").read_text(encoding="utf-8").splitlines(),
                [s["text"] for s in segments],
            )
            self.assertTrue(any(r["lang"] == "en-us" for s in segments for r in s["runs"]))
            self.assertIn("EN-US", (root / "output/teste.md").read_text(encoding="utf-8"))

    def test_voice_speed_and_languages(self):
        self.assertEqual(kokoro_release.VOICE, "pf_dora")
        self.assertEqual(kokoro_release.SPEED, 0.95)
        self.assertEqual((kokoro_release.LANG, kokoro_release.ENGLISH),
                         ("pt-br", "en-us"))


if __name__ == "__main__":
    unittest.main()
