"""Kokoro Dora article audio, using semantic PT-BR/EN-US phonemization.

The visible article remains untouched. Language spans survive extraction and
chunking, so an English term can be phonemized in the same Kokoro inference as
its Portuguese sentence (no audio splicing or second narrator).
"""

from __future__ import annotations

import argparse
import json
import re
import time
from pathlib import Path

from article_selection import read_article
from precommit import (
    ElementTreeParser,
    NARRATION_TAGS,
    classes,
    descendant_has_tag,
    is_ignored,
    load_lexicon,
    spell,
    visible_text,
)

VOICE = "pf_dora"
LANG = "pt-br"
ENGLISH = "en-us"
SPEED = 0.95
MAX_CHARS_PER_CHUNK = 240
PARAGRAPH_PAUSE_SECONDS = 0.45
SECTION_PAUSE_SECONDS = 0.80
CHUNK_PAUSE_SECONDS = 0.18
SAMPLE_RATE = 24000

# Listening-only presets. No change to default published Dora narration.
COMPARE_SPEEDS = (0.95, 1.00, 1.05)
NARRATION_PRESETS = {
    "atual": {
        "speed": 0.95, "paragraph_pause": 0.45, "section_pause": 0.80,
        "chunk_pause": 0.18, "sentence_pause": 0.25, "clause_pause": 0.10,
        "adaptive_chunks": False,
    },
    "equilibrado": {
        "speed": 0.95, "paragraph_pause": 0.38, "section_pause": 0.70,
        "chunk_pause": 0.14, "sentence_pause": 0.22, "clause_pause": 0.08,
        "adaptive_chunks": True,
    },
    "fluido": {
        "speed": 0.95, "paragraph_pause": 0.30, "section_pause": 0.65,
        "chunk_pause": 0.10, "sentence_pause": 0.18, "clause_pause": 0.06,
        "adaptive_chunks": True,
    },
}
TOKENS = re.compile(r"https?://[^\s]+|www\.[^\s]+|\w+", re.UNICODE)


def language_code(language: str) -> str:
    """Only the two approved editorial languages can be used for this voice."""
    if language.lower() in {"pt", "pt-br"}:
        return LANG
    if language.lower() in {"en", "en-us"}:
        return ENGLISH
    raise ValueError(f"Idioma de narração não suportado: {language!r}")


def append_run(runs: list[dict], text: str, lang: str) -> None:
    if not text:
        return
    if runs and runs[-1]["lang"] == lang:
        runs[-1]["text"] += text
    else:
        runs.append({"lang": lang, "text": text})


def lexical_runs(text: str, lang: str, lexicon: dict) -> list[dict]:
    """Apply local lexicon and PT-BR initialism defaults, preserving language."""
    runs: list[dict] = []
    cursor = 0
    for match in TOKENS.finditer(text):
        append_run(runs, text[cursor:match.start()], lang)
        token = match.group()
        plural = bool(re.fullmatch(r"[a-z]?[A-Z][A-Z0-9]*s", token))
        base = token[:-1] if plural else token
        entry = lexicon.get(token, lexicon.get(base) if plural else None)
        initialism = (bool(re.fullmatch(r"[a-z]?[A-Z][A-Z0-9]*", base))
                      and len(re.findall(r"[A-Z]", base)) >= 2)
        if entry:
            spoken = entry["speak"] + ("s" if plural and token not in lexicon else "")
            append_run(runs, spoken, language_code(entry["lang"]))
        elif initialism:
            # The editorial contract spells unfamiliar acronyms in PT-BR,
            # even if they appear inside an English-tagged phrase.
            append_run(runs, spell(base) + ("s" if plural else ""), LANG)
        else:
            append_run(runs, token, lang)
        cursor = match.end()
    append_run(runs, text[cursor:], lang)
    return runs


def collect_html_runs(node: dict | str, language: str, lexicon: dict, out: list[dict]) -> None:
    if isinstance(node, str):
        for run in lexical_runs(node, language, lexicon):
            append_run(out, run["text"], run["lang"])
        return
    if is_ignored(node):
        return
    attrs = node["attrs"]
    current_lang = language_code(attrs.get("lang") or language)
    if attrs.get("data-tts-say"):
        append_run(out, attrs["data-tts-say"], current_lang)
        return
    if attrs.get("data-tts-mode") in {"spell", "word"}:
        literal = visible_text(node)
        spoken = spell(literal, current_lang) if attrs["data-tts-mode"] == "spell" else literal
        append_run(out, spoken, current_lang)
        return
    for child in node["children"]:
        collect_html_runs(child, current_lang, lexicon, out)


