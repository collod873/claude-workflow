#!/usr/bin/env python3
from __future__ import annotations

import re
from datetime import date
from pathlib import Path

WORD_CAP = 150

STATUSES = ("constraint", "note", "superseded")

REQUIRED_KEYS = ("status", "date", "reversal")
BAR_KEYS = ("status", "reversal")

SKIP_DIRS = {
    ".git", "node_modules", "__pycache__", "worktrees", ".venv", "venv",
    "dist", "build", ".next", ".cache", ".mypy_cache",
}

DRAFT_PREFIX = "draft-"
LANDED_RE = re.compile(r"^(\d{4})-(.+)\.md$")
DRAFT_RE = re.compile(rf"^{DRAFT_PREFIX}(.+)\.md$")

FRONTMATTER_RE = re.compile(r"\A---\n(.*?)\n---\n", re.DOTALL)
H1_RE = re.compile(r"^#\s+(.+?)\s*$", re.MULTILINE)

CITATION_RE = re.compile(r"\bADR-(\d{4})\b")
LINKED_CITATION_RE = re.compile(r"\[ADR-(\d{4})\]\(([^)]+)\)")

FOREIGN_CITATION_RE = re.compile(r"\b([a-z0-9][\w.-]*)/ADR-(\d{4})\b")

CHEAP_REVERSAL_RE = re.compile(
    r"\b(?:one (?:commit|file|edit|line|sentence|section|paragraph)"
    r"|a single (?:commit|file|edit|line)"
    r"|trivial|trivially|cheap|cheaply"
    r"|costs? nothing|no cost|nothing to (?:undo|reverse|do)"
    r"|revert(?:ing)? (?:it|the commit)|delete the file|git history)\b",
    re.IGNORECASE,
)

CHEAP_REVERSAL_WARNING = (
    "`reversal:` reads cheap ({phrase!r}); an ADR records a constraint that binds "
    "later work. If undoing this really is one edit, it is an implementation note: "
    "put it in the code that does it, or in docs/research/ if it carries evidence."
)

NO_FRONTMATTER = (
    "no frontmatter; an ADR opens with a `---` block carrying "
    f"{', '.join(f'`{k}`' for k in REQUIRED_KEYS)}. Run `new-adr \"<the ruling>\"` "
    "to get one stamped."
)
MISSING_KEY = "frontmatter has no `{key}:`, which is required on every ADR."
BAD_STATUS = "`status: {got}` is not one of {allowed}."
NO_TITLE = (
    "no `# ` title; the title is the ruling stated as a sentence, and it is what "
    "the index publishes."
)
SHORT_TITLE = (
    "title is {n} word(s); the title carries the ruling, so it reads as a sentence "
    "(\"Triage labels are positions, not verdicts\"), never a topic (\"Triage labels\")."
)
OVER_CAP = (
    "body is {n} words, over the {cap}-word cap. The ruling and why it binds fit "
    "in ~120; evidence, worked examples and measurements go to docs/research/ and "
    "the ADR links them."
)
EMPTY_REVERSAL = (
    "`reversal:` is empty; state in a sentence what undoing this would cost. It is "
    "the admission bar: if the answer is one edit, this is not a constraint."
)

REJECTED_RE = re.compile(r"^[ \t]*\*\*Rejected:\*{0,2}[ \t]*(\S.*)$", re.MULTILINE)
HTML_COMMENT_RE = re.compile(r"<!--.*?-->", re.DOTALL)

WEAK_ALTERNATIVE_RE = re.compile(
    r"\b(?:doing nothing|the status quo|status quo|no change|inaction"
    r"|not doing (?:this|it|anything)|leaving it (?:as is|alone|be)"
    r"|keeping it as is|the current (?:state|behaviour|behavior))\b",
    re.IGNORECASE,
)

WEAK_ALTERNATIVE_WARNING = (
    "`**Rejected:` names the absence of the decision ({phrase!r}), which every ruling "
    "can claim and none is sharpened by. Name the other thing you could have built, "
    "and what choosing it would have cost."
)


