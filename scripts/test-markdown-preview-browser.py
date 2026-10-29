"""Serve the staged HTML candidate under a Pages subpath and smoke its real UI."""
from __future__ import annotations

import functools
import json
import os
import shutil
import subprocess
import tempfile
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from urllib.parse import parse_qs, urlsplit

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent


class BasePathHandler(SimpleHTTPRequestHandler):
    def translate_path(self, path):
        pathname = urlsplit(path).path
        if pathname == "/tech-topics":
            pathname = "/"
        elif pathname.startswith("/tech-topics/"):
            pathname = pathname[len("/tech-topics"):]
        return super().translate_path(pathname)

    def log_message(self, *_args):
        pass


def main():
    node = os.environ.get("TECH_TOPICS_NODE", "node")
    with tempfile.TemporaryDirectory(prefix="tech-topics-html-browser-") as temporary:
        destination = Path(temporary) / "dist"
        built = subprocess.run(
            [node, str(ROOT / "scripts" / "build-markdown-browser-fixture.mjs"),
             "--destination", str(destination)],
            cwd=ROOT, capture_output=True, text=True, encoding="utf-8",
        )
        if built.returncode:
            raise RuntimeError(
                f"Markdown browser fixture build failed (exit {built.returncode}).\n"
                f"stdout:\n{built.stdout or '(empty)'}\n"
                f"stderr:\n{built.stderr or '(empty)'}"
            )
        identity = json.loads(built.stdout.strip().splitlines()[-1])
        assert identity["buildId"] and Path(identity["destination"]).is_dir()
        assert (destination / "assets" / "preview" / "preview-cover.jpg").is_file()

        handler = functools.partial(BasePathHandler, directory=str(destination))
        server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        thread = Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            origin = f"http://127.0.0.1:{server.server_port}"
            base = origin + "/tech-topics"
            errors = []
            with sync_playwright() as playwright:
                executable = os.environ.get("TECH_TOPICS_CHROMIUM") or shutil.which("chromium")
                options = {"headless": True}
                if executable:
                    options["executable_path"] = executable
                browser = playwright.chromium.launch(**options)
                try:
                    page = browser.new_page(viewport={"width": 390, "height": 844})
                    article_requests = []
                    page.on("request", lambda request: article_requests.append(request.url)
                            if "articles-catalog.json" in request.url or "content/articles/preview.html" in request.url
                            else None)
                    page.on("pageerror", lambda error: errors.append(str(error)))
                    page.route("**/*", lambda route: route.continue_()
                               if route.request.url.startswith(origin + "/") else route.abort())

                    page.goto(base + "/preview/#fontes", wait_until="domcontentloaded")
                    assert page.title() == "Preview de migração — Tech Topics"
                    assert page.evaluate("window.TechTopicsPublicationSha") == "a" * 40
                    assert page.locator('link[rel="canonical"]').get_attribute("href") == "../preview/"
                    assert page.evaluate("location.hash") == "#fontes"
                    page.locator("#article-actions").wait_for(state="visible", timeout=20000)
                    assert page.locator("#article-heading").inner_text() == "Preview de migração"
                    assert page.locator("#article-dek").inner_text() == "Catálogo leve e corpo HTML compilado."
                    assert "metadados no catálogo" in page.locator("#article-body").inner_text()
                    assert page.locator('#article-body nav[aria-label="Neste artigo"] a[href="#fontes"]').count() == 1
                    assert page.locator("#fontes").count() == 1
                    link = page.locator('#article-body a[href*="manual.pdf"]').get_attribute("href")
                    assert link.startswith("../assets/preview/manual.pdf?")
                    assert page.locator('#article-body a[href*="manual.pdf"]').evaluate("a => new URL(a.href).pathname") == "/tech-topics/assets/preview/manual.pdf"
                    page.goto(base + "/article.html?slug=preview#fontes", wait_until="domcontentloaded")
                    page.locator("#article-actions").wait_for(state="visible", timeout=20000)
                    assert page.locator("#article-heading").inner_text() == "Preview de migração"
                    assert page.evaluate("location.hash") == "#fontes"

                    page.goto(base + "/index.html?q=seguranca", wait_until="domcontentloaded")
                    page.locator(".recent-item").first.wait_for(state="visible", timeout=20000)
                    titles = page.locator(".recent-item .recent-copy h3 a").all_inner_texts()
                    assert "Preview de migração" in titles, titles
                    result_summary = page.locator("#article-count").inner_text()
                    matching_count, separator, total_count = result_summary.partition(" de ")
                    total_count = total_count.removesuffix(" artigos")
                    assert separator and matching_count.isdecimal() and total_count.isdecimal(), result_summary
                    assert int(matching_count) < int(total_count), result_summary
                    assert not errors, errors
                    for resource in ("assets/articles-catalog.json", "content/articles/preview.html"):
                        assert any(urlsplit(url).path.endswith("/" + resource)
                                   and parse_qs(urlsplit(url).query).get("revision") == ["a" * 40]
                                   for url in article_requests), (resource, article_requests)
                    print("PASS: staged HTML, revisioned catalog and transport load under /tech-topics/")
                finally:
                    browser.close()
        finally:
            server.shutdown()
            server.server_close()


if __name__ == "__main__":
    main()
