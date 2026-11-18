"""Deterministic text mutations for the Evasion Lab.

The operator names are TrustBreaker's: ``leet``, ``space_out``, ``homoglyph``,
``char_reverse``, and ``zero_width``. The functions are implemented in this
module. TrustLens does not import the trustbreaker package.

A word is a run of letters, digits, and underscores. Combining marks stay
attached to the base character they follow. Separators between words stay
where they are.
"""

from collections.abc import Callable, Iterator
from unicodedata import category

_LEET = str.maketrans("aeiostAEIOST", "431057431057")
# Unicode escapes make each look-alike's code point visible in the source.
_HOMOGLYPHS = str.maketrans(
    {
        "a": "\u0430",
        "c": "\u0441",
        "e": "\u0435",
        "i": "\u0456",
        "j": "\u0458",
        "o": "\u043e",
        "p": "\u0440",
        "s": "\u0455",
        "x": "\u0445",
        "y": "\u0443",
        "A": "\u0410",
        "B": "\u0412",
        "C": "\u0421",
        "E": "\u0415",
        "H": "\u041d",
        "I": "\u0406",
        "K": "\u041a",
        "M": "\u041c",
        "O": "\u041e",
        "P": "\u0420",
        "T": "\u0422",
        "X": "\u0425",
        "Y": "\u03a5",
    }
)


def _word_spans(text: str) -> Iterator[tuple[int, int]]:
    start: int | None = None
    for index, char in enumerate(text):
        if char.isalnum() or char == "_":
            if start is None:
                start = index
        elif start is not None and not category(char).startswith("M"):
            yield start, index
            start = None
    if start is not None:
        yield start, len(text)


def _map_words(text: str, transform: Callable[[str], str]) -> str:
    parts: list[str] = []
    end = 0
    for start, stop in _word_spans(text):
        parts.append(text[end:start])
        parts.append(transform(text[start:stop]))
        end = stop
    parts.append(text[end:])
    return "".join(parts)


def _characters(word: str) -> Iterator[str]:
    """Yield base characters with any following combining marks attached."""
    start = 0
    for index, char in enumerate(word[1:], 1):
        if not category(char).startswith("M"):
            yield word[start:index]
            start = index
    if word:
        yield word[start:]


def leet(text: str) -> str:
    """Map a/e/i/o/s/t, in either case, to 4/3/1/0/5/7."""
    return text.translate(_LEET)


def space_out(text: str) -> str:
    """Insert spaces inside words of four or more characters."""

    def space(word: str) -> str:
        characters = list(_characters(word))
        if len(characters) < 4:
            return word
        return " ".join(characters)

    return _map_words(text, space)


def homoglyph(text: str) -> str:
    """Swap a fixed set of Latin letters for look-alike letters."""
    return text.translate(_HOMOGLYPHS)


def char_reverse(text: str) -> str:
    """Reverse each word. Combining marks stay on their base character."""
    return _map_words(text, lambda word: "".join(reversed(list(_characters(word)))))


def zero_width(text: str) -> str:
    """Insert U+200B between the characters of each word."""
    return _map_words(text, lambda word: "\u200b".join(_characters(word)))


_OPERATORS: dict[str, Callable[[str], str]] = {
    "leet": leet,
    "space_out": space_out,
    "homoglyph": homoglyph,
    "char_reverse": char_reverse,
    "zero_width": zero_width,
}
OPERATOR_NAMES = tuple(_OPERATORS)


def mutate(text: str, operator: str) -> str:
    """Apply one named operator. Unknown names raise ``ValueError``."""
    try:
        transform = _OPERATORS[operator]
    except KeyError:
        raise ValueError(f"unknown operator {operator!r}") from None
    return transform(text)
