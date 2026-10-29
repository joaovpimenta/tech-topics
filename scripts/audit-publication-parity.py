#!/usr/bin/env python3
"""Fail closed when deployed and candidate native speech/DOM mappings differ."""
import argparse
import contextlib
import functools
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools" / "tts"))
from article_selection import validate_artifact_identity


def git(*args, cwd=ROOT):
    return subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True, text=True).stdout.strip()


def compare_records(before, after):
    """Compare all existing slugs, including original mounted player mappings."""
    missing = sorted(set(before) - set(after))
    if missing:
        raise ValueError(f"Artigos removidos do candidato: {', '.join(missing)}")
    for slug in sorted(before):
        for name, record in (("antes", before[slug]), ("depois", after[slug])):
            if record["clone"] != record["mounted"]:
                raise ValueError(f"{slug}: DOM e player montado divergem ({name})")
        if before[slug]["mounted"] != after[slug]["mounted"]:
            raise ValueError(f"{slug}: fala ou mapeamento DOM mudou")
    return {"compared": len(before), "added": sorted(set(after) - set(before))}


def verify_dist(root, sha):
    dist = root / "dist"
    catalog = json.loads((dist / "assets/articles-catalog.json").read_text(encoding="utf-8"))
    if not isinstance(catalog, dict):
        raise ValueError("Catálogo sem identidade html-v1; auditoria bloqueada")
    validate_artifact_identity(sha, catalog.get("buildId", ""), root / "content/articles", dist)
    return catalog["articles"]


def instrument_speech(source):
    replacements = [
        ("    let sentenceIndex = 0;\n    for (let pieceIndex", "    let sentenceIndex = 0;\n    let pendingWhitespace = false;\n    for (let pieceIndex"),
        ("      if (piece.owner !== previousOwner) {", "      if (piece.owner !== previousOwner) {\n        pendingWhitespace = false;"),
        ('      let text = piece.text.replace(/\\s+/g, " ");', '      let text = piece.text.replace(/\\s+/g, " ");\n      if (/^\\s+$/u.test(text)) pendingWhitespace = true;\n      else if (/^[\\p{P}]+$/u.test(text)) pendingWhitespace = false;'),
        ("        if (!segment || segment.lang !== piece.lang || segment.text.length + text.length > 240) {", "        const separatorBefore = Boolean(segment && pendingWhitespace);\n        if (!segment || segment.lang !== piece.lang || segment.text.length + text.length > 240) {"),
        ('          segment = { text: "", lang: piece.lang, words: [] };', '          segment = { text: "", lang: piece.lang, words: [], separatorBefore };'),
        ("      for (const word of piece.nodes) if (!block.words.includes(word)) block.words.push(word);", "      if (!/^[\\s\\p{P}]+$/u.test(text)) pendingWhitespace = false;\n      for (const word of piece.nodes) if (!block.words.includes(word)) block.words.push(word);"),
    ]
    for original, replacement in replacements:
        if source.count(original) != 1:
            raise ValueError("Não foi possível instrumentar speech.js com segurança")
        source = source.replace(original, replacement, 1)
    return source


@contextlib.contextmanager
def serve(dist):
    class QuietHandler(SimpleHTTPRequestHandler):
        def log_message(self, *_args):
            pass
    server = ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(QuietHandler, directory=str(dist)))
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}"
    finally:
        server.shutdown()
        thread.join()
        server.server_close()


# Capture the production mount, alongside an independent reconstruction. No
# synthesis is invoked, and all network traffic outside the local server fails.
INIT = """() => {
  window.__articleReady = false;
  document.addEventListener('tech-topics:article-ready', () => { window.__articleReady = true; });
  Object.defineProperty(window, 'speechSynthesis', { value: { getVoices: () => [], speak() { throw new Error('synthesis disabled'); }, cancel() {}, pause() {}, resume() {}, addEventListener() {} } });
  window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
}"""
CAPTURE = """lexicon => {
  const header = document.querySelector('.article-header').cloneNode(true);
  const body = document.querySelector('#article-body').cloneNode(true);
  const holder = document.createElement('div'); holder.lang = 'pt-BR'; holder.append(header, body);
  const compact = (units, elements) => {
    const nodeIds = new WeakMap(); let next = 0;
    const narratable = [...new Set(units.map(unit => unit.node))];
    const id = node => { if (!nodeIds.has(node)) nodeIds.set(node, String(++next)); return nodeIds.get(node); };
    return units.map(unit => { if (elements.indexOf(unit.node) < 0) throw new Error('speech block absent from reading nodes'); return ({ blockIndex: elements.indexOf(unit.node), sentenceIndex: unit.sentenceIndex,
      chapterBlockIndex: narratable.indexOf(unit.node), segments: unit.segments.map(segment => ({
        text: segment.text, lang: segment.lang, separatorBefore: segment.separatorBefore,
        words: segment.words.map(({start, end, nodes}) => ({start, end, nodeIds: nodes.map(id)}))
      })) }); });
  };
  const roots = [header.querySelector('#article-heading'), header.querySelector('#article-dek'), body];
  const clone = compact(window.TechTopicsSpeech.buildBlocks(roots, lexicon),
    window.TechTopicsAudio.readingNodes({querySelector: selector => holder.querySelector(selector)}));
  if (!Array.isArray(window.__actualBlocks)) throw new Error('original speech mount unavailable');
  return {clone, mounted: compact(window.__actualBlocks, window.TechTopicsAudio.readingNodes(document))};
}"""


