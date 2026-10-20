"""Offline tests of Kokoro article preparation (no model or GPU needed)."""

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import kokoro_release
import piper_release
from precommit import article_narration, load_lexicon


class KokoroReleaseTests(unittest.TestCase):
    def test_split_is_bounded_and_does_not_lose_words(self):
        paragraph = ("Frases curtas e claras. " * 30).strip()
        chunks = kokoro_release.split_long(paragraph, max_chars=115)
        self.assertTrue(chunks)
        self.assertTrue(all(0 < len(s) <= 115 for s in chunks))
        self.assertEqual(" ".join(chunks), paragraph)

    def test_paragraph_and_section_pacing_preserves_extractor_text(self):
        article = {
            "slug": "teste",
            "language": "pt-BR",
            "title": "Uma API segura",
            "dek": "Descrição técnica.",
            "bodyHtml": (
                '<nav>Ignorar menu</nav>'
                '<h2>Primeira seção</h2>'
                '<p>Uma API com retries.</p>'
                '<pre>Ignorar código</pre>'
                '<p>Outro parágrafo.</p>'
            ),
        }
        lexicon = {"HTTP": {"lang": "pt-BR", "speak": "agá tê tê pê"}}
        segments = kokoro_release.segments_for_article(article, lexicon)
        spoken = article_narration(article, lexicon)
        self.assertEqual(
            " ".join(x["text"] for x in segments).split(),
            spoken.split(),
        )
        self.assertEqual(segments[0]["pause_after_seconds"], 0.8)
        self.assertEqual(segments[2]["pause_after_seconds"], 0.8)
        self.assertEqual(segments[3]["pause_after_seconds"], 0.45)
        self.assertNotIn("Ignorar", " ".join(x["text"] for x in segments))

    def test_prepare_bounded_preview_and_release_notes(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            article_dir = root / "content" / "articles"
            article_dir.mkdir(parents=True)
            article = {
                "slug": "preview",
                "language": "pt-BR",
                "title": "Narração de API",
                "dek": "Resumo para a abertura.",
                "bodyHtml": "<p>" + "Um serviço de software confiável. " * 90 + "</p>",
            }
            (article_dir / "preview.json").write_text(
                json.dumps(article), encoding="utf-8"
            )
            with patch.object(piper_release, "ARTICLE_DIR", article_dir):
                kokoro_release.prepare("preview", root / "audio", max_chars=300)
            audio_dir = root / "audio"
            segments = json.loads((audio_dir / "preview.segments.json").read_text())
            lines = (audio_dir / "preview.txt").read_text(encoding="utf-8").splitlines()
            self.assertEqual(lines, [x["text"] for x in segments])
            self.assertLessEqual(sum(len(s) for s in lines), 300 + 240)
            self.assertIn("pf_dora", (audio_dir / "preview.md").read_text(encoding="utf-8"))

    def test_ptbr_is_explicit_and_dora_single_voice(self):
        self.assertEqual(kokoro_release.LANG, "pt-br")
        self.assertEqual(kokoro_release.VOICE, "pf_dora")
        self.assertEqual(kokoro_release.SPEED, 0.95)


if __name__ == "__main__":
    unittest.main()