def clean_runs(runs: list[dict]) -> list[dict]:
    """Normalize whitespace without discarding spaces at language boundaries."""
    clean: list[dict] = []
    for run in runs:
        append_run(clean, re.sub(r"\s+", " ", run["text"]), run["lang"])
    if clean:
        clean[0]["text"] = clean[0]["text"].lstrip()
        clean[-1]["text"] = clean[-1]["text"].rstrip()
    return [r for r in clean if r["text"]]


def article_blocks(article: dict, lexicon: dict) -> list[dict]:
    """Produce exactly the narratable HTML blocks, retaining language spans."""
    blocks: list[dict] = []
    speech_markup = article.get("speechMarkup") or {}
    for field in ("title", "dek"):
        value = article.get(field)
        if not isinstance(value, str) or not value.strip():
            continue
        markup = speech_markup.get(field) or []
        runs: list[dict] = []
        if markup and "".join(s["text"] for s in markup) == value:
            for item in markup:
                lang = language_code(item["lang"])
                if item.get("speak"):
                    append_run(runs, item["speak"], lang)
                elif item.get("mode") in {"spell", "word"}:
                    rendered = (spell(item["text"], lang) if item["mode"] == "spell"
                                else item["text"])
                    append_run(runs, rendered, lang)
                else:
                    for run in lexical_runs(item["text"], lang, lexicon):
                        append_run(runs, run["text"], run["lang"])
        else:
            runs = lexical_runs(value, LANG, lexicon)
        blocks.append({"runs": clean_runs(runs), "section": field == "title", "tag": field})

    html = article.get("bodyHtml") or ""
    parser = ElementTreeParser()
    parser.feed(html)
    parser.close()

    def visit(node: dict | str, inherited: str = LANG) -> None:
        if isinstance(node, str) or is_ignored(node):
            return
        tag = node["tag"]
        lang = language_code(node["attrs"].get("lang") or inherited)
        node_classes = classes(node)
        special_callout = (tag == "div" and "article-callout" in node_classes
                           and not descendant_has_tag(node, "p"))
        standalone_li = tag == "li" and not descendant_has_tag(node, "p")
        if tag in (NARRATION_TAGS - {"li"}) or standalone_li or special_callout:
            runs: list[dict] = []
            collect_html_runs(node, inherited, lexicon, runs)
            clean = clean_runs(runs)
            if clean and "".join(r["text"] for r in clean).strip():
                blocks.append({"runs": clean, "section": tag in {"h2", "h3", "h4"}, "tag": tag})
            return
        for child in node["children"]:
            visit(child, lang)

    visit(parser.root)
    return blocks


def tokenize_runs(runs: list[dict]) -> list[dict]:
    """Word-level tokens keep preceding whitespace, even across lang spans."""
    tokens: list[dict] = []
    spaces = ""
    for run in runs:
        for part in re.findall(r"\s+|\S+", run["text"]):
            if part.isspace():
                spaces += part
            else:
                tokens.append({"text": spaces + part, "lang": run["lang"]})
                spaces = ""
    return tokens


def split_runs(runs: list[dict], max_chars: int = MAX_CHARS_PER_CHUNK) -> list[list[dict]]:
    tokens = tokenize_runs(runs)
    chunks: list[list[dict]] = []
    current: list[dict] = []
    length = 0

    def finish() -> None:
        nonlocal current, length
        if current:
            clean = clean_runs(current)
            if clean:
                chunks.append(clean)
        current, length = [], 0

    for token in tokens:
        token = dict(token)
        if current and length + len(token["text"]) > max_chars:
            finish()
        if not current:
            token["text"] = token["text"].lstrip()
        append_run(current, token["text"], token["lang"])
        length += len(token["text"])
        if length >= 150 and re.search(r"[.!?;][”\"']?$", token["text"]):
            finish()
    finish()
    return chunks


