"""Model-neutral article HTML/lexicon extraction; does not synthesize audio."""
from __future__ import annotations
import json
import re
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

LETTER_NAMES = {
    "pt": "a,bê,cê,dê,ê,éfe,gê,agá,i,jota,cá,éle,ême,êne,ó,pê,quê,érre,ésse,tê,u,vê,dáblio,xis,ípsilon,zê".split(","),
    "en": "ay,bee,see,dee,ee,ef,gee,aitch,eye,jay,kay,el,em,en,oh,pee,cue,ar,ess,tee,you,vee,double you,ex,why,zee".split(","),
}
DIGIT_NAMES = {"pt": "zero um dois três quatro cinco seis sete oito nove".split(), "en": "zero one two three four five six seven eight nine".split()}


def load_lexicon() -> dict:
    file = ROOT / "content/tts-lexicon.json"
    if not file.exists():
        return {}
    source = file.read_text(encoding="utf-8")
    lexicon = json.loads(source)
    if not isinstance(lexicon, dict):
        raise ValueError("Léxico TTS inválido.")
    for term, entry in lexicon.items():
        if not term.isalnum() or not isinstance(entry, dict) or not isinstance(entry.get("speak"), str) or not entry["speak"].strip() or not re.fullmatch(r"[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*", entry.get("lang", "")):
            raise ValueError(f"Pronúncia TTS inválida: {term}")
    return lexicon


def spell(text: str, language: str = "pt-BR") -> str:
    lang = "en" if language.lower().startswith("en") else "pt"
    return " ".join(LETTER_NAMES[lang][ord(char.upper()) - 65] if char.isascii() and char.isalpha() else DIGIT_NAMES[lang][int(char)] if char in "0123456789" else char for char in text)


def spoken_text(text: str, lexicon: dict) -> str:
    def replace(match):
        token = match.group()
        plural = bool(re.fullmatch(r"[a-z]?[A-Z][A-Z0-9]*s", token))
        base = token[:-1] if plural else token
        entry = lexicon.get(token, lexicon.get(base) if plural else None)
        initialism = bool(re.fullmatch(r"[a-z]?[A-Z][A-Z0-9]*", base)) and len(re.findall(r"[A-Z]", base)) >= 2
        if not entry and not initialism:
            return token
        return (entry["speak"] if entry else spell(base)) + ("s" if plural and token not in lexicon else "")
    return re.sub(r"https?://[^\s]+|www\.[^\s]+|\w+", replace, text)


VOID_TAGS = {
    "area", "base", "br", "col", "embed", "hr", "img", "input", "link",
    "meta", "param", "source", "track", "wbr",
}
IGNORED_TAGS = {"button", "code", "details", "nav", "pre", "script", "style", "svg"}
IGNORED_CLASSES = {
    "article-back", "fgs-simulator", "fgs-toc", "fgs-formula", "mermaid-diagram", "mermaid-fallback",
}
NARRATION_TAGS = {"h2", "h3", "h4", "p", "li", "figcaption", "th", "td"}


class ElementTreeParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.root: dict = {"tag": "#root", "attrs": {}, "children": []}
        self.stack = [self.root]

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag.lower() in {"br", "hr"}:
            self.stack[-1]["children"].append(" ")
            return
        node = {"tag": tag.lower(), "attrs": dict(attrs), "children": []}
        self.stack[-1]["children"].append(node)
        if tag.lower() not in VOID_TAGS:
            self.stack.append(node)

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag.lower() in {"br", "hr"}:
            self.stack[-1]["children"].append(" ")
            return
        self.stack[-1]["children"].append(
            {"tag": tag.lower(), "attrs": dict(attrs), "children": []}
        )

    def handle_endtag(self, tag: str) -> None:
        normalized = tag.lower()
        for index in range(len(self.stack) - 1, 0, -1):
            if self.stack[index]["tag"] == normalized:
                del self.stack[index:]
                break

    def handle_data(self, data: str) -> None:
        self.stack[-1]["children"].append(data)


