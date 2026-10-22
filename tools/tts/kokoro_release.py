"""Prepare and synthesize editorial PT-BR article audio with Kokoro ONNX.

Uses the shared Tech Topics text extraction/lexicon. No GPU or external TTS API.
Heavy dependencies are imported only by the synthesize command.
"""

from __future__ import annotations

import argparse
import json
import re
import time
from pathlib import Path

from piper_release import read_article
from precommit import (
    ElementTreeParser,
    article_narration,
    is_ignored,
    load_lexicon,
    visible_text,
)

VOICE = "pf_dora"
LANG = "pt-br"
SPEED = 0.95
MAX_CHARS_PER_CHUNK = 240
PARAGRAPH_PAUSE_SECONDS = 0.45
SECTION_PAUSE_SECONDS = 0.80
CHUNK_PAUSE_SECONDS = 0.18
# Kokoro v1.0 ONNX model uses 24 kHz audio.
SAMPLE_RATE = 24000


def heading_texts(html: str, lexicon: dict) -> set[str]:
    parser = ElementTreeParser()
    parser.feed(html)
    parser.close()
    headings: set[str] = set()

    def visit(node: dict | str) -> None:
        if isinstance(node, str) or is_ignored(node):
            return
        if node["tag"] in {"h2", "h3", "h4"}:
            value = visible_text(node, lexicon)
            if value:
                headings.add(value)
        for child in node["children"]:
            visit(child)

    visit(parser.root)
    return headings


def split_long(text: str, max_chars: int = MAX_CHARS_PER_CHUNK) -> list[str]:
    """Split at sentences when possible, then at words. No content is dropped."""
    text = " ".join(text.split())
    if not text:
        return []
    sentences = re.split(r"(?<=[.!?;])\s+", text)
    pieces: list[str] = []
    for sentence in sentences:
        words = sentence.split()
        current = ""
        for word in words:
            if len(word) > max_chars:
                if current:
                    pieces.append(current)
                    current = ""
                pieces.extend(word[i:i + max_chars] for i in range(0, len(word), max_chars))
                continue
            candidate = f"{current} {word}".strip()
            if current and len(candidate) > max_chars:
                pieces.append(current)
                current = word
            else:
                current = candidate
        if current:
            pieces.append(current)

    # Combine small sentences to avoid unnecessarily short model calls.
    merged: list[str] = []
    for piece in pieces:
        if merged and len(merged[-1]) + len(piece) + 1 <= max_chars:
            merged[-1] += " " + piece
        else:
            merged.append(piece)
    return merged


def segments_for_article(article: dict, lexicon: dict, max_chars: int = 0) -> list[dict]:
    narration = article_narration(article, lexicon)
    blocks = narration.split("\n\n") if narration else []
    headings = heading_texts(article.get("bodyHtml", ""), lexicon)
    segments: list[dict] = []
    total = 0

    for i, block in enumerate(blocks):
        chunks = split_long(block)
        is_section = i == 0 or (i >= 2 and block in headings)
        for j, chunk in enumerate(chunks):
            if max_chars and total >= max_chars:
                break
            segments.append({
                "text": chunk,
                "pause_after_seconds": (
                    SECTION_PAUSE_SECONDS if is_section else PARAGRAPH_PAUSE_SECONDS
                ) if j == len(chunks) - 1 else CHUNK_PAUSE_SECONDS,
            })
            total += len(chunk)
        if max_chars and total >= max_chars:
            break
    if not segments:
        raise ValueError("O artigo não contém prosa narrável.")
    return segments