def split_runs_adaptive(
    runs: list[dict], target_chars: int = 240, max_chars: int = 300,
    min_chars: int = 140,
) -> list[list[dict]]:
    """Prefer sentence boundaries near 240 characters; cap at 300.

    The model limit is expressed in phonemes, not characters. Keep the
    character ceiling conservative and preserve multilingual runs, entire
    words, punctuation and the original reading order.
    """
    tokens = tokenize_runs(runs)
    if not tokens:
        return []
    if sum(len(item["text"]) for item in tokens) <= max_chars:
        return [clean_runs(runs)]
    chunks: list[list[dict]] = []
    index = 0
    while index < len(tokens):
        choices = []
        size = 0
        for end in range(index, len(tokens)):
            size += len(tokens[end]["text"])
            if size > max_chars:
                break
            remaining = sum(len(t["text"]) for t in tokens[end + 1:])
            punctuation = tokens[end]["text"].rstrip()
            tail = punctuation.rstrip(chr(34) + chr(39) + "”")[-1:]
            sentence = tail in (".", "!", "?")
            clause = tail in (";", ":", ",")
            penalty = 0 if sentence else 35 if clause else 85
            if 0 < remaining < min_chars:
                penalty += 30
            score = abs(size - target_chars) + penalty
            if size >= min_chars or end == len(tokens) - 1:
                choices.append((score, end + 1))
        stop = min(choices)[1] if choices else index + 1
        chunk: list[dict] = []
        for token in tokens[index:stop]:
            append_run(chunk, token["text"].lstrip() if not chunk else token["text"], token["lang"])
        chunks.append(clean_runs(chunk))
        index = stop
    return chunks


def segments_for_article(
    article: dict, lexicon: dict, max_chars: int = 0,
    preset: str = "atual", first_body_paragraphs: int = 0,
) -> list[dict]:
    settings = NARRATION_PRESETS[preset]
    blocks = article_blocks(article, lexicon)
    if first_body_paragraphs:
        # Preserve the spoken title and choose only the opening narrative <p>.
        # Exclude the dek, callouts, section headings and subsequent paragraphs.
        titles = [block for block in blocks if block["tag"] == "title"]
        paragraphs = [block for block in blocks if block["tag"] == "p"][:first_body_paragraphs]
        if len(titles) != 1 or len(paragraphs) != first_body_paragraphs:
            raise ValueError("Comparação requer título e parágrafo introdutório narráveis.")
        blocks = titles + paragraphs
    segments: list[dict] = []
    total = 0
    for block_index, block in enumerate(blocks):
        chunks = (split_runs_adaptive(block["runs"]) if settings["adaptive_chunks"]
                  else split_runs(block["runs"]))
        for j, chunk in enumerate(chunks):
            if max_chars and total >= max_chars:
                break
            text = "".join(run["text"] for run in chunk)
            segments.append({
                "text": text,
                "block_index": block_index,
                "runs": chunk,
                "pause_after_seconds": (
                    settings["section_pause"] if block["section"] else settings["paragraph_pause"]
                ) if j == len(chunks) - 1 else settings["chunk_pause"],
            })
            total += len(text)
        if max_chars and total >= max_chars:
            break
    if not segments:
        raise ValueError("O artigo não contém prosa narrável.")
    return segments


def phonemize_runs(runs: list[dict], phonemizers: dict) -> tuple[str, list[dict]]:
    """One combined IPA sequence for the single Kokoro/Dora inference."""
    parts: list[str] = []
    english_samples: list[dict] = []
    for run in runs:
        raw = run["text"]
        if not raw.strip():
            parts.append(" ")
            continue
        lang = language_code(run["lang"])
        ipa, _ = phonemizers[lang](raw.strip())
        if not ipa or not ipa.strip():
            raise ValueError(f"Fonemização vazia: {lang} {raw!r}")
        if lang == ENGLISH:
            english_samples.append({"text": raw.strip(), "phonemes": ipa})
        parts.append((" " if raw[:1].isspace() else "") +
                     ipa.strip() + (" " if raw[-1:].isspace() else ""))
    return re.sub(r"\s+", " ", "".join(parts)).strip(), english_samples


