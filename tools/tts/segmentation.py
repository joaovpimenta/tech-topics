"""Backend-agnostic sentence planning and inference chunk boundaries.

Consumes language runs plus a supplied budget measurer. It does not load
voices, phonemizers or models. Drivers may swap the capacity callback without
changing sentence identities, pauses or text assembly.
"""
from __future__ import annotations
import re
from collections.abc import Callable

MAX_CHARS_PER_CHUNK = 240

def append_run(runs: list[dict], text: str, lang: str) -> None:
    if not text:
        return
    if runs and runs[-1]["lang"] == lang:
        runs[-1]["text"] += text
    else:
        runs.append({"lang": lang, "text": text})


def clean_runs(runs: list[dict]) -> list[dict]:
    """Normalize whitespace without discarding spaces at language boundaries."""
    clean: list[dict] = []
    for run in runs:
        append_run(clean, re.sub(r"\s+", " ", run["text"]), run["lang"])
    if clean:
        clean[0]["text"] = clean[0]["text"].lstrip()
        clean[-1]["text"] = clean[-1]["text"].rstrip()
    return [r for r in clean if r["text"]]


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


def punctuation_boundary(token: str) -> str | None:
    """Classify phrase boundaries without treating every comma as a sentence."""
    stripped = token.rstrip().rstrip('"\u201d\u2019\'\u00bb)]}')
    if not stripped:
        return None
    if stripped.endswith((".", "!", "?", "\u2026")):
        if stripped.lower() in {"sr.", "sra.", "dr.", "dra.", "prof.", "vs.", "ex.", "fig."}:
            return None
        return "sentence"
    if stripped.endswith((",", ";", ":")):
        return "clause"
    return None


def split_runs_adaptive(
    runs: list[dict], target_chars: int = 240, max_chars: int = 320,
    min_chars: int = 80,
) -> list[list[dict]]:
    """Sentence-first synthesis, comma-aware splitting only when necessary.

    Keep *every* complete sentence as one chunk when it fits max_chars.
    If a sentence exceeds max_chars, split at the last suitable comma,
    semicolon or colon in the allowed window. Only fall back to a word
    boundary when no natural clause break exists. Never cut through a
    word, alter language spans, or merge across paragraph boundaries.

    320 characters are a heuristic, not the model's phoneme-token limit.
    A second, actual-token preflight happens before inference in compare mode.
    """
    if not 0 < min_chars <= target_chars <= max_chars:
        raise ValueError("Invalid adaptive chunk limits")
    tokens = tokenize_runs(runs)
    if not tokens:
        return []

    # First identify complete grammatical sentences, disregarding length.
    sentences: list[list[dict]] = []
    current: list[dict] = []
    for token in tokens:
        current.append(token)
        if punctuation_boundary(token["text"]) == "sentence":
            sentences.append(current)
            current = []
    if current:
        sentences.append(current)

    chunks: list[list[dict]] = []
    for sentence in sentences:
        index = 0
        while index < len(sentence):
            remaining = sentence[index:]
            size = sum(len(t["text"]) for t in remaining)
            if size <= max_chars:
                end = len(sentence)
            else:
                length = 0
                allowed = []
                clause_ends = []
                for i in range(index, len(sentence)):
                    length += len(sentence[i]["text"])
                    if length > max_chars:
                        break
                    allowed.append((length, i + 1))
                    if length >= min_chars and punctuation_boundary(sentence[i]["text"]) == "clause":
                        clause_ends.append((length, i + 1))
                if not allowed:
                    raise ValueError("Uma palavra isolada excede o limite de 320 caracteres.")
                # Maximize semantic context at a natural comma, if possible.
                end = (clause_ends[-1] if clause_ends else allowed[-1])[1]
            result: list[dict] = []
            for token in sentence[index:end]:
                append_run(result, token["text"].lstrip() if not result else token["text"],
                           token["lang"])
            chunks.append(clean_runs(result))
            index = end
    return chunks


