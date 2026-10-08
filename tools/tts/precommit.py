"""Generate missing local Chatterbox audio for staged article changes."""

from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import importlib.util
import json
import os
import re
import struct
import subprocess
import sys
import tempfile
from html.parser import HTMLParser
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
ARTICLES_DIR = Path("content/articles")
OUTPUT_DIR = ROOT / ".local" / "tts" / "output"
CONFIG_FILE = ROOT / ".local" / "tts" / "config.json"
GENERATOR = ROOT / "tools" / "tts" / "test_chatterbox.py"
GENERATION_DEFAULTS = {
    "language": "pt", "chunk_chars": 280, "pause_ms": 300,
    "exaggeration": 0.5, "temperature": 0.8, "cfg_weight": 0.5,
    "repetition_penalty": 1.5, "min_p": 0.05, "top_p": 1.0,
}
DEPENDENCIES = {"torch": "torch", "torchaudio": "torchaudio", "chatterbox": "chatterbox-tts"}


def git(*args: str) -> str:
    return subprocess.run(
        ["git", *args], cwd=ROOT, check=True, capture_output=True,
        text=True, encoding="utf-8",
    ).stdout


def local_config() -> dict:
    if not CONFIG_FILE.exists():
        return {}
    config = json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
    if not isinstance(config, dict):
        raise ValueError("Configuração TTS precisa ser um objeto JSON.")
    return config


def generation_settings() -> dict:
    overrides = local_config().get("generation", {})
    if not isinstance(overrides, dict) or set(overrides) - GENERATION_DEFAULTS.keys():
        raise ValueError("Campo generation inválido; consulte os parâmetros do gerador.")
    settings = {**GENERATION_DEFAULTS, **overrides}
    if settings["language"] != "pt":
        raise ValueError("A narração local dos artigos usa language=pt.")
    for key in ("chunk_chars", "pause_ms"):
        value = settings[key]
        if type(value) is not int or value < (1 if key == "chunk_chars" else 0):
            raise ValueError(f"Configuração inválida: {key}.")
    for key in GENERATION_DEFAULTS.keys() - {"language", "chunk_chars", "pause_ms"}:
        value = settings[key]
        if type(value) not in {int, float} or not 0 <= value <= 100:
            raise ValueError(f"Configuração inválida: {key}.")
    return settings


def assert_private_files(voice: Path | None = None) -> None:
    paths = [".local"]
    if voice is None:
        voice = voice_path()
    if voice is not None:
        try:
            paths.append(voice.resolve().relative_to(ROOT.resolve()).as_posix())
        except ValueError:
            pass
    if git("ls-files", "-z", "--", *paths).strip("\0"):
        raise ValueError("Arquivos privados TTS estão no índice Git; remova-os do índice antes de continuar.")


def digest_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def cache_identity(article: dict, voice: Path, settings: dict) -> dict:
    narration = article_narration(article)
    if not narration:
        raise ValueError("Não há prosa para narrar.")
    packages = {}
    for distribution in DEPENDENCIES.values():
        try:
            packages[distribution] = importlib.metadata.version(distribution)
        except importlib.metadata.PackageNotFoundError:
            packages[distribution] = None
    return {
        "schema": 1,
        "narration_sha256": hashlib.sha256(narration.encode("utf-8")).hexdigest(),
        "voice_sha256": digest_file(voice),
        "settings": settings,
        "generator_sha256": digest_file(GENERATOR),
        "extractor_sha256": digest_file(Path(__file__)),
        "packages": packages,
    }


def cache_matches(output: Path, identity: dict) -> bool:
    try:
        metadata = json.loads(output.with_suffix(".json").read_text(encoding="utf-8"))
        return (
            has_audio(output) and metadata.get("identity") == identity
            and metadata.get("audio_sha256") == digest_file(output)
        )
    except (OSError, ValueError, AttributeError):
        return False

VOID_TAGS = {
    "area", "base", "br", "col", "embed", "hr", "img", "input", "link",
    "meta", "param", "source", "track", "wbr",
}
IGNORED_TAGS = {"button", "code", "details", "nav", "pre", "script", "style", "svg"}
IGNORED_CLASSES = {
    "article-back", "fgs-simulator", "fgs-toc", "mermaid-diagram", "mermaid-fallback",
}
NARRATION_TAGS = {"h2", "h3", "p", "li", "figcaption", "th", "td"}
SLUG_PATTERN = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")


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
    return node["tag"] in IGNORED_TAGS or bool(classes(node) & IGNORED_CLASSES)


