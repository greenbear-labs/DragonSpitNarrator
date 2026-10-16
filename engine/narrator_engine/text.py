"""Split narration text into segments a TTS model can handle in one pass."""

from __future__ import annotations

import re

# Chatterbox and Qwen3-TTS degrade on very long inputs; ~300 characters per pass is safe.
DEFAULT_MAX_CHARS = 300

_SENTENCE_END = re.compile(r"(?<=[.!?…])[\"')\]]*\s+")
_CLAUSE_END = re.compile(r"(?<=[,;:—])\s+")


def _split_long(sentence: str, max_chars: int) -> list[str]:
    parts: list[str] = []
    current = ""
    for clause in _CLAUSE_END.split(sentence):
        candidate = f"{current} {clause}".strip()
        if len(candidate) <= max_chars:
            current = candidate
            continue
        if current:
            parts.append(current)
        # A single clause longer than the limit is split on word boundaries.
        while len(clause) > max_chars:
            cut = clause.rfind(" ", 0, max_chars)
            cut = cut if cut > 0 else max_chars
            parts.append(clause[:cut].strip())
            clause = clause[cut:].strip()
        current = clause
    if current:
        parts.append(current)
    return parts


def split_segments(text: str, max_chars: int = DEFAULT_MAX_CHARS) -> list[str]:
    """Split on paragraphs and sentences, packing short sentences together up to max_chars."""
    segments: list[str] = []
    for paragraph in re.split(r"\n\s*\n", text.strip()):
        paragraph = " ".join(paragraph.split())
        if not paragraph:
            continue
        current = ""
        for sentence in _SENTENCE_END.split(paragraph):
            sentence = sentence.strip()
            if not sentence:
                continue
            pieces = [sentence] if len(sentence) <= max_chars else _split_long(sentence, max_chars)
            for piece in pieces:
                candidate = f"{current} {piece}".strip()
                if len(candidate) <= max_chars:
                    current = candidate
                else:
                    segments.append(current)
                    current = piece
        if current:
            segments.append(current)
    return segments
