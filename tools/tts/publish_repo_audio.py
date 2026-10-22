"""Commit finished article MP3s to a dedicated, unprotected `audio` branch.

Does not amend main, modify a published article, or trigger a Pages rebuild.
Uses only git and the standard library; the workflow's GITHUB_TOKEN authenticates
the push. Return "fallback" if the host rejects a commit or file is too large.
"""

from __future__ import annotations

import argparse
import os
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path

SLUG = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*\Z")
MAX_BYTES = 45 * 1024 * 1024
RETRIES = 4


def run_git(*args: str, cwd: Path, check: bool = True) -> subprocess.CompletedProcess:
    proc = subprocess.run(
        ["git", *args], cwd=cwd, text=True, encoding="utf-8",
        capture_output=True, check=False,
    )
    if check and proc.returncode:
        raise RuntimeError(f"git {' '.join(args)}: {proc.stderr.strip()}")
    return proc


def publish(
    slug: str, source: Path, repository: Path, *, replace: bool = False,
    remote: str = "origin", max_bytes: int = MAX_BYTES, retries: int = RETRIES,
    sleep=lambda _: None,
) -> str:
    """Return published, skipped or fallback.

    Writers may run in parallel for different articles. A rejected push is
    retried against the new tip of the branch, preserving earlier MP3s.
    """
    if not SLUG.fullmatch(slug):
        raise ValueError(f"Slug inválida: {slug!r}")
    source = source.resolve()
    repository = repository.resolve()
    if not source.is_file() or source.stat().st_size == 0:
        raise ValueError(f"MP3 ausente ou vazio: {source}")
    if source.suffix.lower() != ".mp3":
        raise ValueError(f"Arquivo não é MP3: {source}")
    if not run_git("rev-parse", "--show-toplevel", cwd=repository).stdout.strip():
        raise ValueError("Não é um repositório Git")
    if source.stat().st_size > max_bytes:
        print(f"MP3 acima de {max_bytes} bytes; usar Release de contingência.", file=sys.stderr)
        return "fallback"

    run_git("config", "user.name", "github-actions[bot]", cwd=repository)
    run_git("config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com", cwd=repository)
    target = f"audio/{slug}.mp3"
    # All changes happen in a scratch branch; 'main' remains unchanged.
    for attempt in range(1, retries + 1):
        scratch = f"tts-audio-upload-{attempt}"
        result = run_git("ls-remote", "--heads", remote, "refs/heads/audio", cwd=repository, check=False)
        if result.returncode != 0:
            print(f"Falha consultando branch audio: {result.stderr.strip()}", file=sys.stderr)
            return "fallback"
        if result.stdout.strip():
            try:
                run_git("fetch", "--quiet", remote, "refs/heads/audio", cwd=repository)
                run_git("switch", "-C", scratch, "FETCH_HEAD", cwd=repository)
            except RuntimeError as exc:
                print(str(exc), file=sys.stderr)
                return "fallback"
            if not replace and run_git("cat-file", "-e", f"HEAD:{target}", cwd=repository, check=False).returncode == 0:
                return "skipped"
        else:
            # Only media files live in the orphan branch; no copy of the site.
            run_git("switch", "--orphan", scratch, cwd=repository)

        destination = repository / target
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, destination)
        # The site's .gitignore ignores *.mp3 by default.
        run_git("add", "-f", "--", target, cwd=repository)
        if run_git("diff", "--cached", "--quiet", cwd=repository, check=False).returncode == 0:
            return "skipped"
        run_git("commit", "--quiet", "-m", f"audio(tts): Kokoro Dora para {slug} [skip ci]", cwd=repository)
        pushed = run_git("push", remote, "HEAD:refs/heads/audio", cwd=repository, check=False)
        if pushed.returncode == 0:
            return "published"
        print(f"Push audio tentativa {attempt}/{retries}: {pushed.stderr.strip()}", file=sys.stderr)
        if attempt < retries:
            sleep(min(2 * attempt, 8))
    return "fallback"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--slug", required=True)
    parser.add_argument("--mp3", type=Path, required=True)
    parser.add_argument("--repository", type=Path, default=Path("."))
    parser.add_argument("--replace-existing", action="store_true")
    args = parser.parse_args()
    print(publish(
        args.slug, args.mp3, args.repository,
        replace=args.replace_existing,
        sleep=time.sleep,
    ))


if __name__ == "__main__":
    main()