def audit(browser, root, catalog):
    records = {}
    lexicon = json.loads((root / "dist/content/tts-lexicon.json").read_text(encoding="utf-8"))
    with serve(root / "dist") as origin:
        page = browser.new_page(service_workers="block")
        page.add_init_script(f"({INIT})();")
        def intercept(route):
            request = route.request
            if not request.url.startswith(origin + "/"):
                return route.abort()
            if request.url.split("?", 1)[0].endswith("/speech.js"):
                response = route.fetch()
                body = instrument_speech(response.text()) + "\n;(() => { const original = window.TechTopicsSpeech.mount; window.TechTopicsSpeech.mount = function(options) { const player = original(options); window.__actualBlocks = player?.blocks ?? null; return player; }; })();"
                return route.fulfill(response=response, body=body)
            return route.continue_()
        page.route("**/*", intercept)
        try:
            for article in catalog:
                slug = article["slug"]
                page.goto(f"{origin}/article.html?slug={slug}", wait_until="load")
                page.wait_for_function("window.__articleReady === true", timeout=15000)
                records[slug] = page.evaluate(CAPTURE, lexicon)
        finally:
            page.close()
    return records


def main():
    from playwright.sync_api import sync_playwright
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--before", required=True)
    parser.add_argument("--after", required=True)
    args = parser.parse_args()
    for sha in (args.before, args.after):
        if not re.fullmatch(r"[a-f0-9]{40}", sha) or sha == "0" * 40:
            parser.error("SHAs devem ser completos e não zerados")
    if git("rev-parse", "HEAD") != args.after:
        raise ValueError("O checkout deve corresponder ao SHA candidato")
    git("merge-base", "--is-ancestor", args.before, args.after)
    before_lock = git("rev-parse", f"{args.before}:package-lock.json")
    after_lock = git("rev-parse", f"{args.after}:package-lock.json")
    if before_lock != after_lock:
        raise ValueError("package-lock.json divergiu; toolchains não podem ser compartilhadas")
    if not (ROOT / "node_modules").is_dir():
        raise ValueError("node_modules ausente")
    # Ensure installed dependencies correspond to the exact committed lockfile.
    current_lock = subprocess.run(["git", "hash-object", "package-lock.json"], cwd=ROOT, check=True, capture_output=True, text=True).stdout.strip()
    if current_lock != after_lock:
        raise ValueError("package-lock.json local não corresponde ao SHA candidato")
    candidate = verify_dist(ROOT, args.after)
    with tempfile.TemporaryDirectory(prefix="tech-topics-parity-") as temp:
        worktree = Path(temp) / "before"
        try:
            subprocess.run(["git", "worktree", "add", "--detach", str(worktree), args.before], cwd=ROOT, check=True)
            (worktree / "node_modules").symlink_to(ROOT / "node_modules", target_is_directory=True)
            subprocess.run(["node", "scripts/build-site.mjs"], cwd=worktree, check=True)
            baseline = verify_dist(worktree, args.before)
            with sync_playwright() as playwright:
                options = {"headless": True, "args": ["--no-sandbox", "--disable-dev-shm-usage"]}
                if os.environ.get("TECH_TOPICS_CHROMIUM"):
                    options["executable_path"] = os.environ["TECH_TOPICS_CHROMIUM"]
                browser = playwright.chromium.launch(**options)
                try:
                    result = compare_records(audit(browser, worktree, baseline), audit(browser, ROOT, candidate))
                finally:
                    browser.close()
            print(json.dumps({"before": args.before, "after": args.after, **result}, ensure_ascii=False))
        finally:
            if worktree.exists():
                subprocess.run(["git", "worktree", "remove", "--force", str(worktree)], cwd=ROOT, check=True)


if __name__ == "__main__":
    main()