def prepare(slug: str, output_dir: Path, max_chars: int = 0) -> None:
    article = read_article(slug)
    if max_chars < 0:
        raise ValueError("--max-chars deve ser >= 0")
    segments = segments_for_article(article, load_lexicon(), max_chars)
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / f"{slug}.segments.json").write_text(
        json.dumps(segments, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    # Exactly the same input snippets will be used for the Piper A/B test.
    (output_dir / f"{slug}.txt").write_text(
        "\n".join(s["text"] for s in segments) + "\n", encoding="utf-8"
    )
    notes = (
        f"Áudio do artigo **{article['title']}** do Tech Topics.\n\n"
        f"Artigo: https://joaovpimenta.github.io/tech-topics/article.html?slug={slug}\n\n"
        "Gerado localmente no GitHub Actions com Kokoro-82M v1.0 FP32, "
        f"voz {VOICE}, velocidade {SPEED}, idioma {LANG}. "
        "Narração editorial, léxico Tech Topics, MP3 mono 96 kbps.\n"
        "A pronúncia de termos técnicos e a qualidade precisam de revisão auditiva.\n"
    )
    (output_dir / f"{slug}.md").write_text(notes, encoding="utf-8")
    print(f"Preparado {slug}: {len(segments)} segmentos, "
          f"{sum(len(s['text']) for s in segments)} caracteres.")


def synthesize(slug: str, output_dir: Path, model: Path, voices: Path) -> None:
    # Imported lazily so the standard-library-only unit tests remain lightweight.
    import numpy as np
    import onnxruntime as ort
    import soundfile as sf
    from kokoro_onnx import Kokoro
    from misaki.espeak import EspeakG2P

    segments = json.loads((output_dir / f"{slug}.segments.json").read_text(encoding="utf-8"))
    if not segments:
        raise ValueError("Nenhum segmento preparado.")
    sess_options = ort.SessionOptions()
    sess_options.intra_op_num_threads = 4
    session = ort.InferenceSession(
        str(model), sess_options=sess_options, providers=["CPUExecutionProvider"]
    )
    kokoro = Kokoro.from_session(session, str(voices))
    g2p = EspeakG2P(language=LANG)

    start = time.perf_counter()
    generated_samples = 0
    destination = output_dir / f"{slug}.wav"
    with sf.SoundFile(
        destination, mode="w", samplerate=SAMPLE_RATE, channels=1, subtype="PCM_16"
    ) as wav:
        for i, item in enumerate(segments, start=1):
            phonemes, _ = g2p(item["text"])
            if not phonemes:
                raise ValueError(f"Fonemização vazia no segmento {i}")
            audio, sample_rate = kokoro.create(
                phonemes, voice=VOICE, speed=SPEED, is_phonemes=True
            )
            if sample_rate != SAMPLE_RATE or len(audio) == 0:
                raise ValueError(f"Áudio inválido no segmento {i}: {sample_rate}")
            wav.write(audio)
            generated_samples += len(audio)
            pause = int(SAMPLE_RATE * item["pause_after_seconds"])
            wav.write(np.zeros(pause, dtype=np.float32))
            generated_samples += pause
            if i % 20 == 0 or i == len(segments):
                print(f"Kokoro: {i}/{len(segments)} segmentos", flush=True)

    elapsed = time.perf_counter() - start
    duration = generated_samples / SAMPLE_RATE
    report = {
        "engine": "kokoro-onnx",
        "model": "kokoro-v1.0.onnx",
        "precision": "fp32",
        "voice": VOICE,
        "language": LANG,
        "speed": SPEED,
        "segments": len(segments),
        "audio_seconds": round(duration, 2),
        "synthesis_seconds": round(elapsed, 2),
        "real_time_factor": round(elapsed / duration, 3) if duration else None,
    }
    (output_dir / f"{slug}.metrics.json").write_text(
        json.dumps(report, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps(report, ensure_ascii=False), flush=True)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["prepare", "synthesize"])
    parser.add_argument("--slug", required=True)
    parser.add_argument("--output-dir", type=Path, default=Path(".audio"))
    parser.add_argument("--max-chars", type=int, default=0)
    parser.add_argument("--model", type=Path)
    parser.add_argument("--voices", type=Path)
    args = parser.parse_args()
    if args.command == "prepare":
        prepare(args.slug, args.output_dir, args.max_chars)
    else:
        if not args.model or not args.voices:
            parser.error("--model e --voices são obrigatórios para synthesize")
        synthesize(args.slug, args.output_dir, args.model, args.voices)


if __name__ == "__main__":
    main()
