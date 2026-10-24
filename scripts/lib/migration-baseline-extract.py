"""HTML structure plus the repository TTS segment plan; never synthesizes audio."""
import json
import os
import re
import sys
from html.parser import HTMLParser

sys.path.insert(0, os.environ["TECH_TOPICS_BASELINE_TTS_DIR"])
from kokoro_release import article_blocks, segments_for_article

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
    planned = segments_for_article(article, lexicon, preset="atual")
    narration, sentence_by_block, prior = [], {}, None
    for segment_index, segment in enumerate(planned):
        block_index = segment["block_index"]
        sentence_index = sentence_by_block.get(block_index, 0)
        if prior and prior["block_index"] == block_index and prior["split_reason"] == "sentence":
            sentence_index += 1
        sentence_by_block[block_index] = sentence_index
        block = blocks[block_index]
        narration.append({"segmentIndex": segment_index, "blockIndex": block_index,
            "sentenceIndex": sentence_index, "tag": block["tag"], "section": block["section"],
            "text": segment["text"], "runs": segment["runs"],
            "pauseAfterSeconds": segment["pause_after_seconds"], "splitReason": segment["split_reason"]})
        prior = segment
    return {"structure": {"ids": ids, "elements": elements, "urls": urls}, "narration": narration, "assets": assets}

payload = json.load(sys.stdin)
json.dump([extract(article, payload["lexicon"]) for article in payload["articles"]], sys.stdout, ensure_ascii=False, separators=(",", ":"))
