"""Offline tests for the Piper release selector and narration extraction."""

import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import piper_release


class PiperReleaseTests(unittest.TestCase):
    def test_rejects_path_traversal(self):
        with self.assertRaises(ValueError):
            piper_release.read_article("../../secrets")

    def test_added_articles_are_selected_without_modified_files_or_index(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            def git(*args):
                return subprocess.run(["git", *args], cwd=root, check=True,
                                      stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                      text=True).stdout.strip()

            git("init")
            git("config", "user.email", "test@example.com")
            git("config", "user.name", "Test")
            article_dir = root / "content" / "articles"
            article_dir.mkdir(parents=True)
            (article_dir / "older.json").write_text("{}", encoding="utf-8")
            git("add", ".")
            git("commit", "-m", "existing")
            before = git("rev-parse", "HEAD")
            (article_dir / "older.json").write_text('{"edited":true}', encoding="utf-8")
            (article_dir / "new-article.json").write_text("{}", encoding="utf-8")
            (article_dir / "index.json").write_text("[]", encoding="utf-8")
            git("add", ".")
            git("commit", "-m", "new article")
            after = git("rev-parse", "HEAD")

            self.assertEqual(
                piper_release.added_slugs(before, after, root), ["new-article"]
            )

    def test_prepared_text_uses_existing_tts_rules(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            article_dir = root / "content" / "articles"
            article_dir.mkdir(parents=True)
            article = {
                "slug": "teste",
                "language": "pt-BR",
                "title": "Um teste com API",
                "dek": "Áudio brasileiro.",
                "bodyHtml": (
                    '<nav>Ignorar este sumário</nav>'
                    '<p>Uma API confiável funciona.</p>'
                    '<pre>Não narrar código</pre>'
                    '<p>Fim do artigo.</p>'
                ),
            }
            (article_dir / "teste.json").write_text(
                json.dumps(article), encoding="utf-8"
            )
            with patch.object(piper_release, "ARTICLE_DIR", article_dir):
                piper_release.prepare("teste", root / "output")
            text = (root / "output" / "teste.txt").read_text(encoding="utf-8")
            self.assertIn("a pê i", text)
            self.assertIn("Fim do artigo.", text)
            self.assertNotIn("Ignorar este sumário", text)
            self.assertNotIn("Não narrar código", text)
            self.assertIn("Áudio brasileiro.", text)
            self.assertIn("tech-topics", (root / "output" / "teste.md").read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
