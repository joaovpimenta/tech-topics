"""Select Markdown-authored Tech Topics articles for automatic/manual Kokoro narration."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import tempfile
import unicodedata
from pathlib import Path

from narration_text import ElementTreeParser

ROOT = Path(__file__).resolve().parents[2]
ARTICLE_DIR = ROOT / "content" / "articles"
DIST_DIR = ROOT / "dist"
SLUG = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*\Z")
SHA = re.compile(r"[a-fA-F0-9]{40}\Z")
BUILD_ID = re.compile(r"[a-f0-9]{64}\Z")


def local_source_inventory(article_dir: Path = ARTICLE_DIR) -> dict[str, Path]:
    sources: dict[str, Path] = {}
    if not article_dir.is_dir():
        raise ValueError(f"Diretório de artigos não encontrado: {article_dir}")
    for path in sorted(article_dir.iterdir()):
        if path.suffix == ".json":
            raise ValueError(f"Arquivos JSON não são permitidos no diretório corrente de artigos: {path.name}")
        if path.suffix != ".md":
            continue
        slug = path.stem
        if not SLUG.fullmatch(slug):
            raise ValueError(f"Nome de fonte de artigo inválido: {path.name}")
        if path.is_symlink() or not path.is_file():
            raise ValueError(f"Fonte de artigo não é um arquivo regular: {path.name}")
        if slug in sources:
            raise ValueError(f"Duas fontes para o artigo {slug}: {sources[slug].name} e {path.name}")
        sources[slug] = path
    return sources


def _catalog_records(dist_dir: Path | None = None) -> tuple[list[dict], str | None, str | None, bool]:
    dist_dir = dist_dir or DIST_DIR
    path = dist_dir / "assets" / "articles-catalog.json"
    if path.is_symlink():
        raise ValueError("Catálogo HTML não pode ser link simbólico.")
    if not path.is_file():
        return [], None, None, False
    payload = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(payload, list):
        records, build_id, source_sha = payload, None, None
    elif isinstance(payload, dict) and isinstance(payload.get("articles"), list):
        records = payload["articles"]
        build_id, source_sha = payload.get("buildId"), payload.get("sourceSha")
        if set(payload) != {"version", "transport", "sourceSha", "buildId", "articles"} or payload.get("version") != 1:
            raise ValueError("Catálogo HTML deve usar o schema de identidade v1.")
        if payload.get("transport") != "html-v1":
            raise ValueError("Catálogo agregado deve declarar transport=html-v1.")
        if build_id is None or source_sha is None:
            raise ValueError("Catálogo HTML requer buildId e sourceSha.")
        if build_id is not None and (not isinstance(build_id, str) or not BUILD_ID.fullmatch(build_id)):
            raise ValueError("buildId do catálogo deve ser SHA-256 hexadecimal.")
        if source_sha is not None and (not isinstance(source_sha, str) or not SHA.fullmatch(source_sha)):
            raise ValueError("sourceSha do catálogo deve ser um SHA Git completo.")
    else:
        raise ValueError("Catálogo HTML inválido.")
    if not records:
        raise ValueError("Catálogo HTML não pode estar vazio.")
    slugs = [item.get("slug") for item in records if isinstance(item, dict)]
    if len(slugs) != len(records) or any(not isinstance(slug, str) or not SLUG.fullmatch(slug) for slug in slugs):
        raise ValueError("Catálogo HTML contém registro ou slug inválido.")
    if len(set(slugs)) != len(slugs):
        raise ValueError("Catálogo HTML contém slugs duplicados.")
    if any("bodyHtml" in item or "html" in item for item in records):
        raise ValueError("Catálogo HTML não pode carregar o corpo dos artigos.")
    if build_id and any(item.get("format") != "html-v1"
                        or item.get("path") != f"content/articles/{item['slug']}.html"
                        for item in records):
        raise ValueError("Registro do catálogo não aponta para o HTML compilado correspondente.")
    return records, build_id, source_sha, True


def _article_envelope(slug: str, dist_dir: Path | None = None,
                      expected_build_id: str | None = None) -> str | None:
    dist_dir = dist_dir or DIST_DIR
    path = dist_dir / "content" / "articles" / f"{slug}.html"
    if path.is_symlink():
        raise ValueError(f"HTML compilado não pode ser link simbólico: {slug}.")
    if not path.is_file():
        return None
    source = path.read_text(encoding="utf-8")
    parser = ElementTreeParser()
    parser.feed(source)
    parser.close()
    articles = [node for node in parser.root["children"]
                if isinstance(node, dict) and node.get("tag") == "article"]
    if len(articles) != 1:
        raise ValueError(f"HTML compilado inválido para {slug}: envelope ausente ou duplicado.")
    attrs = articles[0]["attrs"]
    build_id = attrs.get("data-build-id")
    if (attrs.get("data-article-format") != "html-v1"
            or attrs.get("data-article-slug") != slug
            or not build_id
            or (expected_build_id and build_id != expected_build_id)):
        raise ValueError(f"HTML compilado ou build ID incompatível para {slug}.")
    return source


def _current_sha(repository: Path = ROOT) -> str | None:
    try:
        return subprocess.run(["git", "rev-parse", "HEAD"], cwd=repository,
                              check=True, capture_output=True, text=True).stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        return None


def _compute_markdown_build_id(files: dict[str, bytes]) -> str:
    digest = hashlib.sha256()
    for file in sorted(files):
        if file == "sw-version.js":
            continue
        digest.update(file.encode("utf-8"))
        digest.update(b"\0")
        digest.update(files[file])
        digest.update(b"\0")
    return digest.hexdigest()


def _artifact_build_id(dist_dir: Path, catalog: dict) -> str:
    manifest_path = dist_dir / ".site-artifact.json"
    if manifest_path.is_symlink() or not manifest_path.is_file():
        raise ValueError("Manifesto de identidade HTML ausente ou inválido.")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if (not isinstance(manifest, dict) or manifest.get("version") != 2
            or manifest.get("format") != "html-v1"
            or manifest.get("sourceSha") != catalog.get("sourceSha")
            or manifest.get("buildId") != catalog.get("buildId")
            or not isinstance(manifest.get("files"), list)):
        raise ValueError("Manifesto e catálogo HTML não compartilham a mesma identidade.")

    declared = manifest["files"]
    if (any(not isinstance(file, str) or not file or "\\" in file
            or file.startswith("/") or ".." in Path(file).parts for file in declared)
            or len(set(declared)) != len(declared)):
        raise ValueError("Manifesto HTML contém caminhos inválidos ou duplicados.")
    actual: set[str] = set()
    for entry in dist_dir.rglob("*"):
        if entry.is_symlink():
            raise ValueError("Artefato HTML não pode conter links simbólicos.")
        if entry.is_file() and entry != manifest_path:
            actual.add(entry.relative_to(dist_dir).as_posix())
        elif not entry.is_file() and not entry.is_dir():
            raise ValueError("Artefato HTML contém uma entrada não regular.")
    if actual != set(declared):
        raise ValueError("Manifesto HTML e arquivos presentes no artefato divergem.")
    if "sw-version.js" not in declared:
        raise ValueError("Artefato HTML não contém o manifesto de cache da PWA.")
    if any(re.fullmatch(r"content/articles/[^/]+\.(?:json|md)", file) for file in actual):
        raise ValueError("Pacote HTML não pode conter fontes individuais de artigos.")

    base_catalog = {
        "version": catalog["version"],
        "transport": catalog["transport"],
        "articles": catalog["articles"],
    }
    catalog_bytes = (json.dumps(base_catalog, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
    if (dist_dir / "assets" / "articles-catalog.json").read_bytes() != (
            json.dumps(catalog, ensure_ascii=False, indent=2) + "\n").encode("utf-8"):
        raise ValueError("Catálogo HTML não está no formato canônico do compilador.")

    files: dict[str, bytes] = {}
    for file in declared:
        if file == "sw-version.js":
            continue
        content = (dist_dir / Path(file)).read_bytes()
        if file == "assets/articles-catalog.json":
            content = catalog_bytes
        elif file.startswith("content/articles/") and file.endswith(".html"):
            marker = f'data-build-id="{catalog["buildId"]}"'.encode("ascii")
            if content.count(b"data-build-id=") != 1 or content.count(marker) != 1:
                raise ValueError(f"Envelope HTML possui identidade ausente ou duplicada: {file}")
            content = content.replace(marker, f'data-build-id="{"0" * 64}"'.encode("ascii"), 1)
        files[file] = content

    return _compute_markdown_build_id(files)


def read_article(slug: str, article_dir: Path | None = None,
                 dist_dir: Path | None = None, expected_source_sha: str | None = None) -> dict:
    article_dir = article_dir or ARTICLE_DIR
    dist_dir = dist_dir or DIST_DIR
    if not SLUG.fullmatch(slug):
        raise ValueError(f"Slug inválido: {slug!r}")
    sources = local_source_inventory(article_dir)
    if slug not in sources:
        raise ValueError(f"Artigo não encontrado: {slug}")
    records, build_id, source_sha, _ = _catalog_records(dist_dir)
    current_sha = expected_source_sha
    if current_sha is None and article_dir.resolve() == ARTICLE_DIR.resolve():
        current_sha = _current_sha()
    if source_sha and current_sha and source_sha != current_sha:
        raise ValueError("O source SHA do catálogo não corresponde à revisão selecionada.")
    if build_id:
        envelope = _article_envelope(slug, dist_dir, build_id)
        record = next((item for item in records if item["slug"] == slug), None)
        if record is None:
            raise ValueError(f"Catálogo HTML não contém o artigo {slug}.")
        if envelope is None:
            raise ValueError(f"HTML compilado ausente para o artigo {slug}.")
        return {**record, "slug": slug, "html": envelope}
    raise ValueError(f"Fonte Markdown sem HTML compilado no artefato validado: {slug}")


def catalog(article_dir: Path | None = None, dist_dir: Path | None = None) -> list[dict]:
    article_dir = article_dir or ARTICLE_DIR
    dist_dir = dist_dir or DIST_DIR
    sources = local_source_inventory(article_dir)
    records, build_id, source_sha, catalog_exists = _catalog_records(dist_dir)
    if catalog_exists:
        if set(item["slug"] for item in records) != set(sources):
            raise ValueError("Catálogo HTML e inventário de fontes divergem.")
        current_sha = _current_sha() if article_dir.resolve() == ARTICLE_DIR.resolve() else None
        if source_sha and current_sha and source_sha != current_sha:
            raise ValueError("O source SHA do catálogo não corresponde à revisão corrente.")
        if build_id:
            for record in records:
                if _article_envelope(record["slug"], dist_dir, build_id) is None:
                    raise ValueError(f"HTML compilado ausente para o artigo {record['slug']}.")
        elif any(path.suffix == ".md" for path in sources.values()):
            raise ValueError("Corpus Markdown requer catálogo e HTML compilados pelo build validado.")
        return records
    if any(path.suffix == ".md" for path in sources.values()):
        raise ValueError("Corpus Markdown requer catálogo e HTML compilados pelo build validado.")
    return [read_article(slug, article_dir, dist_dir) for slug in sorted(sources)]


def validate_artifact_identity(expected_source_sha: str, expected_build_id: str,
                               article_dir: Path | None = None,
                               dist_dir: Path | None = None) -> dict:
    article_dir = article_dir or ARTICLE_DIR
    dist_dir = dist_dir or DIST_DIR
    if not SHA.fullmatch(expected_source_sha) or not BUILD_ID.fullmatch(expected_build_id):
        raise ValueError("SHA de fonte e buildId precisam ter formatos completos.")
    sources = local_source_inventory(article_dir)
    records, build_id, source_sha, catalog_exists = _catalog_records(dist_dir)
    if not catalog_exists or not build_id:
        raise ValueError("O build HTML validado não está disponível.")
    if source_sha != expected_source_sha:
        raise ValueError("O source SHA do artefato não corresponde à revisão esperada.")
    if build_id != expected_build_id:
        raise ValueError("O buildId do artefato não corresponde ao pacote do deploy.")
    actual_build_id = _artifact_build_id(dist_dir, {
        "version": 1,
        "transport": "html-v1",
        "articles": records,
        "sourceSha": source_sha,
        "buildId": build_id,
    })
    if actual_build_id != expected_build_id:
        raise ValueError("O conteúdo do artefato não corresponde ao buildId esperado.")
    if article_dir.resolve() == ARTICLE_DIR.resolve() and _current_sha() != expected_source_sha:
        raise ValueError("O checkout local não corresponde ao SHA de fonte esperado.")
    if {record["slug"] for record in records} != set(sources):
        raise ValueError("O catálogo HTML e o inventário de fontes divergem.")
    for record in records:
        if _article_envelope(record["slug"], dist_dir, build_id) is None:
            raise ValueError(f"HTML compilado ausente para o artigo {record['slug']}.")
    return {"sourceSha": source_sha, "buildId": build_id, "articles": len(records)}


def release_artifact_marker(source_sha: str, build_id: str) -> str:
    if not isinstance(source_sha, str) or not SHA.fullmatch(source_sha):
        raise ValueError("sourceSha precisa ser um SHA Git completo.")
    if not isinstance(build_id, str) or not BUILD_ID.fullmatch(build_id):
        raise ValueError("buildId precisa ser SHA-256 hexadecimal.")
    return f"<!-- TECH_TOPICS_ARTIFACT_V1 {source_sha} {build_id} -->"


def release_matches_artifact(notes: str, source_sha: str, build_id: str) -> bool:
    return release_artifact_marker(source_sha, build_id) in notes


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


def _git_sources(repository: Path, sha: str) -> dict[str, tuple[str, str, str]]:
    if sha == "0" * 40:
        raise ValueError("SHA zerado não pode representar um inventário vazio.")
    command = [os.environ.get("TECH_TOPICS_NODE", "node"),
               str(ROOT / "scripts" / "render-articles-at.mjs"),
               "--repository", str(repository), "--sha", sha.lower(), "--inventory-only"]
    try:
        output = subprocess.run(command, cwd=ROOT, check=True, capture_output=True,
                                text=True, encoding="utf-8").stdout
        records = json.loads(output)
    except (OSError, subprocess.CalledProcessError, json.JSONDecodeError) as error:
        detail = getattr(error, "stderr", "") or str(error)
        raise ValueError(f"Não foi possível enumerar fontes em {sha}: {detail.strip()}") from error
    if not isinstance(records, list):
        raise ValueError(f"Inventário inválido em {sha}.")
    sources: dict[str, tuple[str, str, str]] = {}
    for record in records:
        if not isinstance(record, dict):
            raise ValueError(f"Registro de fonte inválido em {sha}.")
        slug, path, blob, extension = (record.get("slug"), record.get("file"),
                                       record.get("blob"), record.get("extension"))
        if (not isinstance(slug, str) or not SLUG.fullmatch(slug)
                or path != f"content/articles/{slug}.{extension}"
                or extension not in {"json", "md"}
                or not isinstance(blob, str) or not re.fullmatch(r"[a-f0-9]{40}", blob)):
            raise ValueError(f"Registro de fonte inválido em {sha}: {record!r}")
        if slug in sources:
            raise ValueError(f"Duas fontes em {sha} para {slug}: {sources[slug][0]} e {path}")
        sources[slug] = (path, blob, extension)
    if not sources:
        raise ValueError(f"Nenhum artigo encontrado em {sha}.")
    return sources


def _blob_at(repository: Path, sha: str, path: str) -> str | None:
    result = subprocess.run(["git", "rev-parse", f"{sha}:{path}"], cwd=repository,
                            check=False, capture_output=True, text=True,
                            encoding="utf-8")
    return result.stdout.strip() if result.returncode == 0 else None


def _render_markdown_sources(repository: Path, sha: str, slugs: list[str]) -> dict[str, str]:
    if not slugs:
        return {}
    with tempfile.TemporaryDirectory(prefix="tech-topics-tts-html-") as directory:
        command = [os.environ.get("TECH_TOPICS_NODE", "node"),
                   str(ROOT / "scripts" / "render-articles-at.mjs"),
                   "--repository", str(repository), "--sha", sha,
                   "--output-dir", directory]
        for slug in sorted(set(slugs)):
            command.extend(["--slug", slug])
        subprocess.run(command, cwd=ROOT, check=True, capture_output=True, text=True,
                       encoding="utf-8")
        return {slug: (Path(directory) / f"{slug}.html").read_text(encoding="utf-8")
                for slug in sorted(set(slugs))}


def added_slugs(before: str, after: str, repository: Path = ROOT) -> list[str]:
    if (not SHA.fullmatch(before) or not SHA.fullmatch(after)
            or before == "0" * 40 or after == "0" * 40):
        raise ValueError("SHAs ausentes ou zerados para comparação.")
    previous = _git_sources(repository, before)
    current = _git_sources(repository, after)
    added = sorted(set(current) - set(previous))
    article_dir = repository / "content" / "articles"
    dist_dir = repository / "dist"
    for slug in added:
        source = current[slug]
        expected_sha = after if source[2] == "md" or repository.resolve() == ROOT.resolve() else None
        read_article(slug, article_dir, dist_dir, expected_sha)
    return added


def spoken_changes(before: str, after: str, repository: Path = ROOT) -> list[str]:
    """Modified existing JSON/Markdown sources whose spoken output changed."""
    if (not SHA.fullmatch(before) or not SHA.fullmatch(after)
            or before == "0" * 40 or after == "0" * 40):
        raise ValueError("SHAs ausentes ou zerados para revisão de artigos existentes.")
    old_sources = _git_sources(repository, before)
    new_sources = _git_sources(repository, after)
    changed = sorted(slug for slug in set(old_sources) & set(new_sources)
                     if old_sources[slug][1] != new_sources[slug][1])
    if not changed:
        return []
    for path in ("content/tts-lexicon.json", "tools/tts/narration_text.py",
                 "tools/tts/segmentation.py", "tools/tts/kokoro_release.py"):
        if _blob_at(repository, before, path) != _blob_at(repository, after, path):
            raise ValueError(f"Extrator ou léxico mudou entre os SHAs; comparação bloqueada: {path}")
    from narration_text import load_lexicon
    from kokoro_release import segments_for_article
    lexicon = load_lexicon()
    old_markdown = [slug for slug in changed if old_sources[slug][2] == "md"]
    new_markdown = [slug for slug in changed if new_sources[slug][2] == "md"]
    old_html = _render_markdown_sources(repository, before, old_markdown)
    new_html = _render_markdown_sources(repository, after, new_markdown)
    current_head = _current_sha(repository)
    dist_dir = repository / "dist"

    def at(sha: str, slug: str, record: tuple[str, str, str], rendered: dict[str, str], is_after: bool) -> dict:
        path, _, extension = record
        if extension == "json":
            value = subprocess.run(["git", "show", f"{sha}:{path}"], cwd=repository,
                                   check=True, capture_output=True, text=True,
                                   encoding="utf-8").stdout
            article = json.loads(value)
            if article.get("slug") != slug or article.get("language") != "pt-BR":
                raise ValueError(f"Artigo inválido: {slug}")
            return article
        if is_after and sha == current_head and repository.resolve() == ROOT.resolve():
            article = read_article(slug, ARTICLE_DIR, DIST_DIR, sha)
            if not isinstance(article.get("html"), str):
                raise ValueError(f"HTML validado do SHA corrente não está disponível para {slug}.")
            return article
        source = rendered.get(slug)
        if source is None:
            raise ValueError(f"HTML compilado ausente para {sha}:{slug}")
        return {"slug": slug, "html": source}

    selected = []
    for slug in changed:
        old = at(before, slug, old_sources[slug], old_html, False)
        new = at(after, slug, new_sources[slug], new_html, True)

        def signature(article: dict) -> list[tuple]:
            units = segments_for_article(article, lexicon)
            return [(unit["text"],
                     tuple((run["text"], run["lang"]) for run in unit["runs"]),
                     unit["pause_after_seconds"]) for unit in units]

        if signature(old) != signature(new):
            selected.append(slug)
    return selected


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    origin = parser.add_mutually_exclusive_group(required=True)
    origin.add_argument("--article", help="Slug, título, ou vazio para o artigo mais recente")
    origin.add_argument("--all", action="store_true", help="Todos os artigos publicados, para backfill manual")
    origin.add_argument("--before", help="SHA do início do push automático")
    origin.add_argument("--verify-artifact", action="store_true",
                        help="Validar a identidade do pacote HTML do deploy")
    parser.add_argument("--after", help="SHA do final do push automático")
    parser.add_argument("--build-id", help="Identidade SHA-256 esperada do pacote HTML")
    parser.add_argument("--spoken-changes", action="store_true",
                        help="Somente conteúdo de fala editado")
    args = parser.parse_args()
    if args.verify_artifact:
        if not args.after or not args.build_id:
            parser.error("--verify-artifact exige --after e --build-id")
        print(json.dumps(validate_artifact_identity(args.after, args.build_id), ensure_ascii=False))
        return
    if args.build_id:
        parser.error("--build-id só pode ser usado com --verify-artifact")
    if args.spoken_changes and not args.before:
        parser.error("--spoken-changes exige --before e --after")
    if args.before:
        if not args.after:
            parser.error("--after é obrigatório com --before")
        result = (spoken_changes(args.before, args.after)
                  if args.spoken_changes else added_slugs(args.before, args.after))
        for slug in result:
            read_article(slug)
    elif args.all:
        result = sorted(article["slug"] for article in catalog())
    else:
        result = select_manual(args.article or "")
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