def plan_segments(
    segments: list[dict], measure_runs: Callable[[list[dict]], tuple[int, int]],
    max_tokens: int = 350, target_tokens: int = 300,
    max_phonemes: int = 500, internal_pause: float = 0.025,
) -> list[dict]:
    """Plan boundaries using a caller-supplied (token count, phoneme length).

    Each inference belongs to a single sentence in its editorial block.
    Short sentences are never joined. Long sentences are split at clauses
    and word boundaries, with a shared (block_index, sentence_index).

    Some backends impose a string-length cap separate from tokens,
    independently of the token count, so protect both budgets. Never
    concatenate text across paragraph boundaries or drop multilingual runs.
    """
    if not 0 < target_tokens <= max_tokens < 510:
        raise ValueError("Invalid Kokoro token budgets")
    if not 0 < max_phonemes < 510:
        raise ValueError("Phoneme text budget must stay below Kokoro's 510 limit")

    output: list[dict] = []
    next_sentence_by_block: dict[int, int] = {}

    for item in segments:
        tokens = tokenize_runs(item["runs"])
        if not tokens:
            continue

        cache: dict[tuple[int, int], tuple[int, int]] = {}

        def runs_for(start: int, end: int) -> list[dict]:
            group: list[dict] = []
            for token in tokens[start:end]:
                append_run(group, token["text"].lstrip() if not group else token["text"],
                           token["lang"])
            return clean_runs(group)

        def measure(start: int, end: int) -> tuple[int, int]:
            key = (start, end)
            if key not in cache:
                cache[key] = measure_runs(runs_for(start, end))
            return cache[key]

        def fits(start: int, end: int) -> bool:
            n_tokens, n_phonemes = measure(start, end)
            return 0 < n_tokens <= max_tokens and n_phonemes <= max_phonemes

        # Sentence boundaries first, before *any* token-budget decision.
        sentences: list[tuple[int, int]] = []
        start = 0
        for end, token in enumerate(tokens, start=1):
            if punctuation_boundary(token["text"]) == "sentence":
                sentences.append((start, end))
                start = end
        if start < len(tokens):
            sentences.append((start, len(tokens)))

        groups: list[tuple[int, int, str, int]] = []
        block_id = item.get("block_index", 0)
        for begin, finish in sentences:
            sentence_index = next_sentence_by_block.get(block_id, 0)
            next_sentence_by_block[block_id] = sentence_index + 1
            if fits(begin, finish):
                groups.append((begin, finish, "sentence", sentence_index))
                continue

            position = begin
            while position < finish:
                if fits(position, finish):
                    groups.append((position, finish, "sentence", sentence_index))
                    break

                clause_candidates = [
                    end for end in range(position + 1, finish)
                    if punctuation_boundary(tokens[end - 1]["text"]) == "clause"
                ]
                good_clauses = [end for end in clause_candidates if fits(position, end)]
                if good_clauses:
                    # Natural phrasing beats an arbitrary 300-token cut.
                    cut = min(good_clauses,
                              key=lambda end: (abs(measure(position, end)[0] -
                                                   target_tokens), -end))
                    kind = "clause"
                else:
                    # For punctuation-free long sentences, binary-search the
                    # furthest safe word boundary; do not split a word.
                    low, high = position + 1, finish - 1
                    cut = None
                    while low <= high:
                        middle = (low + high) // 2
                        if fits(position, middle):
                            cut = middle
                            low = middle + 1
                        else:
                            high = middle - 1
                    if cut is None:
                        raise ValueError("Uma palavra ultrapassa o orçamento fonético Kokoro.")
                    kind = "word_fallback"
                groups.append((position, cut, kind, sentence_index))
                position = cut

        for index, (start, end, kind, sentence_index) in enumerate(groups):
            runs = runs_for(start, end)
            text = "".join(part["text"] for part in runs)
            last = index == len(groups) - 1
            ends_sentence = last or groups[index + 1][3] != sentence_index
            output.append({
                **item, "text": text, "runs": runs,
                "sentence_index": sentence_index,
                "sentence_start": index == 0 or groups[index - 1][3] != sentence_index,
                "split_reason": ("paragraph_end" if last else
                                 "sentence_end" if ends_sentence else kind),
                "token_count": measure(start, end)[0],
                "phoneme_length": measure(start, end)[1],
                "pause_after_seconds": (
                    item["pause_after_seconds"] if last else
                    item.get("sentence_pause_after_seconds", 0.14) if ends_sentence else
                    internal_pause
                ),
            })
    return output


