"""Select Tech Topics articles for automatic/manual Kokoro narration (stdlib only)."""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ARTICLE_DIR = ROOT / "content" / "articles"
SLUG = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*\Z")
SHA = re.compile(r"[a-fA-F0-9]{40}\Z")


def read_article(slug: str) -> dict:
    if not SLUG.fullmatch(slug):
        raise ValueError(f"Slug inválido: {slug!r}")
    path = ARTICLE_DIR / f"{slug}.json"
    if not path.is_file():
        raise ValueError(f"Artigo não encontrado: {slug}")
    article = json.loads(path.read_text(encoding="utf-8"))
    if article.get("slug") != slug or article.get("language") != "pt-BR":
        raise ValueError(f"Contrato ou idioma inválido: {slug}")
    return article


def catalog() -> list[dict]:
    articles = []
    for path in ARTICLE_DIR.glob("*.json"):
        if path.name != "index.json":
            articles.append(read_article(path.stem))
    return articles


def normalize(text: str) -> str:
    text = unicodedata.normalize("NFKD", text.casefold())
    ascii_text = "".join(c for c in text if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]+", "-", ascii_text).strip("-")


def select_manual(article_name: str) -> list[str]:
    """Accept exact slug, normalized slug, title, or unique title prefix.

    Empty and 'latest' select the most recently published article, not
    the most recently edited commit. Never guess between ambiguous matches.
    """
    articles = catalog()
    if not articles:
        raise ValueError("Nenhum artigo publicado encontrado.")
    query = normalize(article_name)
    if not query or query in {"latest", "ultimo", "mais-recente"}:
        newest = max(articles, key=lambda a: (a.get("publishedAt", ""), a["slug"]))
        return [newest["slug"]]

    matches = [a for a in articles if normalize(a["slug"]) == query
               or normalize(a["title"]) == query]
    if not matches:
        matches = [a for a in articles if normalize(a["title"]).startswith(query + "-")]
    if len(matches) != 1:
        if not matches:
            raise ValueError(f"Artigo {article_name!r} não encontrado. Consulte content/articles/.")
        raise ValueError(f"Nome ambíguo: {article_name!r}: " +
                         ", ".join(a["slug"] for a in matches))
    return [matches[0]["slug"]]


def added_slugs(before: str, after: str, repository: Path = ROOT) -> list[str]:
    if not SHA.fullmatch(before) or not SHA.fullmatch(after):
        raise ValueError("SHAs inválidos para comparação.")
    if before == "0" * 40:
        command = ["git", "diff-tree", "--root", "--no-commit-id", "--name-only",
                   "--diff-filter=A", "-r", "-z", after, "--", "content/articles/"]
    else:
        command = ["git", "diff", "--name-only", "--diff-filter=A", "-z",
                   before, after, "--", "content/articles/"]
    output = subprocess.run(command, cwd=repository, check=True,
                            capture_output=True).stdout.decode("utf-8")
    slugs = set()
    for path in output.split("\0"):
        if path.startswith("content/articles/") and path.endswith(".json"):
            slug = path.removeprefix("content/articles/")[:-5]
            if slug != "index" and SLUG.fullmatch(slug):
                slugs.add(slug)
    return sorted(slugs)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    origin = parser.add_mutually_exclusive_group(required=True)
    origin.add_argument("--article", help="Slug, título, ou vazio para o artigo mais recente")
    origin.add_argument("--all", action="store_true", help="Todos os artigos publicados, para backfill manual")
    origin.add_argument("--before", help="SHA do início do push automático")
    parser.add_argument("--after", help="SHA do final do push automático")
    args = parser.parse_args()
    if args.before:
        if not args.after:
            parser.error("--after é obrigatório com --before")
        result = added_slugs(args.before, args.after)
        for slug in result:
            read_article(slug)
    elif args.all:
        result = sorted(article["slug"] for article in catalog())
    else:
        result = select_manual(args.article or "")
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
