"""HTML signatures, editorial sentences, and legacy TTS chunks; no synthesis."""
import json
import os
import re
import sys
from html.parser import HTMLParser

sys.path.insert(0, os.environ["TECH_TOPICS_BASELINE_TTS_DIR"])
from kokoro_release import NARRATION_PRESETS, article_blocks, segments_for_article
from segmentation import append_run, clean_runs, punctuation_boundary, tokenize_runs

VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"}

class Tree(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.root = {"tag": "#root", "attrs": {}, "children": []}
        self.stack = [self.root]
    def handle_starttag(self, tag, attrs):
        node = {"tag": tag.lower(), "attrs": dict(attrs), "children": []}
        self.stack[-1]["children"].append(node)
        if tag.lower() not in VOID: self.stack.append(node)
    def handle_startendtag(self, tag, attrs):
        self.stack[-1]["children"].append({"tag": tag.lower(), "attrs": dict(attrs), "children": []})
    def handle_endtag(self, tag):
        tag = tag.lower()
        for i in range(len(self.stack)-1, 0, -1):
            if self.stack[i]["tag"] == tag:
                del self.stack[i:]
                break
    def handle_data(self, data): self.stack[-1]["children"].append(data)

def walk(node):
    if isinstance(node, dict):
        yield node
        for child in node["children"]: yield from walk(child)

def editorial_sentences(blocks, settings):
    output = []
    for block_index, block in enumerate(blocks):
        sentences, current = [], []
        for token in tokenize_runs(block["runs"]):
            current.append(token)
            if punctuation_boundary(token["text"]) == "sentence":
                sentences.append(current)
                current = []
        if current: sentences.append(current)
        for sentence_index, tokens in enumerate(sentences):
            runs = []
            for token in tokens:
                append_run(runs, token["text"], token["lang"])
            clean = clean_runs(runs)
            is_last = sentence_index == len(sentences) - 1
            pause = ((settings["section_pause"] if block["section"] else settings["paragraph_pause"])
                     if is_last else settings["sentence_pause"])
            output.append({"blockIndex": block_index, "sentenceIndex": sentence_index,
                "tag": block["tag"], "section": block["section"],
                "text": "".join(run["text"] for run in clean), "runs": clean,
                "pauseAfterSeconds": pause,
                "pauseKind": ("section" if block["section"] else "paragraph") if is_last else "sentence"})
    return output

def extract(article, lexicon):
    parser = Tree(); parser.feed(article["bodyHtml"]); parser.close()
    nodes = list(walk(parser.root))[1:]
    ids = [node["attrs"]["id"] for node in nodes if node["attrs"].get("id")]
    urls, assets = [], []
    for node in nodes:
        for key in ("href", "src", "poster", "srcset", "data-src"):
            value = node["attrs"].get(key)
            if value:
                entry = {"tag": node["tag"], "attribute": key, "value": value}
                urls.append(entry)
                if key in {"src", "poster", "data-src"} or (key == "href" and not re.match(r"^(?:[a-z]+:|#|//)", value, re.I)):
                    assets.append(entry)
    elements = [{"tag": n["tag"], "id": n["attrs"].get("id"), "class": n["attrs"].get("class"), "lang": n["attrs"].get("lang"), "ttsSay": n["attrs"].get("data-tts-say"), "ttsMode": n["attrs"].get("data-tts-mode"), "name": n["attrs"].get("name")} for n in nodes if n["tag"] in {"h1","h2","h3","h4","h5","h6","p","li","figcaption","th","td","pre","table","img","a","div","span","code"}]
    blocks = article_blocks(article, lexicon)
    # These preserve the historical inference-plan segmentation only. They do
    # not define editorial sentences and are not MP3/chapter timestamps.
    planned = segments_for_article(article, lexicon, preset="atual")
    legacy_chunks = []
    for chunk_index, segment in enumerate(planned):
        block = blocks[segment["block_index"]]
        legacy_chunks.append({"chunkIndex": chunk_index, "blockIndex": segment["block_index"],
            "tag": block["tag"], "section": block["section"], "text": segment["text"],
            "runs": segment["runs"], "plannedPauseAfterSeconds": segment["pause_after_seconds"],
            "splitReason": segment["split_reason"]})
    sentences = editorial_sentences(blocks, NARRATION_PRESETS["equilibrado"])
    return {"structure": {"ids": ids, "elements": elements, "urls": urls},
        "editorialSentences": sentences, "legacyChunks": legacy_chunks, "assets": assets}

payload = json.load(sys.stdin)
result = {"articles": [extract(article, payload["lexicon"]) for article in payload["articles"]],
    "presets": {name: settings for name, settings in NARRATION_PRESETS.items() if name in {"atual", "equilibrado"}}}
json.dump(result, sys.stdout, ensure_ascii=False, separators=(",", ":"))