class ValidationError(Exception):
    pass


def slugify(title: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")
    return slug[:60].rstrip("-")


def split_frontmatter(text: str) -> tuple[dict[str, str], str]:
    m = FRONTMATTER_RE.match(text)
    if not m:
        return {}, text
    fm: dict[str, str] = {}
    for line in m.group(1).splitlines():
        if ":" not in line or line.lstrip().startswith("#"):
            continue
        key, _, value = line.partition(":")
        fm[key.strip()] = value.strip()
    return fm, text[m.end():]


def title_of(body: str) -> str:
    m = H1_RE.search(body)
    return m.group(1).strip() if m else ""


def body_words(body: str) -> int:
    without_title = H1_RE.sub("", body, count=1)
    return len(without_title.split())


def cheap_reversal(reversal: str) -> str:
    m = CHEAP_REVERSAL_RE.search(reversal)
    return m.group(0) if m else ""


def rejected_alternative(body: str) -> str:
    m = REJECTED_RE.search(HTML_COMMENT_RE.sub("", body))
    return m.group(1).strip() if m else ""


def weak_alternative(alternative: str) -> str:
    m = WEAK_ALTERNATIVE_RE.search(alternative)
    return m.group(0) if m else ""


def _grandfathered(fm: dict[str, str], bar_from: date | None) -> bool:
    if bar_from is None:
        return False
    try:
        recorded = date.fromisoformat(fm.get("date", "").strip())
    except ValueError:
        return False
    return recorded < bar_from


def validate(text: str, *, bar_from: date | None = None) -> list[str]:
    fm, body = split_frontmatter(text)
    if not fm:
        raise ValidationError(NO_FRONTMATTER)

    if "date" not in fm:
        raise ValidationError(MISSING_KEY.format(key="date"))

    grandfathered = _grandfathered(fm, bar_from)

    if not grandfathered:
        for key in BAR_KEYS:
            if key not in fm:
                raise ValidationError(MISSING_KEY.format(key=key))

    status = fm.get("status", "")
    if not grandfathered and status not in STATUSES:
        raise ValidationError(BAD_STATUS.format(got=status, allowed=", ".join(STATUSES)))

    title = title_of(body)
    if not title:
        raise ValidationError(NO_TITLE)
    if len(title.split()) < 4:
        raise ValidationError(SHORT_TITLE.format(n=len(title.split())))

    words = body_words(body)
    if not grandfathered and words > WORD_CAP:
        raise ValidationError(OVER_CAP.format(n=words, cap=WORD_CAP))

    reversal = fm.get("reversal", "").strip()
    if not grandfathered and not reversal:
        raise ValidationError(EMPTY_REVERSAL)

    warnings: list[str] = []
    phrase = cheap_reversal(reversal) if status == "constraint" else ""
    if phrase:
        warnings.append(CHEAP_REVERSAL_WARNING.format(phrase=phrase))

    weak = weak_alternative(rejected_alternative(body)) if status == "constraint" else ""
    if weak:
        warnings.append(WEAK_ALTERNATIVE_WARNING.format(phrase=weak))
    return warnings



class Adr:

    __slots__ = ("number", "slug", "path", "frontmatter", "body", "title", "words", "corpus")

    def __init__(self, path: Path, number: int, slug: str, text: str):
        self.path = path
        self.number = number
        self.slug = slug
        self.corpus = path.parent
        self.frontmatter, self.body = split_frontmatter(text)
        self.title = title_of(self.body)
        self.words = body_words(self.body)

    @property
    def status(self) -> str:
        return self.frontmatter.get("status", "")

    @property
    def reversal(self) -> str:
        return self.frontmatter.get("reversal", "")

    @property
    def ident(self) -> str:
        return f"ADR-{self.number:04d}"


def adr_dir(repo_root: Path) -> Path:
    return repo_root / "docs" / "adr"


def find_adr_dirs(repo_root: Path) -> list[Path]:
    found: list[Path] = []
    stack = [repo_root]
    while stack:
        d = stack.pop()
        try:
            entries = list(d.iterdir())
        except OSError:
            continue
        for e in entries:
            if not e.is_dir():
                continue
            if e.name in SKIP_DIRS:
                continue
            if e.name == "adr" and e.parent.name == "docs":
                found.append(e)
                continue
            stack.append(e)
    return sorted(found)


def load_corpus_dir(d: Path) -> list[Adr]:
    out: list[Adr] = []
    if not d.is_dir():
        return out
    for path in sorted(d.iterdir()):
        m = LANDED_RE.match(path.name)
        if not m:
            continue
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        out.append(Adr(path, int(m.group(1)), m.group(2), text))
    return sorted(out, key=lambda a: a.number)


def load_corpus(repo_root: Path) -> list[Adr]:
    return load_corpus_dir(adr_dir(repo_root))


def load_all_corpora(repo_root: Path) -> list[Adr]:
    out: list[Adr] = []
    for d in find_adr_dirs(repo_root):
        out.extend(load_corpus_dir(d))
    return sorted(out, key=lambda a: a.number)


def next_number(repo_root: Path, origin_numbers: list[int] | None = None) -> int:
    highest = max((a.number for a in load_all_corpora(repo_root)), default=0)
    for n in origin_numbers or []:
        highest = max(highest, n)
    return highest + 1



INDEX_NAME = "INDEX.md"

INDEX_HEADER = (
    '<!-- Generated by `bin/adr-check`. Edits here are overwritten; change the ADR. -->\n'
    '# Decisions\n'
    '\n'
    'Every constraint this repo is bound by, newest last. An ADR records something later\n'
    'work must not stray from; the title is the ruling. Read a body only for the why.\n'
    '\n'
    'File one with `new-adr "the ruling as a sentence"`, then `new-adr --land <draft>`.\n'
    '\n'
    '| # | Ruling |\n'
    '|---|---|\n'
)

RETIRED_HEADER = (
    '\n'
    '## Retired\n'
    '\n'
    'Demoted. The numbers stay resolvable because citations escaped into issues before the\n'
    'demotion; nothing here binds later work.\n'
    '\n'
)


def render_index(corpus: list[Adr]) -> str:
    rows = []
    for a in corpus:
        if a.status != "constraint":
            continue
        title = a.title.replace("|", "\\|") or f"_(untitled: {a.path.name})_"
        rows.append(f"| {a.number:04d} | [{title}]({a.path.name}) |")
    retired = [f"- [{a.number:04d}]({a.path.name}) {a.status or '?'}"
               for a in corpus if a.status != "constraint"]
    counts: dict[str, int] = {}
    for a in corpus:
        counts[a.status or "?"] = counts.get(a.status or "?", 0) + 1
    words = sum(a.words for a in corpus)
    tally = " · ".join(f"{n} {s}" for s, n in sorted(counts.items()))
    noun = "ADR" if len(corpus) == 1 else "ADRs"
    footer = f"\n{len(corpus)} {noun} · {tally} · {words:,} words total.\n"
    out = INDEX_HEADER + "".join(f"{r}\n" for r in rows)
    if retired:
        out += RETIRED_HEADER + "".join(f"{r}\n" for r in retired)
    return out + footer


def index_path(repo_root: Path) -> Path:
    return adr_dir(repo_root) / INDEX_NAME



def citations(text: str) -> list[int]:
    masked = FOREIGN_CITATION_RE.sub(lambda m: "x" * len(m.group(0)), text)
    return [int(n) for n in CITATION_RE.findall(masked)]


def repo_root_from(start: Path | None = None) -> Path | None:
    here = (start or Path.cwd()).resolve()
    for candidate in (here, *here.parents):
        if (candidate / ".git").exists():
            return candidate
    return None
