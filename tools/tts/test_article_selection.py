"""Selection tests for automatic and manual Kokoro Jobs (stdlib only)."""

import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import article_selection


class ArticleSelectionTests(unittest.TestCase):
    def test_slug_validation(self):
        with self.assertRaises(ValueError):
            article_selection.read_article("../../secrets")

    def test_manual_title_slug_or_latest(self):
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp)
            articles = [
                {"slug": "bulkhead", "language": "pt-BR", "title": "Bulkhead: isolar falhas",
                 "publishedAt": "2026-02-10"},
                {"slug": "four-golden-signals", "language": "pt-BR",
                 "title": "Four Golden Signals: observabilidade",
                 "publishedAt": "2026-03-10"},
                {"slug": "sre-capacidade", "language": "pt-BR",
                 "title": "SRE: Capacidade", "publishedAt": "2026-04-20"},
            ]
            for article in articles:
                (directory / (article["slug"] + ".json")).write_text(
                    json.dumps(article), encoding="utf-8")
            with patch.object(article_selection, "ARTICLE_DIR", directory):
                self.assertEqual(article_selection.select_manual("Bulkhead"), ["bulkhead"])
                self.assertEqual(article_selection.select_manual("four golden signals"),
                                 ["four-golden-signals"])
                self.assertEqual(article_selection.select_manual("Four Golden Signals: observabilidade"),
                                 ["four-golden-signals"])
                self.assertEqual(article_selection.select_manual(""), ["sre-capacidade"])
                self.assertEqual(article_selection.select_manual("latest"), ["sre-capacidade"])
                self.assertEqual(article_selection.select_manual("sre capacidade"), ["sre-capacidade"])
                with self.assertRaises(ValueError):
                    article_selection.select_manual("bookhead")

    def test_ambiguous_titles_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp)
            for slug in ("four-golden-signals-1", "four-golden-signals-2"):
                (directory / (slug + ".json")).write_text(
                    json.dumps({"slug": slug, "language": "pt-BR",
                                "title": "Four Golden Signals: " + slug,
                                "publishedAt": "2026-03-10"}),
                    encoding="utf-8",
                )
            with patch.object(article_selection, "ARTICLE_DIR", directory):
                with self.assertRaisesRegex(ValueError, "ambíguo"):
                    article_selection.select_manual("Four Golden Signals")

    def test_only_added_jsons_trigger_automatic_workflow(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            def git(*args):
                return subprocess.run(["git", *args], cwd=root, check=True,
                                      capture_output=True, text=True).stdout.strip()
            git("init")
            git("config", "user.email", "test@example.com")
            git("config", "user.name", "Test")
            directory = root / "content" / "articles"
            directory.mkdir(parents=True)
            (directory / "older.json").write_text("{}", encoding="utf-8")
            git("add", ".")
            git("commit", "-m", "old")
            before = git("rev-parse", "HEAD")
            (directory / "older.json").write_text('{"modified":true}', encoding="utf-8")
            (directory / "new.json").write_text("{}", encoding="utf-8")
            (directory / "index.json").write_text("[]", encoding="utf-8")
            git("add", ".")
            git("commit", "-m", "new")
            after = git("rev-parse", "HEAD")
            self.assertEqual(article_selection.added_slugs(before, after, root), ["new"])


if __name__ == "__main__":
    unittest.main()
