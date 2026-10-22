"""Select published articles and prepare narrations for Piper (stdlib only).

Reuses the local Chatterbox narration extractor so content/tts-lexicon.json,
speechMarkup and non-narrative HTML exclusions have identical semantics.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
from pathlib import Path

from precommit import article_narration, load_lexicon

ROOT = Path(__file__).resolve().parents[2]
ARTICLE_DIR = ROOT / "content" / "articles"
SLUG = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*\Z")
SHA = re.compile(r"[a-fA-F0-9]{40}\Z")


def read_article(slug: str) -> dict:
    """Reject non-slugs before resolving a path in the repository."""
    if not SLUG.fullmatch(slug):
        raise ValueError("Slug inválido; use o nome do JSON sem .json.")
    article_path = ARTICLE_DIR / f"{slug}.json"
    if not article_path.is_file():
        raise ValueError(f"Artigo não encontrado: {article_path}")
    article = json.loads(article_path.read_text(encoding="utf-8"))
    if article.get("slug") != slug or article.get("language") != "pt-BR":
        raise ValueError(f"Contrato ou idioma inválido para o artigo: {slug}")
    return article


def added_slugs(before: str, after: str, repository: Path = ROOT) -> list[str]:
    """Select only newly added article JSONs between push SHAs, not index changes."""
    if not SHA.fullmatch(before) or not SHA.fullmatch(after):
        raise ValueError("Commits inválidos para comparação.")
    if before == "0" * 40:
        command = ["git", "diff-tree", "--root", "--no-commit-id", "--name-only",
                   "--diff-filter=A", "-r", "-z", after, "--", "content/articles/"]
    else:
        command = ["git", "diff", "--name-only", "--diff-filter=A", "-z",
                   before, after, "--", "content/articles/"]
    result = subprocess.run(command, cwd=repository, check=True, capture_output=True)
    slugs = set()
    for name in result.stdout.decode("utf-8").split("\0"):
        prefix = "content/articles/"
        if not name.startswith(prefix) or not name.endswith(".json"):
            continue
        slug = name[len(prefix):-5]
        if SLUG.fullmatch(slug) and slug != "index":
            slugs.add(slug)
    return sorted(slugs)


def prepare(slug: str, output_dir: Path) -> None:
    article = read_article(slug)
    narration = article_narration(article, load_lexicon())
    if not narration.strip():
        raise ValueError(f"Sem conteúdo narrável: {slug}")

    # Piper consumes one paragraph per line and joins all lines in a single WAV.
    # Preserve paragraph boundaries without sending code/HTML to the synthesizer.
    paragraphs = [" ".join(paragraph.split()) for paragraph in narration.split("\n\n")]
    paragraphs = [paragraph for paragraph in paragraphs if paragraph]
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / f"{slug}.txt").write_text("\n".join(paragraphs) + "\n", encoding="utf-8")

    title = article["title"]
    page = f"https://joaovpimenta.github.io/tech-topics/article.html?slug={slug}"
    notes = (
        f"Áudio do artigo **{title}** do Tech Topics.\n\n"
        f"Artigo original: {page}\n\n"
        "Gerado automaticamente em CPU com Piper TTS 1.8.0, "
        "voz pt_BR-cadu-medium (português brasileiro).\n"
        "A geração automática não substitui uma revisão auditiva editorial.\n"
    )
    (output_dir / f"{slug}.md").write_text(notes, encoding="utf-8")
    print(f"Preparado: {slug}; {len(paragraphs)} blocos; {len(narration)} caracteres.")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    subs = parser.add_subparsers(dest="command", required=True)
    selection = subs.add_parser("slugs", help="JSON array de slugs a narrar")
    origin = selection.add_mutually_exclusive_group(required=True)
    origin.add_argument("--slug", help="Slug para execução manual")
    origin.add_argument("--before", help="SHA anterior ao push")
    selection.add_argument("--after", help="SHA do push")
    preparation = subs.add_parser("prepare", help="Roteiro e release notes")
    preparation.add_argument("--slug", required=True)
    preparation.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()

    if args.command == "slugs":
        if args.slug is not None:
            read_article(args.slug)
            values = [args.slug]
        else:
            if not args.after:
                parser.error("--after é obrigatório com --before")
            values = added_slugs(args.before, args.after)
            for value in values:
                read_article(value)
        print(json.dumps(values, ensure_ascii=False))
    else:
        prepare(args.slug, args.output_dir)


if __name__ == "__main__":
    main()
