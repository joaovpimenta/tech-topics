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

    def test_inline_code_is_opt_in_and_arrows_use_contextual_aliases(self):
        html = (
            '<h3>Banco <span data-tts-say="para o">→</span> '
            '<span lang="en-US">broker</span></h3>'
            '<p>Um bloco <code lang="en-US" data-tts-say="try catch">'
            'try/catch</code> não fecha a janela. '
            '<code>SELECT * FROM orders</code></p>'
            '<pre><code data-tts-say="nunca narrar">secret</code></pre>'
        )
        from narration_text import narration_blocks
        blocks = narration_blocks(html, {})
        self.assertEqual(blocks[0], "Banco para o broker")
        self.assertIn("Um bloco try catch não fecha a janela.", blocks[1])
        self.assertNotIn("try/catch", " ".join(blocks))
        self.assertNotIn("SELECT", " ".join(blocks))
        self.assertNotIn("nunca narrar", " ".join(blocks))

    def test_parser(self):
        parser = ElementTreeParser()
        parser.feed("<p>Uma <strong>frase</strong>.</p>")
        self.assertEqual(parser.root["children"][0]["tag"], "p")

if __name__ == "__main__":
    unittest.main()
