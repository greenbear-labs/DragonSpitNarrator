import pytest

from narrator_engine.emotions import EMOTIONS, engine_params
from narrator_engine.text import split_segments


def test_short_sentences_are_packed_together():
    assert split_segments("One. Two! Three?") == ["One. Two! Three?"]


def test_paragraphs_start_new_segments():
    assert split_segments("First part.\n\nSecond part.") == ["First part.", "Second part."]


def test_long_text_respects_limit_and_keeps_every_word():
    text = " ".join(f"Sentence number {i} goes here, with a clause; and more words." for i in range(40))
    segments = split_segments(text, max_chars=120)
    assert all(len(s) <= 120 for s in segments)
    assert " ".join(segments).split() == text.split()


def test_single_huge_word_run_is_cut():
    segments = split_segments("word " * 200, max_chars=50)
    assert all(len(s) <= 50 for s in segments)
    assert sum(len(s.split()) for s in segments) == 200


def test_chatterbox_neutral_and_full_intensity():
    assert engine_params("chatterbox", "excited", 0.0) == {"exaggeration": 0.5, "cfg_weight": 0.5}
    full = engine_params("chatterbox", "excited", 1.0)
    assert full["exaggeration"] == EMOTIONS["excited"].exaggeration
    assert full["cfg_weight"] == EMOTIONS["excited"].cfg_weight


def test_qwen_gets_instruction_and_speed_hint():
    params = engine_params("qwen3", "suspense", 0.9, speed=0.8)
    assert "suspense" in params["instruct"].lower()
    assert "slowly" in params["instruct"]
    assert engine_params("qwen3", "neutral", 0.5) == {"instruct": ""}


def test_kokoro_only_changes_speed():
    assert engine_params("kokoro", "sad", 1.0) == {"speed": EMOTIONS["sad"].speed}
    assert engine_params("kokoro", "neutral", 1.0, speed=1.2) == {"speed": 1.2}


def test_unknown_emotion_raises():
    with pytest.raises(ValueError):
        engine_params("kokoro", "smug", 0.5)
