"""Model-neutral narrative extraction checks; Python stdlib only."""
import unittest
from narration_text import ElementTreeParser, article_narration, spell

class NarrationTextTests(unittest.TestCase):
    def test_html_exclusions_and_spelling(self):
        article = {"title": "API", "bodyHtml": "<p>Um serviço seguro.</p><pre>ignorar código</pre>"}
        text = article_narration(article, {})
        self.assertIn("Um serviço seguro.", text)
        self.assertNotIn("ignorar código", text)
        self.assertIn(spell("API"), text)

    def test_parser(self):
        parser = ElementTreeParser()
        parser.feed("<p>Uma <strong>frase</strong>.</p>")
        self.assertEqual(parser.root["children"][0]["tag"], "p")

if __name__ == "__main__":
    unittest.main()
