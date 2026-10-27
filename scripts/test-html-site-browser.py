"""Open every article from the public html-v1 artifact in desktop and mobile Chromium."""
from __future__ import annotations

import functools
import json
import os
import re
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from urllib.parse import urlsplit

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "dist"
SLUG = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")


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


def read_artifact():
    manifest_path = DIST / ".site-artifact.json"
    catalog_path = DIST / "assets" / "articles-catalog.json"
    if not manifest_path.is_file() or not catalog_path.is_file():
        raise AssertionError("Build the validated public artifact in dist/ before this browser smoke.")

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
    assert manifest.get("version") == 2 and manifest.get("format") == "html-v1"
    assert catalog.get("version") == 1 and catalog.get("transport") == "html-v1"
    assert re.fullmatch(r"[a-f0-9]{40}", catalog.get("sourceSha", ""))
    assert re.fullmatch(r"[a-f0-9]{64}", catalog.get("buildId", ""))
    assert manifest.get("sourceSha") == catalog["sourceSha"]
    assert manifest.get("buildId") == catalog["buildId"]

    records = catalog.get("articles")
    assert isinstance(records, list) and records, "the public catalog contains articles"
    html_paths = set()
    for record in records:
        slug = record.get("slug")
        assert isinstance(slug, str) and SLUG.fullmatch(slug)
        assert record.get("format") == "html-v1"
        assert record.get("path") == f"content/articles/{slug}.html"
        assert isinstance(record.get("title"), str) and record["title"].strip()
        assert isinstance(record.get("opening"), str) and record["opening"].strip()
        html_paths.add(record["path"])

    files = set(manifest.get("files", []))
    assert html_paths <= files
    assert "content/articles/index.json" not in files
    assert not any(re.fullmatch(r"content/articles/[^/]+\.(?:json|md)", file) for file in files)
    assert not (DIST / "content" / "articles" / "index.json").exists()
    assert {file for file in files if file.startswith("content/articles/")} == html_paths
    return records


def main():
    records = read_artifact()
    handler = functools.partial(BasePathHandler, directory=str(DIST))
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    origin = f"http://127.0.0.1:{server.server_port}"
    errors = []
    chromium_path = os.environ.get("TECH_TOPICS_CHROMIUM")
    try:
        with sync_playwright() as playwright:
            options = {"headless": True}
            if chromium_path:
                options["executable_path"] = chromium_path
            browser = playwright.chromium.launch(**options)
            try:
                for label, viewport in [
                    ("desktop", {"width": 1365, "height": 900}),
                    ("mobile", {"width": 390, "height": 844}),
                ]:
                    context = browser.new_context(viewport=viewport, service_workers="block")
                    try:
                        page = context.new_page()
                        page.on("pageerror", lambda error: errors.append(str(error)))
                        page.add_init_script("""
                          window.__techTopicsUtterances = [];
                          Object.defineProperty(window, "speechSynthesis", {
                            configurable: true,
                            value: {
                              getVoices: () => [],
                              addEventListener() {},
                              removeEventListener() {},
                              speak(utterance) {
                                window.__techTopicsUtterances.push(utterance.text);
                                if (typeof utterance.onstart === "function") utterance.onstart();
                              },
                              cancel() {}, pause() {}, resume() {}
                            }
                          });
                          window.SpeechSynthesisUtterance = class {
                            constructor(text) { this.text = text; }
                          };
                        """)
                        page.route("**/*", lambda route: route.continue_()
                                   if route.request.url.startswith(origin + "/") else route.abort())
                        for record in records:
                            errors.clear()
                            slug = record["slug"]
                            page.goto(f"{origin}/tech-topics/article.html?slug={slug}", wait_until="domcontentloaded")
                            page.locator("#article-actions").wait_for(state="visible", timeout=20000)
                            assert page.locator("#article-heading").inner_text() == record["title"], slug
                            body = " ".join(page.locator("#article-body").inner_text().split())
                            opening = " ".join(record["opening"].split())
                            assert opening in body, f"opening paragraph mismatch: {slug}"
                            assert body.strip(), f"empty article body: {slug}"
                            page.wait_for_function("""
                              () => {
                              const image = document.querySelector("#article-image");
                              return image && image.complete && image.naturalWidth > 0;
                              }
                            """, timeout=20000)
                            assert page.locator("#listen-recording").is_visible(), f"recorded/device player control missing: {slug}"
                            assert page.locator("#favorite-article").is_visible(), f"favorite control missing: {slug}"

                            broken_fragments = page.locator("#article-body a[href^='#']").evaluate_all("""
                              anchors => anchors.filter(anchor => {
                                const id = decodeURIComponent(anchor.getAttribute("href").slice(1));
                                return !document.getElementById(id);
                              }).map(anchor => anchor.getAttribute("href"))
                            """)
                            assert not broken_fragments, f"unresolved article fragments for {slug}: {broken_fragments}"

                            local_links = page.locator("#article-body a[href]").evaluate_all("""
                              anchors => [...new Set(anchors.map(anchor => new URL(anchor.href))
                                .filter(url => url.origin === location.origin && url.protocol === "http:")
                                .map(url => url.pathname + url.search))]
                            """)
                            link_statuses = page.evaluate("""
                              async paths => Promise.all(paths.map(async href => {
                                const response = await fetch(href, { method: "HEAD", cache: "no-store" });
                                return { href, status: response.status };
                              }))
                            """, local_links)
                            broken_links = [link for link in link_statuses if link["status"] < 200 or link["status"] >= 400]
                            assert not broken_links, f"broken local links for {slug}: {broken_links}"

                            if label == "mobile":
                                assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), \
                                    f"document overflow at {viewport['width']}px for {slug}"

                            if slug == "four-golden-signals":
                                page.locator("#fgs-arrival").evaluate("""
                                  element => {
                                    element.value = "90";
                                    element.dispatchEvent(new Event("input", { bubbles: true }));
                                  }
                                """)
                                assert page.locator("#fgs-duration").inner_text() == "100 ms", \
                                    "Four Golden Signals simulator did not update from compiled HTML"

                            if label == "desktop" and slug == "cqrs-projecoes-e-consistencia":
                                page.locator("#listen-recording").click()
                                page.wait_for_function("window.__techTopicsUtterances.length > 0", timeout=10000)
                                assert any(window_text.strip() for window_text in page.evaluate(
                                    "window.__techTopicsUtterances")), "compiled article did not reach device speech"

                            fragment_link = page.locator("#article-body a[href^='#']").first
                            if fragment_link.count():
                                target_hash = fragment_link.get_attribute("href")
                                fragment_link.click()
                                assert page.evaluate("location.hash") == target_hash, \
                                    f"fragment navigation did not preserve {target_hash} for {slug}"
                            assert not errors, f"{label} page errors for {slug}: {errors}"
                            index_status = page.evaluate(
                                "async () => (await fetch('content/articles/index.json', {cache: 'no-store'})).status"
                            )
                            assert index_status == 404, f"legacy article index remains public for {slug}"
                        print(f"PASS: {len(records)} html-v1 articles open from dist/ in {label} Chromium.")
                    finally:
                        context.close()
            finally:
                browser.close()
    finally:
        server.shutdown()
        server.server_close()


if __name__ == "__main__":
    main()