def classes(node: dict) -> set[str]:
    value = node["attrs"].get("class") or ""
    return set(value.split())


def is_ignored(node: dict) -> bool:
    attrs = node["attrs"]
    # Code is non-narrative by default. An explicitly annotated *inline*
    # code token may be read with its editorial alias, but <pre> ancestors
    # remain ignored by the parent traversal regardless of child overrides.
    ignored_code = node["tag"] == "code" and not attrs.get("data-tts-say")
    return (node["tag"] in (IGNORED_TAGS - {"code"}) or ignored_code
            or bool(classes(node) & IGNORED_CLASSES) or "hidden" in attrs
            or "data-tts-ignore" in attrs or attrs.get("aria-hidden") == "true")


def descendant_has_tag(node: dict, tag: str) -> bool:
    for child in node["children"]:
        if isinstance(child, dict) and not is_ignored(child):
            if child["tag"] == tag or descendant_has_tag(child, tag):
                return True
    return False


def visible_text(node: dict, lexicon: dict | None = None, language: str = "pt-BR") -> str:
    parts: list[str] = []

    def collect(current: dict | str, inherited_language: str) -> None:
        if isinstance(current, str):
            parts.append(spoken_text(current, lexicon) if lexicon is not None else current)
            return
        if is_ignored(current):
            return
        attrs = current["attrs"]
        lang = attrs.get("lang") or inherited_language
        if lexicon is not None and attrs.get("data-tts-say"):
            parts.append(attrs["data-tts-say"])
            return
        if lexicon is not None and attrs.get("data-tts-mode") in {"word", "spell"}:
            literal = visible_text(current)
            parts.append(spell(literal, lang) if attrs["data-tts-mode"] == "spell" else literal)
            return
        for child in current["children"]:
            collect(child, lang)

    collect(node, language)
    return re.sub(r"\s+", " ", "".join(parts)).strip()


def narration_blocks(body_html: str, lexicon: dict | None = None) -> list[str]:
    parser = ElementTreeParser()
    parser.feed(body_html)
    parser.close()
    blocks: list[str] = []

    def visit(node: dict | str, inherited_language: str = "pt-BR") -> None:
        if isinstance(node, str) or is_ignored(node):
            return

        tag = node["tag"]
        language = node["attrs"].get("lang") or inherited_language
        node_classes = classes(node)
        if tag == "div" and "article-callout" in node_classes and not descendant_has_tag(node, "p"):
            text = visible_text(node, lexicon, language)
            if text:
                blocks.append(text)
            return

        if tag == "li" and not descendant_has_tag(node, "p"):
            text = visible_text(node, lexicon, language)
            if text:
                blocks.append(text)
            return

        if tag in NARRATION_TAGS:
            text = visible_text(node, lexicon, language)
            if text:
                blocks.append(text)
            return

        for child in node["children"]:
            visit(child, language)

    visit(parser.root)
    return blocks


def article_narration(article: dict, lexicon: dict | None = None) -> str:
    if lexicon is None:
        lexicon = load_lexicon()
    blocks = []
    for field in ("title", "dek"):
        value = article.get(field)
        if isinstance(value, str) and value.strip():
            segments = article.get("speechMarkup", {}).get(field, [])
            if segments and "".join(segment["text"] for segment in segments) == value:
                text = "".join(segment.get("speak") or (spell(segment["text"], segment["lang"]) if segment.get("mode") == "spell" else segment["text"] if segment.get("mode") == "word" else spoken_text(segment["text"], lexicon)) for segment in segments)
            else:
                text = spoken_text(value, lexicon)
            blocks.append(re.sub(r"\s+", " ", text).strip())

    body_html = article.get("bodyHtml")
    if isinstance(body_html, str):
        blocks.extend(narration_blocks(body_html, lexicon))
    return "\n\n".join(blocks).strip()


