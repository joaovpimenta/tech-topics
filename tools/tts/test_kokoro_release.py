"""Offline tests: code-switching without adding an English narrator or model."""

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import article_selection
import kokoro_release
from narration_text import article_narration


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


    def test_phonemizer_ignores_unspoken_punctuation_between_languages(self):
        class BlankPunctuationG2P(FakeG2P):
            def __call__(self, text):
                if not any(character.isalnum() for character in text):
                    return "", None
                return super().__call__(text)

        ph = {"pt-br": BlankPunctuationG2P("PT"),
              "en-us": BlankPunctuationG2P("EN")}
        for separator in ("/", " /", " / ", "—", " | "):
            with self.subTest(separator=separator):
                runs = [
                    {"text": "Backoff", "lang": "en-us"},
                    {"text": separator, "lang": "pt-br"},
                    {"text": " jitter.", "lang": "en-us"},
                ]
                phonemes, english = kokoro_release.phonemize_runs(runs, ph)
                self.assertEqual(phonemes, "<EN:Backoff> <EN:jitter.>")
                self.assertEqual([item["text"] for item in english], ["Backoff", "jitter."])

        class WordTokenizer:
            @staticmethod
            def tokenize(phonemes, limit=None):
                return phonemes.split()
        original = "Backoff / jitter."
        segment = {
            "text": original,
            "runs": [
                {"text": "Backoff", "lang": "en-us"},
                {"text": " /", "lang": "pt-br"},
                {"text": " jitter.", "lang": "en-us"},
            ],
            "block_index": 12,
            "pause_after_seconds": 0.38,
        }
        chunks = kokoro_release.fit_segments_to_phoneme_budget(
            [segment], ph, WordTokenizer())
        self.assertEqual(len(chunks), 1)
        self.assertEqual(chunks[0]["text"], original)
        self.assertEqual((chunks[0]["block_index"], chunks[0]["sentence_index"]), (12, 0))

    def test_phonemizer_still_rejects_empty_phonemes_for_words(self):
        class UnpronounceableWordG2P:
            def __call__(self, text):
                return "", None

        with self.assertRaisesRegex(ValueError, "Fonemização vazia"):
            kokoro_release.phonemize_runs(
                [{"text": "palavra", "lang": "pt-br"}],
                {"pt-br": UnpronounceableWordG2P()})

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

    def test_compare_uses_title_and_first_metaphor_paragraph_with_identical_words(self):
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
                article, self.lexicon, preset=preset, first_body_paragraphs=1, sentence_aware=True)
            self.assertEqual(set(s["block_index"] for s in segments), {0, 1})
            self.assertTrue(segments[0]["text"].startswith("Bulkhead"))
            self.assertTrue(any(r["lang"] == "en-us" for s in segments for r in s["runs"]))
            narrated = " ".join(" ".join(s["text"] for s in segments).split())
            self.assertNotIn("terceiro", narrated)
            self.assertNotIn("segundo parágrafo", narrated)
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
        self.assertTrue(all(len("".join(r["text"] for r in part)) <= 320 for part in chunks))
        self.assertTrue(any(r["lang"] == "en-us" for part in chunks for r in part))
        short = kokoro_release.split_runs_adaptive([{"lang": "pt-br", "text": "Parágrafo curto."}])
        self.assertEqual(len(short), 1)

    def test_sentence_first_and_comma_breaks_under_320_characters(self):
        # This reproduces a long first sentence in Bulkhead: comma pauses
        # are legitimate, but a forced break at "a porta pesada" is not.
        long_sentence = (
            "No corredor de manutenção de uma balsa, uma passageira vê, "
            "através de uma janela de vidro reforçado, água invadindo uma "
            "sala de máquinas, e pergunta por que o tripulante está "
            "apertando a roda de uma porta pesada já fechada em vez de "
            "tentar entrar; ele termina de vedar a porta e explica que "
            "a ideia é perder aquele compartimento para manter o resto seco."
        )
        short_sentence = "Ela entende o motivo da separação."
        runs = [{"text": long_sentence + " " + short_sentence, "lang": "pt-br"}]
        chunks = kokoro_release.split_runs_adaptive(runs)
        parts = ["".join(item["text"] for item in chunk) for chunk in chunks]
        self.assertGreater(len(parts), 2)
        self.assertTrue(all(len(part) <= 320 for part in parts))
        self.assertEqual(" ".join(" ".join(parts).split()),
                         " ".join((long_sentence + " " + short_sentence).split()))
        self.assertEqual(parts[-1], short_sentence, "short complete sentences must stand alone")
        for part in parts[:-2]:
            self.assertIn(part.rstrip()[-1], ",;:", "long sentence should end on clause punctuation")

    def test_long_sentence_without_comma_falls_back_to_word_boundary(self):
        text = " ".join(["isolamento"] * 54) + "."
        runs = [{"text": text, "lang": "pt-br"}]
        chunks = kokoro_release.split_runs_adaptive(runs)
        self.assertTrue(all(len("".join(r["text"] for r in c)) <= 320 for c in chunks))
        self.assertEqual(" ".join(" ".join(r["text"] for r in c) for c in chunks).split(),
                         text.split())

    def test_phoneme_token_safety_repartitions_denser_sentences(self):
        class DenseTokenizer:
            @staticmethod
            def tokenize(text, limit=None):
                return list(text)
        item = {
            "text": "Frases técnicas completas, " * 12,
            "block_index": 7,
            "runs": [{"text": "Frases técnicas completas, " * 12, "lang": "pt-br"}],
            "pause_after_seconds": 0.3
        }
        ph = {"pt-br": FakeG2P("PT"), "en-us": FakeG2P("EN")}
        result = kokoro_release.fit_segments_to_phoneme_budget(
            [item], ph, DenseTokenizer(), max_tokens=180, target_tokens=140
        )
        self.assertGreater(len(result), 1)
        self.assertEqual({x["block_index"] for x in result}, {7})
        self.assertEqual(" ".join(" ".join(x["text"] for x in result).split()),
                         " ".join(item["text"].split()))
        self.assertEqual(result[-1]["pause_after_seconds"], 0.3)
        self.assertTrue(all(len(kokoro_release.phonemize_runs(x["runs"], ph)[0]) <= 180
                            for x in result))

    def test_token_budget_does_not_care_about_text_character_length(self):
        class WordTokenizer:
            @staticmethod
            def tokenize(phonemes, limit=None):
                return phonemes.split()
        ph = {"pt-br": FakeG2P("PT"), "en-us": FakeG2P("EN")}
        # 392 editorial characters, below the 500-phoneme safeguard,
        # and about 56 tokenizer words: no arbitrary 320-char split.
        sentence = ("Explicação técnica detalhada " * 14).strip() + "."
        item = {
            "text": sentence, "runs": [{"text": sentence, "lang": "pt-br"}],
            "block_index": 3, "pause_after_seconds": 0.38,
        }
        result = kokoro_release.fit_segments_to_phoneme_budget(
            [item], ph, WordTokenizer(), max_tokens=350
        )
        self.assertEqual(len(result), 1)
        self.assertGreater(len(sentence), 320)
        self.assertEqual(result[0]["text"], sentence)

    def test_small_complete_sentences_are_grouped_without_leaving_paragraph(self):
        class WordTokenizer:
            @staticmethod
            def tokenize(phonemes, limit=None):
                return phonemes.split()
        ph = {"pt-br": FakeG2P("PT"), "en-us": FakeG2P("EN")}
        sentence = "Uma frase curta. Outra frase curta. A terceira frase explica o isolamento."
        segments = [
            {"text": sentence, "runs": [{"text": sentence, "lang": "pt-br"}],
             "block_index": 2, "pause_after_seconds": 0.38},
            {"text": "Um novo parágrafo.", "runs": [{"text": "Um novo parágrafo.", "lang": "pt-br"}],
             "block_index": 3, "pause_after_seconds": 0.38},
        ]
        out = kokoro_release.fit_segments_to_phoneme_budget(
            segments, ph, WordTokenizer(), target_tokens=300, max_tokens=350
        )
        self.assertEqual(len(out), 4, "short sentences have individual navigation units")
        self.assertEqual([item["block_index"] for item in out], [2, 2, 2, 3])
        self.assertEqual([item["sentence_index"] for item in out], [0, 1, 2, 0])


    def test_sentence_navigation_keeps_short_sentences_separate(self):
        class WordTokenizer:
            @staticmethod
            def tokenize(phonemes, limit=None):
                return phonemes.split()
        original = "Uma frase curta. Outra frase curta, sem corte. A terceira frase."
        item = {"text": original, "runs": [{"text": original, "lang": "pt-br"}],
                "block_index": 2, "pause_after_seconds": 0.38}
        ph = {"pt-br": FakeG2P("PT"), "en-us": FakeG2P("EN")}
        parts = kokoro_release.fit_segments_to_phoneme_budget(
            [item], ph, WordTokenizer(), target_tokens=300, max_tokens=350)
        self.assertEqual(len(parts), 3)
        self.assertEqual([p["sentence_index"] for p in parts], [0, 1, 2])
        self.assertTrue(all(p["sentence_start"] for p in parts))
        self.assertEqual([p["pause_after_seconds"] for p in parts], [0.14, 0.14, 0.38])

    def test_oversized_sentence_fragments_preserve_one_navigation_id(self):
        class CharacterTokenizer:
            @staticmethod
            def tokenize(phonemes, limit=None):
                return list(phonemes)
        long_sentence = ("Um sistema protege serviços compartilhados, " * 8).strip() + "."
        text = long_sentence + " Depois a operação continua."
        item = {"text": text, "runs": [{"text": text, "lang": "pt-br"}],
                "block_index": 9, "pause_after_seconds": 0.38}
        ph = {"pt-br": FakeG2P("PT"), "en-us": FakeG2P("EN")}
        parts = kokoro_release.fit_segments_to_phoneme_budget(
            [item], ph, CharacterTokenizer(), target_tokens=120, max_tokens=160)
        self.assertGreater(len(parts), 3)
        self.assertEqual(sorted(set(p["sentence_index"] for p in parts)), [0, 1])
        chunks = [p for p in parts if p["sentence_index"] == 0]
        self.assertEqual(sum(bool(p["sentence_start"]) for p in chunks), 1)
        self.assertTrue(all(p["pause_after_seconds"] == 0.025 for p in chunks[:-1]))
        self.assertEqual(chunks[-1]["pause_after_seconds"], 0.14)

    def test_tokenized_long_sentence_prefers_comma_and_25ms_join(self):
        class CharacterTokenizer:
            @staticmethod
            def tokenize(phonemes, limit=None):
                return list(phonemes)
        ph = {"pt-br": FakeG2P("PT"), "en-us": FakeG2P("EN")}
        sentence = (
            "A técnica de isolamento protege recursos compartilhados, "
            "mesmo quando as requisições ficam lentas, "
            "e assim preserva capacidade para o processamento saudável, "
            "evitando que uma falha comprometa todos os serviços."
        )
        item = {
            "text": sentence, "runs": [{"text": sentence, "lang": "pt-br"}],
            "block_index": 7, "pause_after_seconds": 0.38,
        }
        pieces = kokoro_release.fit_segments_to_phoneme_budget(
            [item], ph, CharacterTokenizer(),
            target_tokens=110, max_tokens=145, internal_pause=0.025,
        )
        self.assertGreater(len(pieces), 1)
        self.assertEqual({part["block_index"] for part in pieces}, {7})
        self.assertEqual(pieces[-1]["pause_after_seconds"], 0.38)
        self.assertEqual(" ".join(" ".join(p["text"] for p in pieces).split()),
                         " ".join(sentence.split()))
        self.assertTrue(all(part["token_count"] <= 145 for part in pieces))
        self.assertTrue(all(part["phoneme_length"] <= 500 for part in pieces))
        self.assertEqual(pieces[0]["split_reason"], "clause")
        self.assertEqual(pieces[0]["pause_after_seconds"], 0.025)

    def test_raw_phoneme_length_limit_is_checked_even_with_few_tokens(self):
        class WordTokenizer:
            @staticmethod
            def tokenize(phonemes, limit=None):
                return phonemes.split()
        ph = {"pt-br": FakeG2P("PT"), "en-us": FakeG2P("EN")}
        sentence = ("Capacidade extraordinária e flexibilidade, " * 12).strip() + "."
        input_segment = {"text": sentence,
                         "runs": [{"text": sentence, "lang": "pt-br"}],
                         "block_index": 0, "pause_after_seconds": 0.38}
        out = kokoro_release.fit_segments_to_phoneme_budget(
            [input_segment], ph, WordTokenizer(),
            max_tokens=350, target_tokens=300, max_phonemes=260
        )
        self.assertGreater(len(out), 1)
        self.assertTrue(all(part["phoneme_length"] <= 260 for part in out))

    def test_presets_keep_dora_and_original_as_unchanged_reference(self):
        names = list(kokoro_release.NARRATION_PRESETS)
        self.assertEqual(names, ["atual", "equilibrado", "fluido"])
        self.assertEqual(kokoro_release.COMPARE_SPEEDS, (0.95, 1.00, 1.05))
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
                self.assertEqual(kwargs["first_body_paragraphs"], 1)
                self.assertTrue(kwargs["sentence_aware"])
                output_dir.mkdir(parents=True)
                seen.append((kwargs["preset"], output_dir))
            def fake_synthesize(slug, output_dir, model, voices, **kwargs):
                self.assertEqual(kwargs["preset"], output_dir.name.rsplit("-", 1)[0])
                self.assertIn(kwargs["speed"], (0.95, 1.00, 1.05))
                self.assertTrue(kwargs["enforce_token_budget"])
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
            self.assertEqual(manifest["paragraphs"], 1)
            self.assertEqual(manifest["selection"], "title_plus_first_body_paragraph")
            self.assertEqual(manifest["speeds"], [0.95, 1.0, 1.05])
            self.assertEqual([v["name"] for v in manifest["variants"]], [
                f"{preset}-{speed}" for preset in ("atual", "equilibrado", "fluido")
                for speed in ("095", "100", "105")
            ])
            self.assertEqual(len(seen), 9)

    def test_new_default_is_approved_equilibrado_dora_100(self):
        self.assertEqual(kokoro_release.DEFAULT_PRESET, "equilibrado")
        self.assertEqual(kokoro_release.VOICE, "pf_dora")
        self.assertEqual(kokoro_release.NARRATION_PRESETS["equilibrado"]["speed"], 1.00)
        self.assertEqual(kokoro_release.DEFAULT_BITRATE_KBPS, 128)
        self.assertEqual(kokoro_release.NARRATION_PRESETS["equilibrado"]["paragraph_pause"], 0.38)
        self.assertEqual(kokoro_release.NARRATION_PRESETS["equilibrado"]["chunk_pause"], 0.14)

    def test_prepare_default_defers_sentence_splitting_until_real_tokenizer(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            directory = root / "articles"
            directory.mkdir()
            paragraph = ("Os compartimentos preservam a capacidade, " * 11).strip() + "."
            article = {"slug": "sample", "language": "pt-BR", "title": "Isolamento",
                       "dek": "Breve contextualização.", "bodyHtml": f"<p>{paragraph}</p>"}
            (directory / "sample.json").write_text(
                json.dumps(article, ensure_ascii=False), encoding="utf-8")
            with patch.object(article_selection, "ARTICLE_DIR", directory):
                kokoro_release.prepare("sample", root / "audio")
            segments = json.loads((root / "audio/sample.segments.json").read_text(encoding="utf-8"))
            self.assertEqual([s["block_index"] for s in segments], [0, 1, 2])
            self.assertEqual(segments[-1]["text"], paragraph)
            self.assertGreater(len(paragraph), 320)
            notes = (root / "audio/sample.md").read_text(encoding="utf-8")
            self.assertIn("velocidade 1.0", notes)

    def test_compare_preserves_old_baseline_095(self):
        self.assertEqual(kokoro_release.NARRATION_PRESETS["atual"]["speed"], 0.95)
        self.assertFalse(kokoro_release.NARRATION_PRESETS["atual"]["adaptive_chunks"])

    def test_voice_speed_and_languages(self):
        self.assertEqual(kokoro_release.VOICE, "pf_dora")
        self.assertEqual(kokoro_release.SPEED, 0.95)
        self.assertEqual((kokoro_release.LANG, kokoro_release.ENGLISH),
                         ("pt-br", "en-us"))


if __name__ == "__main__":
    unittest.main()
