import argparse
import re
from pathlib import Path

def split_text(text: str, max_chars: int = 280) -> list[str]:
    """Divide texto em blocos pequenos, tentando preservar frases."""
    text = re.sub(r"\r\n?", "\n", text)
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text).strip()

    paragraphs = [p.strip() for p in text.split("\n\n") if p.strip()]
    chunks = []

    for paragraph in paragraphs:
        sentences = re.split(r"(?<=[.!?])\s+", paragraph)
        current = ""

        for sentence in sentences:
            sentence = sentence.strip()
            if not sentence:
                continue

            # Frase individual maior que o limite.
            if len(sentence) > max_chars:
                if current:
                    chunks.append(current)
                    current = ""

                words = sentence.split()
                piece = ""

                for word in words:
                    candidate = f"{piece} {word}".strip()
                    if len(candidate) <= max_chars:
                        piece = candidate
                    else:
                        if piece:
                            chunks.append(piece)
                        piece = word

                if piece:
                    chunks.append(piece)

                continue

            candidate = f"{current} {sentence}".strip()

            if len(candidate) <= max_chars:
                current = candidate
            else:
                if current:
                    chunks.append(current)
                current = sentence

        if current:
            chunks.append(current)

    return chunks


def main():
    parser = argparse.ArgumentParser(
        description="Gera um WAV a partir de um arquivo de texto usando Chatterbox Multilingual."
    )

    parser.add_argument(
        "input",
        help="Arquivo .txt contendo o roteiro"
    )

    parser.add_argument(
        "-o",
        "--output",
        default=None,
        help="Arquivo WAV final"
    )

    parser.add_argument(
        "--voice",
        default=None,
        help="Áudio WAV de referência para clonagem de voz"
    )

    parser.add_argument(
        "--language",
        default="pt",
        help="Idioma do Chatterbox. Padrão: pt"
    )

    parser.add_argument(
        "--chunk-chars",
        type=int,
        default=280,
        help="Tamanho máximo aproximado de cada trecho. Padrão: 280"
    )

    parser.add_argument(
        "--pause-ms",
        type=int,
        default=300,
        help="Pausa entre trechos em milissegundos. Padrão: 300"
    )

    parser.add_argument(
        "--exaggeration",
        type=float,
        default=0.5
    )

    parser.add_argument(
        "--temperature",
        type=float,
        default=0.8
    )

    parser.add_argument(
        "--cfg-weight",
        type=float,
        default=0.5,
        help="Peso de aderência ao áudio de referência. Padrão: 0.5"
    )

    parser.add_argument(
        "--repetition-penalty",
        type=float,
        default=1.5,
        help="Penalidade contra repetições. Padrão: 1.5"
    )

    parser.add_argument(
        "--min-p",
        type=float,
        default=0.05,
        help="Probabilidade mínima dos tokens amostrados. Padrão: 0.05"
    )

    parser.add_argument(
        "--top-p",
        type=float,
        default=1.0,
        help="Nucleus sampling. Padrão: 1.0"
    )

    args = parser.parse_args()

    # Lightweight help and stdlib tests can run without the synthesis runtime.
    import torch
    import torchaudio as ta
    from chatterbox.mtl_tts import ChatterboxMultilingualTTS

    input_path = Path(args.input)

    if not input_path.exists():
        raise FileNotFoundError(f"Arquivo não encontrado: {input_path}")

    if args.voice and not Path(args.voice).exists():
        raise FileNotFoundError(f"Áudio de referência não encontrado: {args.voice}")

    text = input_path.read_text(encoding="utf-8-sig").strip()

    if not text:
        raise ValueError("O arquivo de entrada está vazio.")

    output_path = (
        Path(args.output)
        if args.output
        else Path(".local/tts/output") / f"{input_path.stem}.wav"
    )

    output_path.parent.mkdir(parents=True, exist_ok=True)

    device = "cuda" if torch.cuda.is_available() else "cpu"

    print(f"Device: {device}")
    print(f"Entrada: {input_path}")
    print(f"Saída: {output_path}")

    chunks = split_text(text, args.chunk_chars)

    print(f"Trechos: {len(chunks)}")
    print("Carregando Chatterbox...")

    model = ChatterboxMultilingualTTS.from_pretrained(device)

    pause_samples = int(model.sr * args.pause_ms / 1000)
    pause = torch.zeros((1, pause_samples))

    generated = []

    for index, chunk in enumerate(chunks, start=1):
        print(
            f"[{index}/{len(chunks)}] "
            f"{len(chunk)} chars: "
            f"{chunk[:80]}{'...' if len(chunk) > 80 else ''}"
        )

        kwargs = {
            "language_id": args.language,
            "exaggeration": args.exaggeration,
            "cfg_weight": args.cfg_weight,
            "temperature": args.temperature,
            "repetition_penalty": args.repetition_penalty,
            "min_p": args.min_p,
            "top_p": args.top_p,
        }

        if args.voice:
            kwargs["audio_prompt_path"] = args.voice

        with torch.inference_mode():
            wav = model.generate(chunk, **kwargs)

        wav = wav.detach().cpu()

        generated.append(wav)

        if index < len(chunks):
            generated.append(pause)

    final_wav = torch.cat(generated, dim=1)

    ta.save(
        str(output_path),
        final_wav,
        model.sr
    )

    duration = final_wav.shape[1] / model.sr

    print()
    print("Concluído.")
    print(f"Arquivo: {output_path.resolve()}")
    print(f"Duração: {duration / 60:.2f} min")
    print(f"Sample rate: {model.sr}")


if __name__ == "__main__":
    main()