def descendant_has_tag(node: dict, tag: str) -> bool:
    for child in node["children"]:
        if isinstance(child, dict) and not is_ignored(child):
            if child["tag"] == tag or descendant_has_tag(child, tag):
                return True
    return False


def visible_text(node: dict) -> str:
    parts: list[str] = []

    def collect(current: dict | str) -> None:
        if isinstance(current, str):
            parts.append(current)
            return
        if is_ignored(current):
            return
        for child in current["children"]:
            collect(child)

    collect(node)
    return re.sub(r"\s+", " ", "".join(parts)).strip()


def narration_blocks(body_html: str) -> list[str]:
    parser = ElementTreeParser()
    parser.feed(body_html)
    parser.close()
    blocks: list[str] = []

    def visit(node: dict | str) -> None:
        if isinstance(node, str) or is_ignored(node):
            return

        tag = node["tag"]
        node_classes = classes(node)
        if tag == "div" and "article-callout" in node_classes and not descendant_has_tag(node, "p"):
            text = visible_text(node)
            if text:
                blocks.append(text)
            return

        if tag == "li" and not descendant_has_tag(node, "p"):
            text = visible_text(node)
            if text:
                blocks.append(text)
            return

        if tag in NARRATION_TAGS:
            text = visible_text(node)
            if text:
                blocks.append(text)
            return

        for child in node["children"]:
            visit(child)

    visit(parser.root)
    return blocks


def article_narration(article: dict) -> str:
    blocks = []
    for field in ("title", "dek"):
        value = article.get(field)
        if isinstance(value, str) and value.strip():
            blocks.append(re.sub(r"\s+", " ", value).strip())

    body_html = article.get("bodyHtml")
    if isinstance(body_html, str):
        blocks.extend(narration_blocks(body_html))
    return "\n\n".join(blocks).strip()


def staged_article_paths() -> list[str]:
    result = git("diff", "--cached", "--name-only", "-z", "--diff-filter=ACMR", "--", ARTICLES_DIR.as_posix())
    paths = []
    for raw_path in result.split("\0"):
        if not raw_path:
            continue
        candidate = Path(raw_path.replace("\\", "/"))
        if candidate.parent == ARTICLES_DIR and candidate.suffix == ".json" and candidate.name != "index.json":
            paths.append(candidate.as_posix())
    return sorted(paths)


def read_staged_article(article_path: str) -> dict:
    result = subprocess.run(
        ["git", "show", f":{article_path}"],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
        encoding="utf-8",
    )
    article = json.loads(result.stdout)
    if not isinstance(article, dict):
        raise ValueError(f"{article_path}: o conteúdo precisa ser um objeto JSON.")
    slug = article.get("slug")
    expected_slug = Path(article_path).stem
    if not isinstance(slug, str) or not SLUG_PATTERN.fullmatch(slug) or slug != expected_slug:
        raise ValueError(f"{article_path}: slug inválido ou diferente do nome do arquivo.")
    return article


def voice_path() -> Path | None:
    configured = os.environ.get("TECH_TOPICS_TTS_VOICE")
    if not configured and CONFIG_FILE.exists():
        configured = local_config().get("voice")

    if not isinstance(configured, str) or not configured.strip():
        return None
    voice = Path(configured).expanduser()
    return voice if voice.is_absolute() else ROOT / voice


def configured_voice() -> Path:
    voice = voice_path()
    if voice is None:
        raise ValueError(
            "Escolha uma amostra local de voz em .local/tts/config.json "
            '(campo "voice") ou defina TECH_TOPICS_TTS_VOICE. O arquivo de configuração '
            "fica ignorado pelo Git."
        )

    if not voice.is_file():
        raise ValueError("A amostra configurada não foi encontrada; ela precisa permanecer local.")
    if not has_audio(voice):
        raise ValueError("A amostra configurada precisa ser um WAV válido e completo.")
    return voice


