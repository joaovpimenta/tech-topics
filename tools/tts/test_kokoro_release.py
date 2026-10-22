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

    def test_block_ids_enable_exact_paragraph_timestamps(self):
        article = {
            "title": "Hedged Requests",
            "dek": "Explicação inicial.",
            "bodyHtml": ("<p>" + "Uma frase de teste bem explicada. " * 20
                         + "</p><p>Segundo parágrafo.</p>"),
        }
        segments = kokoro_release.segments_for_article(article, self.lexicon)
        ids = [item["block_index"] for item in segments]
        self.assertEqual(ids[:2], [0, 1])
        self.assertGreater(ids.count(2), 1, "long paragraph must span several synthesis chunks")
        self.assertEqual(ids[-1], 3, "new paragraph gets its own chapter marker")

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

    def test_compare_uses_only_two_body_paragraphs_and_identical_words(self):
        article = {
            "title": "Bulkhead",
            "dek": "Descrição",
            "bodyHtml": (
                '<h2>Uma seção</h2>'
                '<p>O primeiro parágrafo tem <span lang="en-US">Bulkhead</span>. '
                + "Uma frase completa para preservar a pronúncia. " * 10 + '</p>'
                '<p>O segundo parágrafo tem uma explicação longa; '
                + "continua com mais explicações, vírgulas e frases. " * 11 + '</p>'
                '<p>Este terceiro parágrafo NÃO deve ser narrado.</p>'
            ),
        }
        texts = []
        for preset in kokoro_release.NARRATION_PRESETS:
            segments = kokoro_release.segments_for_article(
                article, self.lexicon, preset=preset, first_body_paragraphs=2)
            self.assertEqual(set(s["block_index"] for s in segments), {0, 1})
            self.assertTrue(any(r["lang"] == "en-us" for s in segments for r in s["runs"]))
            narrated = " ".join(" ".join(s["text"] for s in segments).split())
            self.assertNotIn("terceiro", narrated)
            self.assertNotIn("Descrição", narrated)
            texts.append(narrated)
        self.assertEqual(len(set(texts)), 1, "variants must read exactly the same body text")

    def test_adaptive_chunks_preserve_all_words_and_keep_safe_sizes(self):
        runs = [
            {"lang": "pt-br", "text": "O sistema evita falhas. " * 8},
            {"lang": "en-us", "text": "Bulkhead patterns. "},
            {"lang": "pt-br", "text": "As fronteiras preservam os recursos; " * 12},
        ]
        chunks = kokoro_release.split_runs_adaptive(runs)
        self.assertGreater(len(chunks), 2)
        self.assertEqual(
            " ".join("".join(r["text"] for r in chunk) for chunk in chunks).split(),
            "".join(r["text"] for r in runs).split(),
        )
        self.assertTrue(all(len("".join(r["text"] for r in part)) <= 300 for part in chunks))
        self.assertTrue(any(r["lang"] == "en-us" for part in chunks for r in part))
        short = kokoro_release.split_runs_adaptive([{"lang": "pt-br", "text": "Parágrafo curto."}])
        self.assertEqual(len(short), 1)

    def test_presets_keep_dora_and_original_as_unchanged_reference(self):
        names = list(kokoro_release.NARRATION_PRESETS)
        self.assertEqual(names, ["atual", "equilibrado", "fluido"])
        self.assertEqual(kokoro_release.VOICE, "pf_dora")
        current = kokoro_release.NARRATION_PRESETS["atual"]
        self.assertEqual(current["speed"], kokoro_release.SPEED)
        self.assertEqual(current["paragraph_pause"], kokoro_release.PARAGRAPH_PAUSE_SECONDS)
        self.assertEqual(current["chunk_pause"], kokoro_release.CHUNK_PAUSE_SECONDS)
        self.assertFalse(current["adaptive_chunks"])
        self.assertTrue(all(0.5 <= v["speed"] <= 2 for v in kokoro_release.NARRATION_PRESETS.values()))
        self.assertTrue(all(0 <= v["clause_pause"] <= v["sentence_pause"]
                            for v in kokoro_release.NARRATION_PRESETS.values()))

    def test_compare_reuses_engine_and_writes_manifest(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            seen = []
            def fake_prepare(slug, output_dir, **kwargs):
                self.assertEqual(kwargs["first_body_paragraphs"], 2)
                output_dir.mkdir(parents=True)
                seen.append((kwargs["preset"], output_dir))
            def fake_synthesize(slug, output_dir, model, voices, **kwargs):
                self.assertEqual(kwargs["preset"], output_dir.name)
                shared = kwargs["shared_engine"]
                shared.setdefault("kokoro", object())
                self.assertEqual(id(shared), shared_id[0] if shared_id else id(shared))
                if not shared_id:
                    shared_id.append(id(shared))
                (output_dir / f"{slug}.metrics.json").write_text(
                    json.dumps({"audio_seconds": 12.5, "synthesis_seconds": 5.0,
                                "segments": 3}), encoding="utf-8")
            shared_id = []
            with (patch.object(kokoro_release, "prepare", side_effect=fake_prepare),
                  patch.object(kokoro_release, "synthesize", side_effect=fake_synthesize)):
                kokoro_release.compare_presets(
                    "bulkhead", root / "compare", root / "model.onnx", root / "voices.bin")
            manifest = json.loads((root / "compare/comparison.json").read_text(encoding="utf-8"))
            self.assertEqual(manifest["voice"], "pf_dora")
            self.assertEqual(manifest["paragraphs"], 2)
            self.assertEqual([v["name"] for v in manifest["variants"]],
                             ["atual", "equilibrado", "fluido"])
            self.assertEqual(len(seen), 3)

    def test_voice_speed_and_languages(self):
        self.assertEqual(kokoro_release.VOICE, "pf_dora")
        self.assertEqual(kokoro_release.SPEED, 0.95)
        self.assertEqual((kokoro_release.LANG, kokoro_release.ENGLISH),
                         ("pt-br", "en-us"))


if __name__ == "__main__":
    unittest.main()
