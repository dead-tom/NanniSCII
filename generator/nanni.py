"""
nanni.py: the shared helpers for turning complaint lines into cuneiform.

Used by translate.ipynb (Colab). No model is loaded here, so it can be
imported and tested anywhere.

  REDACTION              finds the CFPB's anonymised "XXXX" redactions
  pick_line()            chooses one line from a complaint
  translate_with_redactions()
                         translates around each redaction and keeps it as a
                         broken sign "x" (the scholarly mark for an illegible sign)
  normalize_atf()        praeclarum's CDLI spelling -> CuneiScribe spelling
  to_cuneiform()         Akkadian transliteration -> Unicode cuneiform
  coverage(), runaway()  checks on each translation
"""
import re

# CFPB redactions: XXXX, XX/XX/XXXX, {$XXXX}, XXXX-XXXX ...
REDACTION = re.compile(r"\{?\$?X{2,}(?:[/\-.]X{2,})*\}?")
GAP = "x"            # ATF convention: an illegible / broken sign
GAP_SIGN = "[x]"     # how a gap shows up in the cuneiform string

# ------------------------------------------------------------ choosing a line
SENTENCE_END = re.compile(r"(?<=[.!?])\s+|\n+")
BOILERPLATE = re.compile(
    r"^(dear|to whom|hello|hi\b|i am writing|i'm writing|please (see|find|help)|thank you|"
    r"sincerely|regards|re:|subject:|attached|this (is|letter) (a|to))", re.IGNORECASE)


def sentences(text):
    return [s.strip() for s in SENTENCE_END.split(text) if s and s.strip()]


def eligible(s, min_words=6, max_words=35, max_redactions=1):
    """A line worth translating: a real sentence, not a greeting, at most one redaction
    (more than one chops the line into fragments with no context, see Step 2b)."""
    n = len(s.split())
    return (min_words <= n <= max_words
            and len(REDACTION.findall(s)) <= max_redactions
            and len(REDACTION.sub("", s).split()) >= min_words - 1
            and not BOILERPLATE.match(s))


def pick_line(narrative, rng):
    """One random eligible line from a complaint, or None if it has none."""
    options = [s for s in sentences(narrative) if eligible(s)]
    return options[rng.integers(len(options))] if options else None


# ------------------------------------------------------------ translation
def normalize_atf(a):
    """praeclarum (CDLI ATF) spelling -> CuneiScribe spelling."""
    a = re.sub(r"_([^_]+)_", lambda m: m.group(1).upper(), a)   # _kug-ud_ -> KUG-UD (logograms)
    a = a.replace("_", "")
    a = re.sub(r"[\[\]⸢⸣#?!*<>]", "", a)                      # ATF damage/editorial marks
    for k, v in [("sz", "š"), ("SZ", "Š"), ("s,", "ṣ"), ("S,", "Ṣ"), ("t,", "ṭ"), ("T,", "Ṭ")]:
        a = a.replace(k, v)
    return a


def translate_with_redactions(line, to_akkadian, mode="split", raw=False):
    """Keep every redaction as one broken sign.
    mode="split": translate the text between redactions, rejoin with a gap (used).
    mode="single": collapse each redaction to a lone 'x' and translate the whole
    line (tested in Step 2b; it makes the model loop, so it is not used)."""
    if mode == "single":
        out = to_akkadian(REDACTION.sub("x", line))
        return out if raw else normalize_atf(out)
    parts = REDACTION.split(line)
    out = []
    for i, part in enumerate(parts):
        if part.strip(" ,.;:"):
            t = to_akkadian(part.strip())
            out.append(t if raw else normalize_atf(t))
        if i < len(parts) - 1:
            out.append(GAP)
    return " ".join(out)


def to_cuneiform(akk, conv):
    words = [GAP_SIGN if w == GAP else conv.to_cuneiform(w) for w in akk.split()]
    return " ".join(words)


# ------------------------------------------------------------ checks
def coverage(cuneiform):
    """Share of syllables that became real signs (CuneiScribe writes misses as [syllable])."""
    toks = re.findall(r"\[[^\]]+\]|[\U00012000-\U0001254F]", cuneiform)
    toks = [t for t in toks if t != GAP_SIGN]            # redactions aren't failures
    if not toks:
        return 0.0, []
    bad = [t for t in toks if t.startswith("[")]
    return round(100 * (1 - len(bad) / len(toks)), 1), bad


def runaway(akk, source):
    """True if the model looped: very long output or mostly one repeated word."""
    w = akk.split()
    return len(akk) > 4 * max(len(source), 20) or (len(w) > 6 and max(w.count(x) for x in set(w)) / len(w) > 0.5)


def signs(cuneiform):
    """The cuneiform signs in a string, in order (gaps and unmapped syllables left out)."""
    return re.findall(r"[\U00012000-\U0001254F]", re.sub(r"\[[^\]]*\]", "", cuneiform))
