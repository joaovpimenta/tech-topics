"""Summarize codec-only listening variants created from one normalized WAV.

Standard library only. Checks file metadata with ffprobe, NOT subjective
quality; true peak/loudness settings are held fixed by the encoding workflow.
"""

from __future__ import annotations

import argparse
import json
import subprocess
from pathlib import Path

VARIANTS = (
    ("mp3-96", "{slug}.mp3", "mp3", 96_000),
    ("mp3-128", "{slug}-128k.mp3", "mp3", 128_000),
    ("mp3-160", "{slug}-160k.mp3", "mp3", 160_000),
    ("wav-lossless", "{slug}-lossless.wav", "pcm_s16le", None),
)


def inspect_audio(path: Path) -> dict:
    completed = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries",
         "format=duration,size,bit_rate:stream=codec_name,sample_rate,channels,bit_rate",
         "-of", "json", str(path)],
        capture_output=True, text=True, check=True,
    )
    data = json.loads(completed.stdout)
    streams = data.get("streams") or []
    if len(streams) != 1:
        raise ValueError(f"Expected one audio stream in {path}")
    audio = streams[0]
    fmt = data["format"]
    return {
        "codec": audio.get("codec_name"),
        "sample_rate_hz": int(audio["sample_rate"]),
        "channels": int(audio["channels"]),
        "bitrate_bps": int(fmt.get("bit_rate") or audio.get("bit_rate") or 0),
        "duration_seconds": round(float(fmt["duration"]), 3),
        "bytes": int(fmt["size"]),
    }


def collect_review(slug: str, directory: Path, probe=inspect_audio) -> dict:
    results = []
    for label, template, codec, bitrate in VARIANTS:
        path = directory / template.format(slug=slug)
        if not path.is_file() or path.stat().st_size == 0:
            raise ValueError(f"Missing audio variant: {path}")
        measured = probe(path)
        if measured["codec"] != codec:
            raise ValueError(f"Unexpected codec in {path}: {measured['codec']}")
        if measured["channels"] != 1 or measured["sample_rate_hz"] != 24000:
            raise ValueError(f"Unexpected audio format in {path}: {measured}")
        if not measured["duration_seconds"] or not measured["bytes"]:
            raise ValueError(f"Invalid media dimensions in {path}")
        if bitrate and not bitrate * 0.94 <= measured["bitrate_bps"] <= bitrate * 1.06:
            raise ValueError(f"Bitrate mismatch for {path}: {measured['bitrate_bps']}")
        results.append({"name": label, "file": path.name, **measured})
    durations = [item["duration_seconds"] for item in results]
    # MP3 encoder padding is expected, but not changed underlying narration.
    if max(durations) - min(durations) > 0.15:
        raise ValueError(f"Unexpected codec duration differences: {durations}")
    reference_bytes = results[0]["bytes"]
    return {
        "schema_version": 1,
        "voice": "pf_dora",
        "prosody": "equilibrado",
        "speed": 1.0,
        "normalization": {"I": -19, "TP": -1, "LRA": 11},
        "origin": "Same normalized 24-kHz PCM WAV; only encoder changes",
        "variants": [
            {**item, "size_vs_96_percent": round(item["bytes"] / reference_bytes * 100, 1)}
            for item in results
        ],
    }


def markdown(review: dict) -> str:
    lines = [
        "### Codec A/B — equilibrado-100 (uma única síntese)",
        "",
        "Todas as variantes usam exatamente o mesmo WAV já normalizado "
        "em -19 LUFS, TP -1 dBTP, LRA 11. Análise de metadados não prova "
        "qualidade perceptiva.",
        "",
        "| Variante | Codec | Bitrate medido | Duração | Tamanho | Vs 96 kbps |",
        "|---|---|---:|---:|---:|---:|",
    ]
    for entry in review["variants"]:
        bitrate = (f"{entry['bitrate_bps'] / 1000:.1f} kbps" if entry["codec"] == "mp3"
                   else "PCM sem perdas")
        lines.append(
            f"| `{entry['name']}` | {entry['codec']} | {bitrate} | "
            f"{entry['duration_seconds']:.2f} s | "
            f"{entry['bytes'] / 1024:.0f} KiB | {entry['size_vs_96_percent']:.1f}% |"
        )
    lines += ["", "Ouvir especialmente sibilantes, letras iniciais/finais e ruídos "
              "entre frases. Escolher bitrate só após avaliação auditiva."]
    return "\n".join(lines) + "\n"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--slug", required=True)
    parser.add_argument("--directory", type=Path, required=True)
    args = parser.parse_args()
    review = collect_review(args.slug, args.directory)
    (args.directory / "codec-comparison.json").write_text(
        json.dumps(review, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(markdown(review))


if __name__ == "__main__":
    main()