def prepare(
    slug: str, output_dir: Path, max_chars: int = 0,
    preset: str = "atual", first_body_paragraphs: int = 0,
) -> None:
    if max_chars < 0:
        raise ValueError("--max-chars deve ser >= 0")
    article = read_article(slug)
    segments = segments_for_article(
        article, load_lexicon(), max_chars, preset=preset,
        first_body_paragraphs=first_body_paragraphs,
    )
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / f"{slug}.segments.json").write_text(
        json.dumps(segments, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    (output_dir / f"{slug}.txt").write_text(
        "\n".join(s["text"] for s in segments) + "\n", encoding="utf-8"
    )
    notes = (
        f"Áudio do artigo **{article['title']}** do Tech Topics.\n\n"
        f"Artigo: https://joaovpimenta.github.io/tech-topics/article.html?slug={slug}\n\n"
        "Gerado no GitHub Actions com Kokoro-82M v1.0 FP32, "
        f"voz única {VOICE}, velocidade {SPEED}, fonemização PT-BR + EN-US "
        "respeitando as tags e o léxico editorial; MP3 mono 96 kbps.\n"
        "A qualidade e a pronúncia precisam de revisão auditiva.\n"
    )
    (output_dir / f"{slug}.md").write_text(notes, encoding="utf-8")
    english = [r["text"].strip() for s in segments for r in s["runs"]
               if r["lang"] == ENGLISH and r["text"].strip()]
    print(f"Preparado {slug}: {len(segments)} segmentos, "
          f"{sum(len(s['text']) for s in segments)} caracteres, "
          f"{len(english)} trechos ingleses (ex.: {english[:5]}).")


def synthesize(
    slug: str, output_dir: Path, model: Path, voices: Path,
    profile: bool = False, preset: str = "atual",
    shared_engine: dict | None = None, speed: float | None = None,
) -> None:
    import numpy as np
    import onnxruntime as ort
    import soundfile as sf
    from kokoro_onnx import Kokoro
    from misaki.espeak import EspeakG2P

    segments = json.loads((output_dir / f"{slug}.segments.json").read_text(encoding="utf-8"))
    if not segments:
        raise ValueError("Nenhum segmento preparado.")
    settings = NARRATION_PRESETS[preset]
    selected_speed = settings["speed"] if speed is None else speed
    if not 0.5 <= selected_speed <= 2.0:
        raise ValueError("Velocidade precisa ficar entre 0.5 e 2.0.")
    if shared_engine is not None and "kokoro" in shared_engine:
        kokoro = shared_engine["kokoro"]
        phonemizers = shared_engine["phonemizers"]
    else:
        options = ort.SessionOptions()
        options.intra_op_num_threads = 4
        session = ort.InferenceSession(
            str(model), sess_options=options, providers=["CPUExecutionProvider"]
        )
        kokoro = Kokoro.from_session(session, str(voices))
        phonemizers = {
            LANG: EspeakG2P(language=LANG),
            ENGLISH: EspeakG2P(language=ENGLISH),
        }
        if shared_engine is not None:
            shared_engine.update({"kokoro": kokoro, "phonemizers": phonemizers})
    start = time.perf_counter()
    sampler = None
    if profile:
        from cpu_profile import CpuSampler
        sampler = CpuSampler(interval=1.0).start()
    segment_timing: list[dict] = []
    generated_samples = 0
    english_samples: list[dict] = []
    chapters: list[dict] = []
    last_block: int | None = None
    destination = output_dir / f"{slug}.wav"
    with sf.SoundFile(
        destination, mode="w", samplerate=SAMPLE_RATE, channels=1, subtype="PCM_16"
    ) as wav:
        for i, item in enumerate(segments, start=1):
            block_id = item.get("block_index", i - 1)
            if block_id != last_block:
                chapters.append({
                    "start": round(generated_samples / SAMPLE_RATE, 3),
                    "label": item["text"][:96]
                })
                last_block = block_id
            g2p_started = time.perf_counter() if profile else 0.0
            phonemes, examples = phonemize_runs(item["runs"], phonemizers)
            english_samples.extend(examples)
            if not phonemes:
                raise ValueError(f"Segmento {i}: fonemas vazios")
            inference_started = time.perf_counter() if profile else 0.0
            # PT-BR and English phonemes in ONE call, always with Dora.
            audio, sample_rate = kokoro.create(
                phonemes, voice=VOICE, speed=selected_speed, is_phonemes=True,
                sentence_pause=settings["sentence_pause"],
                clause_pause=settings["clause_pause"],
            )
            if profile:
                finished = time.perf_counter()
                segment_timing.append({
                    "segment": i,
                    "block_index": item.get("block_index", i - 1),
                    "characters": len(item["text"]),
                    "phonemization_seconds": round(inference_started - g2p_started, 3),
                    "inference_seconds": round(finished - inference_started, 3),
                    "audio_seconds": round(len(audio) / SAMPLE_RATE, 3),
                })
            if sample_rate != SAMPLE_RATE or len(audio) == 0:
                raise ValueError(f"Áudio inválido no segmento {i}: {sample_rate}")
            wav.write(audio)
            generated_samples += len(audio)
            pause = int(SAMPLE_RATE * item["pause_after_seconds"])
            wav.write(np.zeros(pause, dtype=np.float32))
            generated_samples += pause
            if i % 20 == 0 or i == len(segments):
                print(f"Kokoro: {i}/{len(segments)} segmentos", flush=True)

    duration = generated_samples / SAMPLE_RATE
    elapsed = time.perf_counter() - start
    if sampler:
        profile_report = sampler.stop(segment_timing)
        (output_dir / f"{slug}.cpu-profile.json").write_text(
            json.dumps(profile_report, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        print(json.dumps(profile_report["summary"], ensure_ascii=False), flush=True)
    (output_dir / f"{slug}.chapters.json").write_text(
        json.dumps({"version": 1, "chapters": chapters}, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8"
    )
    report = {
        "engine": "kokoro-onnx",
        "model": "kokoro-v1.0.onnx",
        "precision": "fp32",
        "voice": VOICE,
        "languages": [LANG, ENGLISH],
        "english_runs": len(english_samples),
        "english_examples": english_samples[:20],
        "speed": selected_speed,
        "preset": preset,
        "parameters": settings,
        "segments": len(segments),
        "audio_seconds": round(duration, 2),
        "synthesis_seconds": round(elapsed, 2),
        "real_time_factor": round(elapsed / duration, 3) if duration else None,
    }
    (output_dir / f"{slug}.metrics.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps({k: v for k, v in report.items() if k != "english_examples"},
                     ensure_ascii=False), flush=True)


def compare_presets(slug: str, output_dir: Path, model: Path, voices: Path) -> None:
    """Render one intro paragraph plus title for 3 prosodies x 3 speeds.

    Preserving the same model, narrator, lexicon and text across 9 variants
    lets the user evaluate speed separately from pause/chunking settings.
    The ONNX session and phonemizers are initialized only once.
    """
    output_dir.mkdir(parents=True, exist_ok=True)
    shared: dict = {}
    manifest = {
        "slug": slug, "voice": VOICE,
        "selection": "title_plus_first_body_paragraph",
        "paragraphs": 1, "speeds": list(COMPARE_SPEEDS),
        "presets": NARRATION_PRESETS, "variants": [],
    }
    for preset in NARRATION_PRESETS:
        for speed in COMPARE_SPEEDS:
            label = f"{preset}-{round(speed * 100):03d}"
            folder = output_dir / label
            prepare(slug, folder, preset=preset, first_body_paragraphs=1)
            synthesize(slug, folder, model, voices, preset=preset,
                       shared_engine=shared, speed=speed)
            metrics = json.loads(
                (folder / f"{slug}.metrics.json").read_text(encoding="utf-8")
            )
            manifest["variants"].append({
                "name": label,
                "preset": preset,
                "speed": speed,
                "audio_seconds": metrics["audio_seconds"],
                "synthesis_seconds": metrics["synthesis_seconds"],
                "segment_count": metrics["segments"],
                "file": f"{label}/{slug}.mp3",
            })
    (output_dir / "comparison.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["prepare", "synthesize", "compare"])
    parser.add_argument("--slug", required=True)
    parser.add_argument("--output-dir", type=Path, default=Path(".audio"))
    parser.add_argument("--max-chars", type=int, default=0)
    parser.add_argument("--preset", choices=list(NARRATION_PRESETS), default="atual")
    parser.add_argument("--first-body-paragraphs", type=int, default=0)
    parser.add_argument("--model", type=Path)
    parser.add_argument("--voices", type=Path)
    parser.add_argument("--profile", action="store_true",
                        help="Amostrar CPU, RSS e tempos por segmento; sintetiza sem paralelismo")
    args = parser.parse_args()
    if args.command == "prepare":
        prepare(args.slug, args.output_dir, args.max_chars,
                preset=args.preset, first_body_paragraphs=args.first_body_paragraphs)
    else:
        if not args.model or not args.voices:
            parser.error("--model e --voices são obrigatórios para synthesize/compare")
        if args.command == "compare":
            compare_presets(args.slug, args.output_dir, args.model, args.voices)
        else:
            synthesize(args.slug, args.output_dir, args.model, args.voices,
                       profile=args.profile, preset=args.preset)


if __name__ == "__main__":
    main()