def has_audio(path: Path) -> bool:
    """Validate complete PCM/IEEE float RIFF chunks without importing audio libraries."""
    try:
        file_size = path.stat().st_size
        with path.open("rb") as audio:
            header = audio.read(12)
            if len(header) != 12 or header[:4] != b"RIFF" or header[8:] != b"WAVE":
                return False

            riff_end = struct.unpack("<I", header[4:8])[0] + 8
            if riff_end > file_size or riff_end < 12:
                return False

            offset = 12
            format_ok = False
            channels = 0
            block_align = 0
            data_size = 0

            while offset + 8 <= riff_end:
                audio.seek(offset)
                chunk_header = audio.read(8)
                if len(chunk_header) != 8:
                    return False

                chunk_id = chunk_header[:4]
                chunk_size = struct.unpack("<I", chunk_header[4:])[0]
                chunk_start = offset + 8
                chunk_end = chunk_start + chunk_size
                if chunk_end > riff_end:
                    return False

                if chunk_id == b"fmt ":
                    if chunk_size < 16:
                        return False
                    audio_format, channels, sample_rate, byte_rate, block_align, bits_per_sample = struct.unpack(
                        "<HHIIHH", audio.read(16)
                    )
                    if audio_format == 0xFFFE and chunk_size >= 40:
                        audio.seek(chunk_start + 24)
                        subtype = audio.read(16)
                        if subtype[4:] == bytes.fromhex("00001000800000aa00389b71"):
                            audio_format = struct.unpack("<I", subtype[:4])[0]
                    format_ok = (
                        audio_format in {1, 3}
                        and channels > 0
                        and sample_rate > 0
                        and bits_per_sample in ({8, 16, 24, 32} if audio_format == 1 else {32, 64})
                        and block_align == channels * bits_per_sample // 8
                        and byte_rate == sample_rate * block_align
                    )
                elif chunk_id == b"data":
                    data_size = chunk_size

                offset = chunk_end + (chunk_size & 1)

            return (
                offset == riff_end
                and format_ok
                and data_size > 0
                and block_align > 0
                and data_size % block_align == 0
            )
    except (OSError, struct.error):
        return False


def generate(article_path: str, article: dict, voice: Path, settings: dict, identity: dict) -> None:
    slug = article["slug"]
    narration = article_narration(article)
    if not narration:
        raise ValueError(f"{article_path}: não há prosa para narrar.")

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    output_path = OUTPUT_DIR / f"{slug}.wav"
    metadata_path = output_path.with_suffix(".json")
    # Invalidate first: an interrupted or failed regeneration cannot reuse old audio.
    metadata_path.unlink(missing_ok=True)
    temp_dir = ROOT / ".local" / "tts" / "tmp"
    temp_dir.mkdir(parents=True, exist_ok=True)

    with tempfile.NamedTemporaryFile(
        mode="w", encoding="utf-8", suffix=".txt", prefix=f"{slug}-", dir=temp_dir, delete=False
    ) as source:
        source.write(narration)
        input_path = Path(source.name)
    with tempfile.NamedTemporaryFile(suffix=".wav", prefix=f"{slug}-", dir=temp_dir, delete=False) as output:
        temporary_output = Path(output.name)

    try:
        print(f"TTS: gerando {slug} com Chatterbox (o áudio ficará em .local/tts/output).")
        command = [
            sys.executable, str(GENERATOR), str(input_path),
            "--output", str(temporary_output), "--voice", str(voice),
        ]
        for key, value in settings.items():
            command.extend(["--" + key.replace("_", "-"), str(value)])
        result = subprocess.run(
            command,
            cwd=ROOT,
            check=False,
            stdout=sys.stderr,
        )
        if result.returncode != 0:
            raise RuntimeError(f"Chatterbox falhou ao gerar o áudio para {slug}.")
        if not has_audio(temporary_output):
            raise RuntimeError(f"Chatterbox não produziu um WAV válido para {slug}.")
        temporary_output.replace(output_path)
        metadata = {"identity": identity, "audio_sha256": digest_file(output_path)}
        # Metadata is the success marker and is written only after complete audio.
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", suffix=".json", dir=temp_dir, delete=False) as marker:
            marker_path = Path(marker.name)
            json.dump(metadata, marker, ensure_ascii=False, indent=2)
        try:
            marker_path.replace(metadata_path)
        finally:
            marker_path.unlink(missing_ok=True)
    finally:
        input_path.unlink(missing_ok=True)
        temporary_output.unlink(missing_ok=True)
    print(f"TTS: áudio local pronto para {slug}.")


