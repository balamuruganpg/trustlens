"""Exact outputs for the five local mutation operators."""

import pytest

from app.mutations import (
    OPERATOR_NAMES,
    char_reverse,
    homoglyph,
    leet,
    mutate,
    space_out,
    zero_width,
)


@pytest.mark.parametrize(
    ("operator", "text", "expected"),
    [
        ("leet", "AEIOST, aeioST café!", "431057, 431057 c4fé!"),
        ("space_out", "  abc,word!\tlonger\n", "  abc,w o r d!\tl o n g e r\n"),
        ("zero_width", "ab, c!", "a\u200bb, c!"),
        (
            "homoglyph",
            "aceijopsxy ABCEHIKMOPTXY! ß",
            (
                "\u0430\u0441\u0435\u0456\u0458\u043e\u0440\u0455\u0445\u0443 "
                "\u0410\u0412\u0421\u0415\u041d\u0406\u041a\u041c\u041e\u0420\u0422\u0425\u03a5! ß"
            ),
        ),
        ("char_reverse", " Ab3, a\u0301b! ", " 3bA, ba\u0301! "),
    ],
)
def test_operator_exact_output(operator: str, text: str, expected: str) -> None:
    assert mutate(text, operator) == expected


def test_operator_names_and_ignore_specimen() -> None:
    assert OPERATOR_NAMES == (
        "leet",
        "space_out",
        "homoglyph",
        "char_reverse",
        "zero_width",
    )
    assert leet("Ignore") == "1gn0r3"
    assert space_out("Ignore") == "I g n o r e"
    assert homoglyph("Ignore") == "\u0406gn\u043er\u0435"
    assert char_reverse("Ignore") == "erongI"
    assert zero_width("Ignore") == "I\u200bg\u200bn\u200bo\u200br\u200be"


def test_unicode_word_boundaries_and_combining_marks() -> None:
    text = "a\u0301bc d\u0308efg👍🏽👩‍💻𐐷z"
    assert space_out(text) == "a\u0301bc d\u0308 e f g👍🏽👩‍💻𐐷z"
    assert zero_width(text) == "a\u0301\u200bb\u200bc d\u0308\u200be\u200bf\u200bg👍🏽👩‍💻𐐷\u200bz"
    assert char_reverse(text) == "cba\u0301 gfed\u0308👍🏽👩‍💻z𐐷"


def test_unknown_operator() -> None:
    with pytest.raises(ValueError, match="unknown operator"):
        mutate("ignore", "synonym")
