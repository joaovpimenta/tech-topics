"""Fast local narration contracts: stdlib only, no models or synthesis."""

import contextlib
import io
import json
import os
from pathlib import Path
import struct
import subprocess
import tempfile
import unittest
from unittest.mock import patch
import wave

import precommit as tts


def wav(path):
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as audio:
        audio.setnchannels(1)
        audio.setsampwidth(2)
        audio.setframerate(24000)
        audio.writeframes(b"\0\0" * 240)


class NarrationTests(unittest.TestCase):
    def setUp(self):
        fixture_dir = tts.ROOT / ".local/tts/tests"
        fixture_dir.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=fixture_dir)
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.output = self.root / ".local/tts/output"
        self.config = self.root / ".local/tts/config.json"
        self.voice = self.root / ".local/tts/voices/voice.wav"
        self.generator = self.root / "generator.py"
        self.generator.write_text("# fixture generator\n", encoding="utf-8")
        wav(self.voice)
        self.config.write_text(json.dumps({"voice": ".local/tts/voices/voice.wav"}), encoding="utf-8")
        self.root.joinpath(".gitignore").write_text(".local/\n", encoding="utf-8")
        subprocess.run(["git", "init", "--quiet", str(self.root)], check=True, capture_output=True)
        for name, value in {"ROOT": self.root, "CONFIG_FILE": self.config,
                            "OUTPUT_DIR": self.output, "GENERATOR": self.generator}.items():
            self.enterContext(patch.object(tts, name, value))
        self.enterContext(patch.dict(os.environ, {"TECH_TOPICS_TTS_VOICE": ""}))
        self.enterContext(contextlib.redirect_stdout(io.StringIO()))
        self.article = {"slug": "test-article", "title": "Título", "dek": "Resumo",
                        "bodyHtml": "<h2>Seção</h2><p>Prosa staged.</p><pre>código</pre>"}
        self.path = "content/articles/test-article.json"

    def stage(self):
        article_file = self.root / self.path
        article_file.parent.mkdir(parents=True, exist_ok=True)
        article_file.write_text(json.dumps(self.article, ensure_ascii=False), encoding="utf-8")
        tts.git("add", "--", self.path)
        return article_file

    def identity(self):
        return tts.cache_identity(self.article, self.voice, tts.generation_settings())

    def save_cache(self, identity):
        output = self.output / "test-article.wav"
        wav(output)
        output.with_suffix(".json").write_text(json.dumps({
            "identity": identity, "audio_sha256": tts.digest_file(output),
        }), encoding="utf-8")
        return output

    def test_reads_index_and_preserves_unstaged_text(self):
        path = self.stage()
        changed = {**self.article, "bodyHtml": "<p>Working tree.</p>"}
        path.write_text(json.dumps(changed), encoding="utf-8")
        self.assertEqual(tts.staged_article_paths(), [self.path])
        narration = tts.article_narration(tts.read_staged_article(self.path))
        self.assertIn("Prosa staged.", narration)
        self.assertNotIn("Working tree", narration)
        self.assertNotIn("código", narration)

    def test_slug_cannot_escape_output_directory(self):
        self.article["slug"] = "../secret"
        self.stage()
        with self.assertRaisesRegex(ValueError, "slug inválido"):
            tts.read_staged_article(self.path)

    def test_no_articles_needs_no_voice(self):
        self.config.unlink()
        self.assertEqual(tts.check_staged(), {"ok": True, "articles": []})

    def test_cache_requires_metadata_even_for_valid_legacy_audio(self):
        output = self.output / "test-article.wav"
        wav(output)
        self.assertTrue(tts.has_audio(output))
        self.assertFalse(tts.cache_matches(output, self.identity()))

    def test_cache_changes_with_narration_voice_settings_generator_and_packages(self):
        identity = self.identity()
        output = self.save_cache(identity)
        self.assertTrue(tts.cache_matches(output, identity))
        for mutate in (
            lambda: self.article.update(title="Outro título"),
            lambda: self.voice.write_bytes(self.voice.read_bytes() + b"voice change"),
            lambda: self.config.write_text(json.dumps({"generation": {"pause_ms": 400}}), encoding="utf-8"),
            lambda: self.generator.write_text("# changed generator", encoding="utf-8"),
        ):
            mutate()
            self.assertFalse(tts.cache_matches(output, self.identity()))
            identity = self.identity()
            output = self.save_cache(identity)
        with patch.object(tts.importlib.metadata, "version", return_value="changed-runtime"):
            self.assertFalse(tts.cache_matches(output, self.identity()))

    def test_cache_rejects_audio_changed_but_still_valid(self):
        output = self.save_cache(self.identity())
        data = bytearray(output.read_bytes())
        data[-1] = 1
        output.write_bytes(data)
        self.assertTrue(tts.has_audio(output))
        self.assertFalse(tts.cache_matches(output, self.identity()))

    def test_pcm_and_float_truncation_are_rejected(self):
        output = self.save_cache(self.identity())
        output.write_bytes(output.read_bytes()[:-2])
        self.assertFalse(tts.has_audio(output))
        fmt = struct.pack("<HHIIHH", 3, 1, 24000, 96000, 4, 32)
        chunks = b"fmt " + struct.pack("<I", len(fmt)) + fmt + b"data" + struct.pack("<I", 8) + b"\0" * 8
        data = b"RIFF" + struct.pack("<I", len(chunks) + 4) + b"WAVE" + chunks
        output.write_bytes(data)
        self.assertTrue(tts.has_audio(output))
        output.write_bytes(data[:-1])
        self.assertFalse(tts.has_audio(output))

    def test_invalid_voice_and_config_rejected(self):
        self.voice.write_bytes(b"invalid")
        with self.assertRaisesRegex(ValueError, "WAV válido"):
            tts.configured_voice()
        self.config.write_text("[]", encoding="utf-8")
        with self.assertRaises(ValueError):
            tts.generation_settings()
        self.config.write_text(json.dumps({"generation": {"chunk_chars": 0}}), encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "chunk_chars"):
            tts.generation_settings()

    def test_empty_narration_rejected(self):
        with self.assertRaisesRegex(ValueError, "prosa"):
            tts.cache_identity({"slug": "empty"}, self.voice, tts.generation_settings())

    def test_private_files_force_added_are_blocked_even_without_articles(self):
        tts.git("add", "--force", ".local/tts/config.json")
        with self.assertRaisesRegex(ValueError, "privados"):
            tts.check_staged()

    def test_voice_outside_local_folder_force_added_is_blocked(self):
        external = self.root / "voice.wav"
        wav(external)
        tts.git("add", "voice.wav")
        with self.assertRaisesRegex(ValueError, "privados"):
            tts.assert_private_files(external)
        self.config.write_text(json.dumps({"voice": "voice.wav"}), encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "privados"):
            tts.check_staged()

    def test_prepare_preserves_config_and_does_not_activate_hook(self):
        before = self.config.read_bytes()
        tts.prepare(False)
        tts.prepare(False)
        self.assertEqual(self.config.read_bytes(), before)
        result = subprocess.run(["git", "config", "--local", "--get", "core.hooksPath"], cwd=self.root, capture_output=True)
        self.assertEqual(result.returncode, 1)

    def test_explicit_hook_install_is_repeatable_and_preserves_other_hook(self):
        tts.prepare(True)
        tts.prepare(True)
        self.assertEqual(tts.git("config", "--local", "--get", "core.hooksPath").strip(), ".githooks")
        tts.git("config", "--local", "core.hooksPath", "custom-hooks")
        with self.assertRaisesRegex(ValueError, "outro hook"):
            tts.prepare(True)
        self.assertEqual(tts.git("config", "--local", "--get", "core.hooksPath").strip(), "custom-hooks")

    def test_failed_generator_invalidates_old_metadata(self):
        identity = self.identity()
        output = self.save_cache(identity)
        with patch.object(tts.subprocess, "run", return_value=subprocess.CompletedProcess([], 1)):
            with self.assertRaisesRegex(RuntimeError, "falhou"):
                tts.generate(self.path, self.article, self.voice, tts.generation_settings(), identity)
        self.assertTrue(output.exists())
        self.assertFalse(output.with_suffix(".json").exists())
        self.assertFalse(tts.cache_matches(output, identity))
        self.assertEqual(list((self.root / ".local/tts/tmp").iterdir()), [])

    def test_explicit_hook_install_preserves_inherited_hook(self):
        global_config = self.root / "isolated-global.gitconfig"
        global_config.write_text('[core]\n\thooksPath = inherited-hooks\n', encoding="utf-8")
        with patch.dict(os.environ, {"GIT_CONFIG_GLOBAL": str(global_config), "GIT_CONFIG_NOSYSTEM": "1"}):
            with self.assertRaisesRegex(ValueError, "outro hook"):
                tts.prepare(True)
            self.assertEqual(tts.git("config", "--get", "core.hooksPath").strip(), "inherited-hooks")
            local = subprocess.run(["git", "config", "--local", "--get", "core.hooksPath"], cwd=self.root, capture_output=True)
            self.assertEqual(local.returncode, 1)

    def test_success_without_complete_wav_does_not_write_metadata(self):
        identity = self.identity()
        with patch.object(tts.subprocess, "run", return_value=subprocess.CompletedProcess([], 0)):
            with self.assertRaisesRegex(RuntimeError, "WAV válido"):
                tts.generate(self.path, self.article, self.voice, tts.generation_settings(), identity)
        self.assertFalse((self.output / "test-article.json").exists())

    def test_complete_generation_writes_marker_after_audio_success(self):
        identity = self.identity()
        output = self.output / "test-article.wav"
        def generator(command, **kwargs):
            temporary_output = Path(command[command.index("--output") + 1])
            self.assertNotEqual(temporary_output, output)
            self.assertFalse(output.with_suffix(".json").exists())
            wav(temporary_output)
            return subprocess.CompletedProcess(command, 0)
        with patch.object(tts.subprocess, "run", side_effect=generator):
            tts.generate(self.path, self.article, self.voice, tts.generation_settings(), identity)
        self.assertTrue(tts.cache_matches(output, identity))

    def test_check_reuses_staged_narration_and_regenerates_changed_index(self):
        self.stage()
        self.save_cache(self.identity())
        with patch.object(tts, "generate") as generator:
            self.assertTrue(tts.check_staged()["articles"][0]["reused"])
            generator.assert_not_called()
            self.article["title"] = "Título changed"
            self.stage()
            self.assertFalse(tts.check_staged()["articles"][0]["reused"])
            generator.assert_called_once()

    def test_doctor_json_without_importing_torch_or_changing_git(self):
        with patch.object(tts.importlib.util, "find_spec", return_value=None), contextlib.redirect_stdout(io.StringIO()) as output:
            code = tts.main(["doctor", "--json"])
        result = json.loads(output.getvalue())
        self.assertEqual(code, 1)
        self.assertFalse(result["ok"])
        self.assertFalse(result["hook"]["enabled"])
        self.assertTrue(any(check["name"] == "torch" and not check["ok"] for check in result["checks"]))


if __name__ == "__main__":
    unittest.main()