def check_staged() -> dict:
    assert_private_files()
    paths = staged_article_paths()
    if not paths:
        return {"ok": True, "articles": []}
    voice = configured_voice()
    assert_private_files(voice)
    settings = generation_settings()
    if not GENERATOR.is_file():
        raise ValueError("O gerador tools/tts/test_chatterbox.py não foi encontrado.")
    results = []
    for article_path in paths:
        article = read_staged_article(article_path)
        identity = cache_identity(article, voice, settings)
        output_path = OUTPUT_DIR / f"{article['slug']}.wav"
        reused = cache_matches(output_path, identity)
        if not reused:
            generate(article_path, article, voice, settings, identity)
        results.append({"slug": article["slug"], "reused": reused})
    return {"ok": True, "articles": results}


def doctor() -> dict:
    checks = []
    def record(name: str, action) -> None:
        try:
            detail = action()
            checks.append({"name": name, "ok": True, "detail": detail})
        except (OSError, ValueError, subprocess.CalledProcessError) as error:
            checks.append({"name": name, "ok": False, "detail": str(error)})
    record("python", lambda: sys.version.split()[0])
    record("private_files", assert_private_files)
    record("voice", lambda: (assert_private_files(configured_voice()), "WAV local válido")[1])
    record("settings", generation_settings)
    def generator_available():
        if not GENERATOR.is_file():
            raise ValueError("Gerador TTS ausente.")
        return "disponível"
    record("generator", generator_available)
    for module in DEPENDENCIES:
        def available(name=module):
            if importlib.util.find_spec(name) is None:
                raise ValueError(f"Dependência ausente: {name}; instale no ambiente Python local.")
            return "disponível (sem importar modelos)"
        record(module, available)
    hook = subprocess.run(["git", "config", "--get", "core.hooksPath"], cwd=ROOT, capture_output=True, text=True)
    hook_path = hook.stdout.strip() if hook.returncode == 0 else None
    return {"ok": all(check["ok"] for check in checks), "python": sys.executable,
            "hook": {"path": hook_path, "enabled": hook_path == ".githooks"}, "checks": checks}


def prepare(install_hook: bool) -> dict:
    assert_private_files()
    for directory in (OUTPUT_DIR, ROOT / ".local" / "tts" / "voices", ROOT / ".local" / "tts" / "tmp"):
        directory.mkdir(parents=True, exist_ok=True)
    if not CONFIG_FILE.exists():
        CONFIG_FILE.write_text(json.dumps({"voice": "", "generation": GENERATION_DEFAULTS}, indent=2) + "\n", encoding="utf-8")
    if install_hook:
        current = subprocess.run(["git", "config", "--get", "core.hooksPath"], cwd=ROOT, capture_output=True, text=True)
        if current.returncode == 0 and current.stdout.strip() != ".githooks":
            raise ValueError("core.hooksPath já aponta para outro hook; preserve essa configuração e integre manualmente.")
        git("config", "--local", "core.hooksPath", ".githooks")
    return {"ok": True, "config": ".local/tts/config.json", "hook_installed": install_hook,
            "next": "Escolha voice no config e execute doctor; instale as dependências localmente se faltarem."}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Narração local dos artigos staged; preparação e diagnóstico explícitos.")
    parser.add_argument("command", nargs="?", choices=("check", "doctor", "prepare"), default="check")
    parser.add_argument("--json", action="store_true", help="Emite o resultado estruturado em stdout.")
    parser.add_argument("--install-hook", action="store_true", help="Em prepare, configura explicitamente core.hooksPath para este clone.")
    args = parser.parse_args(argv)
    if args.install_hook and args.command != "prepare":
        parser.error("--install-hook exige prepare")
    try:
        # Generator progress belongs on stderr so --json remains machine readable.
        from contextlib import redirect_stdout
        with redirect_stdout(sys.stderr):
            if args.command == "prepare":
                result = prepare(args.install_hook)
            elif args.command == "doctor":
                result = doctor()
            else:
                result = check_staged()
    except (OSError, ValueError, subprocess.CalledProcessError, RuntimeError) as error:
        result = {"ok": False, "error": str(error)}
    if args.json:
        # ASCII JSON also remains UTF-8 compatible when Windows stdout uses a legacy code page.
        print(json.dumps(result, ensure_ascii=True))
    else:
        print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
