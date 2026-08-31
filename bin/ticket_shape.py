#!/usr/bin/env python3
"""Shared shape validator for `file-issue` and `publish-issue-graph` (#77).

`validate(kind, body)` is the one place that knows what each **kind** — `note`, `question`,
`ticket`, `spec` — requires of an issue body. `file-issue` calls it before ever invoking `gh`;
`hooks/test_ticket_templates.py` calls it against every documented example in
`docs/agents/ticket-format.md` so a producer's template and the validator can never drift apart
silently. Kind -> required shape:

  note      none
  question  `## Question` heading
  ticket    `## Acceptance criteria` with >=1 `- [ ]` item, and `## Files claimed`
  spec      none (title/label handling is the caller's job, not the body's)

A refusal raises `ValidationError` naming the missing heading. A `ticket` whose criteria carry
no verifiable evidence — a `path:line`, a backtick-quoted command, or a file/artifact reference
— is not refused, only warned about: `validate` returns that warning in its result rather than
raising, so a caller can print it to stderr and still proceed. Same treatment for a `## Files
claimed` bullet that doesn't resolve against the working tree (`unresolved_claimed_paths`,
#136) — a ticket may legitimately claim a file it is about to create, so a claim that looks
like a wrong guess is a warning, never a refusal. Third warning of the same severity: a
`ticket` that reads like a migration but whose every criterion is satisfied by its artifact
existing (`migration_without_post_state`, #144) — the shape that let spec #134 close over two
migrations nobody ran. Fourth: a criterion whose trailing `check:` marker (#166,
`parse_check_marker`) doesn't parse — present but malformed, never silently dropped back to
plain prose. "The working tree" means the **caller's**:
`caller_repo_root()` walks up from `cwd` for a `.git`, since `file-issue` is on `PATH` and files
for every repo on this machine, not just this one (#149). Outside any repository that root is
`cwd` itself.

This module also holds the `## Files claimed` parsing `file-issue ticketify` (#79) needs to
detect an already-written `## Acceptance criteria` section, substitute one cleanly, and intersect
one issue's claim against another's for ADR-0007's blocking-edge collision check — kept here
rather than in `bin/file-issue` because it is the same shape knowledge `validate`'s `ticket`
branch already holds, not a second copy of it.
"""
import fnmatch
import re
from pathlib import Path

KINDS = ("note", "question", "ticket", "spec")

def caller_repo_root(start: Path | None = None) -> Path:
    """The git root of the caller's working directory — the tree `unresolved_claimed_paths`
    resolves a claim against (#149). `file-issue` is on `PATH` and files for every repo on this
    machine, so the tree a claim belongs to is the caller's, never the one this file happens to
    live in. Walks up from `start` (default `cwd`) for a `.git` entry — a file, as in a worktree,
    counts. When `cwd` sits in no repository at all there is no claim tree to speak of, so `cwd`
    itself is returned: a relative claim then resolves the way the filer typed it."""
    here = (start or Path.cwd()).resolve()
    for d in (here, *here.parents):
        if (d / ".git").exists():
            return d
    return here

QUESTION_HEADING_RE = re.compile(r"^## Question\s*$", re.MULTILINE)
# `##\s+` (not a literal single space) is the tolerant half of #107's unification: it admits
# a superset of headings (extra spaces/tabs after `##`) and changes nothing either compiler
# already accepted, since every real heading in this repo is written with exactly one space.
CRITERIA_HEADING_RE = re.compile(r"^##\s+Acceptance criteria\s*$", re.MULTILINE)
CRITERIA_ITEM_RE = re.compile(r"^[ \t]*-\s*\[[ xX]\]", re.MULTILINE)
FILES_CLAIMED_HEADING_RE = re.compile(r"^## Files claimed\s*$", re.MULTILINE)
NEXT_HEADING_RE = re.compile(r"^##\s", re.MULTILINE)

# What counts as "verifiable evidence" in a criterion: a `path:line` reference, an inline
# backtick-quoted span (a command or a filename), or a bare repo-relative-looking path.
# The stricter half of #107's unification: a `/` or `.` somewhere in the path is required, so
# a bare word before the colon (`foo:12`) no longer counts — that shape was never a real
# repo path, and close-gate's own copy already refused it as `bad-evidence-shape`. One
# compiler now enforces this everywhere a `path:line` is judged, `file-issue`'s warning
# included, so a ticket it accepts as evidenced can no longer be refused at close for the
# same text.
PATH_LINE_RE = re.compile(r"[\w./\-]*[/.][\w./\-]*:\d+")
BACKTICK_RE = re.compile(r"`[^`\n]+`")
FILE_PATH_RE = re.compile(r"\b[\w.\-]+(?:/[\w.\-]+)+\b")

NO_EVIDENCE_WARNING = (
    "no acceptance criterion names a path:line, a backtick-quoted command, or a "
    "file/artifact reference — criteria should be verifiable by a fresh context that has "
    "not seen the diff"
)

# A criterion's trailing check marker (#166): an explicit `check: `<command>`` at the very
# end names the one command that verifies it, so a mechanical closer can run it rather than
# re-deriving what to check from prose. The delimiter alternation is the exact one
# `hooks/close-gate.py:173`'s VERDICT_RE already uses for its own trailing slot — em dash, en
# dash, or a space-delimited single/double hyphen — so a ticket author never learns two
# different dash rules for two different trailing markers.
CHECK_MARKER_DELIM = r"(?:—|–|(?<=\s)-{1,2}(?=\s))"
# An *attempt* at a marker: the delimiter followed by `check:`, regardless of what (if
# anything) follows. This is what tells a criterion that tried and failed (malformed — warn)
# apart from one that never mentioned `check:` at all (plain prose — today's behaviour, no
# warning); `CHECK_MARKER_RE` alone can't make that distinction since it only matches success.
CHECK_MARKER_ATTEMPT_RE = re.compile(rf"{CHECK_MARKER_DELIM}\s*check:", re.IGNORECASE)
# A well-formed marker: the attempt, followed by exactly one backtick-quoted command and
# nothing else through the end of the criterion. Anchored at both ends — `check:` immediately
# before the opening backtick, `\s*$` immediately after the closing one — so a second
# backtick span, or trailing prose, fails to parse rather than silently grabbing the wrong
# span. Never keys off `BACKTICK_RE` alone: an unrelated backtick anywhere earlier in the
# criterion (`` `foo.py` ``) can sit before the marker without being mistaken for it, and a
# criterion carrying more than one backtick span after the label doesn't parse either.
CHECK_MARKER_RE = re.compile(rf"{CHECK_MARKER_DELIM}\s*check:\s*`([^`\n]+)`\s*$")

MALFORMED_CHECK_MARKER_PREFIX = "acceptance criterion carries a `check:` marker that doesn't parse"

# A spec's own criterion. `spec` used to be the kind with no body requirement at all, which is
# why the one behavioural sentence the pipeline asks its owner for — "I'll know it works when I
# can ___" — landed in prose and nothing ever read it again. A spec closes on a run of its own
# check (`bin/close-ticket --spec`), so that sentence has to arrive as something runnable.
SPEC_NO_CRITERIA = (
    "a spec body needs a '## Acceptance criteria' heading carrying exactly one '- [ ]' item — "
    "the one behavioural claim this spec closes on, in the owner's own words, with a trailing "
    "— check: `<command>` marker naming what proves it"
)
# Exactly one, never "at least one": a spec with three behavioural claims is three specs, and
# the entire value of the rule is that there is a single sentence to point at when asking
# whether the product does the thing.
SPEC_CRITERIA_COUNT = (
    "a spec body carries exactly one '- [ ]' acceptance criterion, not {n} — three behavioural "
    "claims are three specs, and a closer handed several has no single sentence to run"
)
# The grammar is `CHECK_MARKER_RE`, unforked: an author who has written a ticket criterion
# already knows how to write a spec's, and a second dash rule for a second kind of body is
# exactly what the shared `CHECK_MARKER_DELIM` exists to prevent.
SPEC_CRITERION_UNRUNNABLE = (
    "a spec's one acceptance criterion must carry a well-formed trailing — check: `<command>` "
    "marker; a spec closes on that command running green, so a criterion nobody can run leaves "
    "the spec with no definition of done: {criterion}"
)

# The vocabulary that marks work done *to* existing state rather than work that adds a new
# capability (#144). Deliberately narrow: this is one half of an AND, and the other half —
# every criterion being satisfied by the ticket's own artifact — is what makes a hit mean
# something. A provisioning ticket (#136) uses none of these words and is not caught; see the
# ADR for why that miss is accepted rather than papered over with a wider list.
MIGRATION_RE = re.compile(
    r"\b(?:migrat(?:e|es|ed|ing|ion|ions)|backfill(?:s|ed|ing)?|scrub(?:s|bed|bing)?"
    r"|purg(?:e|es|ed|ing)|rewrit(?:e|es|ing|ten)|reindex(?:es|ed|ing)?|one-off)\b",
    re.IGNORECASE,
)

# A criterion that names a test asserts the ticket's own artifact works, never that the
# migration ran — `npm test -- scrub.test.ts` exits 0 and "the same test asserts ..." are the
# two spellings #141 and #142 closed on. `\btests?\b` catches both, and catches
# `scrub.test.ts` too, since `.` is not a word character.
TEST_MENTION_RE = re.compile(r"\btests?\b|\bvitest\b|\bpytest\b|\bjest\b", re.IGNORECASE)

# A bare filename carrying an extension (`scrub-corpus-history.test.ts`) — how a criterion
# names an artifact when it doesn't spell the whole path. `FILE_PATH_RE` requires a `/` and
# so misses it.
BASENAME_RE = re.compile(r"\b[\w\-]+(?:\.[\w\-]+)+\b")

MIGRATION_NO_POST_STATE_WARNING = (
    "this reads like a migration, but every acceptance criterion is satisfied by the "
    "artifact existing — a test passing, or a path this ticket already claims. A migration "
    "ticket closes on the migration having run: add a criterion asserting the post-state of "
    "what is being migrated, checkable against the real target rather than a fixture the "
    "ticket's own test builds (ADR-0076 in collod873/claude-workflow, #134)"
)

# Glob metacharacters (#136): a claim carrying any of these is a fan-out ADR-0007 explicitly
# permits ("globs permitted, exact paths preferred"), never a literal path — resolving it
# against the working tree would need real glob-matching semantics this check doesn't attempt,
# and skipping it entirely is what acceptance criterion 5 requires (no false warning on the
# claim shapes `file-issue` already accepts).
_GLOB_CHAR_RE = re.compile(r"[*?\[]")

# The no-files sentinel from docs/agents/ticket-format.md — a claim bullet matching this
# names no path, so it can never collide with anything and is dropped by `claimed_paths`.
NO_FILES_SENTINEL_RE = re.compile(r"^None\b.*no files", re.IGNORECASE)

# Glob patterns that exclude nothing real (ADR-0007's degenerate claim) — a lone '**' is
# the case the ADR names explicitly. A claim mixing one of these with a real path still
# excludes something, so degeneracy is a property of the whole claim, never one item.
CATCH_ALL_PATTERNS = frozenset({"**", "*", "**/*", "./**", "**/**", ".", "/", "./*"})

# The canonical words for a claim that fails ADR-0007's "must exclude something real"
# test — the phrasing the retired triage on-ramp used (ADR-0007, ADR-0032), kept verbatim
# so ticketify's refusal matches the one already written into every `fuzzy` issue.
DEGENERATE_CLAIM_MESSAGE = "could not name the files this touches"


class ValidationError(Exception):
    """Raised by `validate` when `body` doesn't fit `kind`'s required shape."""


def _criteria_lines(body: str) -> list[str]:
    section = section_text(body, CRITERIA_HEADING_RE)
    return [ln for ln in section.splitlines() if CRITERIA_ITEM_RE.match(ln)]


def _has_evidence(line: str) -> bool:
    return bool(PATH_LINE_RE.search(line) or BACKTICK_RE.search(line) or FILE_PATH_RE.search(line))


def parse_check_marker(criterion: str) -> str | None:
    """The command named by `criterion`'s trailing `check: `<command>`` marker, or `None`
    when the criterion carries none — either because it names no marker at all (plain prose,
    today's behaviour) or because what it names doesn't parse as one. Those two `None` cases
    are indistinguishable here on purpose: this function only ever answers the happy path;
    `validate` is where a present-but-unparseable marker gets told apart from prose and
    turned into a warning (`_malformed_check_marker`)."""
    m = CHECK_MARKER_RE.search(criterion.strip())
    return m.group(1).strip() if m else None


def _malformed_check_marker(criterion: str) -> bool:
    """True when `criterion` attempts a `check:` marker — the delimiter plus the label — but
    doesn't parse as one: a missing command, or more than one backtick span after the label.
    A criterion that never attempts a marker at all is plain prose, not this."""
    return bool(CHECK_MARKER_ATTEMPT_RE.search(criterion)) and parse_check_marker(criterion) is None


def _malformed_check_marker_warning(criterion: str) -> str:
    return (
        f"{MALFORMED_CHECK_MARKER_PREFIX}: {criterion} — a well-formed marker names exactly "
        "one backtick-quoted command immediately after `check:`, with nothing else following "
        "it before the criterion ends"
    )


def validate(kind: str, body: str, repo_root: Path | None = None) -> list[str]:
    """Validate `body` against `kind`'s required shape.

    Returns a (possibly empty) list of warning strings on success. Raises `ValidationError`,
    naming what's missing, on refusal. `note` never raises — the empty body it accepts is itself
    the shape. `spec` used to be the same and no longer is: it now carries the one shape a spec's
    close depends on (exactly one runnable criterion), refused here at filing time rather than
    discovered six weeks later when nothing can close it.

    `repo_root` is the tree a `ticket`'s `## Files claimed` bullets are resolved against;
    it defaults to `caller_repo_root()`, so a caller filing from another repo checks that
    repo. Pass it explicitly only to pin the tree — tests do, to stay `cwd`-independent.
    """
    if kind not in KINDS:
        raise ValidationError(f"unknown kind {kind!r} — expected one of {', '.join(KINDS)}")

    if kind == "note":
        return []

    if kind == "question":
        if not QUESTION_HEADING_RE.search(body):
            raise ValidationError(
                "missing required '## Question' heading — a `question` states what's undecided"
            )
        return []

    if kind == "ticket":
        if not CRITERIA_HEADING_RE.search(body):
            raise ValidationError(
                "missing required '## Acceptance criteria' heading"
            )
        if not CRITERIA_ITEM_RE.search(section_text(body, CRITERIA_HEADING_RE)):
            raise ValidationError(
                "'## Acceptance criteria' heading has no '- [ ]' items — plain '- ' bullets "
                "don't count"
            )
        if not FILES_CLAIMED_HEADING_RE.search(body):
            raise ValidationError(
                "missing required '## Files claimed' heading"
            )
        warnings = []
        lines = _criteria_lines(body)
        if lines and not any(_has_evidence(ln) for ln in lines):
            warnings.append(NO_EVIDENCE_WARNING)
        for block in criteria_blocks(body) or []:
            if _malformed_check_marker(block):
                warnings.append(_malformed_check_marker_warning(block))
        warnings.extend(unresolved_claimed_paths(body, repo_root))
        warnings.extend(migration_without_post_state(body))
        return warnings

    # kind == "spec"
    #
    # What is deliberately *not* applied here is the remote-tracker refusal a published ticket's
    # criterion gets (`render-body.ts`, in `collod873/claude-workflow`, which bans a check command
    # reaching `gh api`, `gh issue`, `gh pr`, `gh run`, `curl` or `wget`). That refusal is right
    # for a ticket and wrong here, and the asymmetry is the point: **a ticket's check reads the
    # tree, a spec's check reads the world.** A ticket's criterion must return a different verdict
    # before the diff exists and after it merges, so a command that queries the tracker is no
    # check at all. A spec's criterion has the opposite obligation — it is required to be
    # answerable only by production having changed — so extending that ban here would refuse
    # every honest spec check there is.
    if not CRITERIA_HEADING_RE.search(body):
        raise ValidationError(SPEC_NO_CRITERIA)
    blocks = criteria_blocks(body) or []
    if len(blocks) != 1:
        raise ValidationError(SPEC_CRITERIA_COUNT.format(n=len(blocks)))
    # A marker that was attempted and doesn't parse is refused by its own message, the same one
    # a ticket's criterion is warned with. The generic "must carry a marker" text is right for an
    # author who wrote none and useless to one who wrote a second backtick span by mistake — the
    # `spec` branch raises where the `ticket` branch warns, so the distinction has to survive the
    # change in severity.
    if _malformed_check_marker(blocks[0]):
        raise ValidationError(_malformed_check_marker_warning(blocks[0]))
    if parse_check_marker(blocks[0]) is None:
        raise ValidationError(SPEC_CRITERION_UNRUNNABLE.format(criterion=blocks[0]))
    return []


def acceptance_criteria_present(body: str) -> bool:
    """True when `body` already carries a '## Acceptance criteria' heading — what
    `file-issue ticketify` (#79) checks before appending vs. requiring `--replace`."""
    return bool(CRITERIA_HEADING_RE.search(body))


def section_text(body: str, heading_re: re.Pattern) -> str:
    """Return the raw text under `heading_re`'s heading, up to the next '##' heading or
    the end of `body` — "" when the heading is absent. The one place that knows how a
    section's extent is delimited — the only markdown section slicer in this repo (#102):
    `_criteria_lines` above, `hooks/close-gate.py`'s criteria count, and
    `hooks/vendored-router.py`'s manifest reader all call this rather than restating the
    slice below by hand."""
    m = heading_re.search(body)
    if not m:
        return ""
    rest = body[m.end():]
    end = NEXT_HEADING_RE.search(rest)
    return rest[: end.start()] if end else rest


def strip_section(body: str, heading_re: re.Pattern) -> str:
    """Remove `heading_re`'s entire section (its heading line through the next '##'
    heading or end of body) from `body`. `ticketify --replace` uses this on both
    canonical headings before appending the new ones, so a substitution always leaves
    exactly one copy of each section behind, regardless of where the old one sat."""
    m = heading_re.search(body)
    if not m:
        return body
    rest = body[m.end():]
    end = NEXT_HEADING_RE.search(rest)
    section_end = m.end() + (end.start() if end else len(rest))
    return body[: m.start()] + body[section_end:]


def claimed_paths(body: str) -> list[str]:
    """Parse '## Files claimed' bullets into normalized path/glob strings: strips the
    leading '-', surrounding backticks, and whitespace, and drops the no-files sentinel
    (it names no path, so it can never collide with anything)."""
    paths = []
    for ln in section_text(body, FILES_CLAIMED_HEADING_RE).splitlines():
        ln = ln.strip()
        if not ln.startswith("-"):
            continue
        item = ln[1:].strip().strip("`").strip()
        if item and not NO_FILES_SENTINEL_RE.match(item):
            paths.append(item)
    return paths


def is_degenerate_claim(paths: list[str]) -> bool:
    """True when every claimed path is a catch-all glob (`CATCH_ALL_PATTERNS`) — a claim
    that excludes nothing real per ADR-0007. An empty claim (a genuine no-files ticket) is
    not degenerate; that is a different, legitimate shape `claimed_paths` already parsed
    down to nothing."""
    return bool(paths) and all(p in CATCH_ALL_PATTERNS for p in paths)


def _similar_existing_path(path: str, repo_root: Path) -> str | None:
    """When `path` doesn't resolve under `repo_root`, check whether dropping exactly one
    leading directory component, or one trailing directory component (the segment right
    before the final name), yields a path that does — the `skills/drain/SKILL.md` ->
    `drain/SKILL.md` shape (#136). Returns the corrected path only when exactly one of the
    two candidates resolves, so an ambiguous case suggests nothing rather than guessing."""
    parts = path.split("/")
    if len(parts) < 2:
        return None
    candidates = {"/".join(parts[1:])}
    if len(parts) >= 3:
        candidates.add("/".join(parts[:-2] + parts[-1:]))
    hits = [c for c in candidates if c and (repo_root / c).exists()]
    return hits[0] if len(hits) == 1 else None


def unresolved_claimed_paths(body: str, repo_root: Path | None = None) -> list[str]:
    """Warn about every `## Files claimed` bullet that names neither an existing file or
    directory nor a glob (#136). Never refuses — a ticket may legitimately claim a path it
    is about to create, so this only flags a claim that looks like a wrong guess, matching
    the existing no-evidence warning's severity. A glob (`_GLOB_CHAR_RE`) is skipped
    entirely rather than resolved, and the no-files sentinel is already dropped by
    `claimed_paths` — both are claim shapes `file-issue` already accepts, so neither
    produces a false warning here."""
    root = repo_root or caller_repo_root()
    warnings = []
    for path in claimed_paths(body):
        if _GLOB_CHAR_RE.search(path):
            continue
        if (root / path).exists():
            continue
        suggestion = _similar_existing_path(path, root)
        if suggestion:
            warnings.append(
                f"claimed path `{path}` not found in the working tree — did you mean "
                f"`{suggestion}`?"
            )
        else:
            warnings.append(f"claimed path `{path}` not found in the working tree")
    return warnings


def criteria_blocks(body: str) -> list[str] | None:
    """Each `- [ ]` item under '## Acceptance criteria', folded together with its
    continuation lines into one string, in document order. A criterion wrapped across
    several lines is one claim, and judging only its first line reads half a sentence —
    "`git clone --mirror` of the public repo followed by" says nothing on its own.
    `_criteria_lines` stays line-shaped on purpose: its caller only asks whether *any*
    criterion carries evidence at all, which folding continuations in cannot change.

    `None` when `body` carries no '## Acceptance criteria' heading at all — `bin/close-ticket`
    reads that as its `No diff.` trigger (a ticket that never declared criteria has nothing
    to verify). A heading present with zero `- [ ]` items returns `[]`, not `None`: `validate`
    already refuses that shape at filing time, so no caller needs to tell the two apart."""
    if not CRITERIA_HEADING_RE.search(body):
        return None
    blocks: list[str] = []
    for line in section_text(body, CRITERIA_HEADING_RE).splitlines():
        if CRITERIA_ITEM_RE.match(line):
            blocks.append(line.strip())
        elif blocks and line.strip():
            blocks[-1] += " " + line.strip()
    return blocks


def _evidence_tokens(text: str) -> list[str]:
    """Every file-ish token `text` names: slashed paths, the path half of a `path:line`
    reference, and bare dotted filenames. Backticks aren't stripped first — every pattern
    here matches inside a backtick span as readily as outside one."""
    tokens = [m.rsplit(":", 1)[0] for m in PATH_LINE_RE.findall(text)]
    tokens += FILE_PATH_RE.findall(text)
    tokens += BASENAME_RE.findall(text)
    return [t for t in tokens if t]


def _is_claimed(token: str, claimed: list[str]) -> bool:
    """True when `token` names one of the ticket's own `## Files claimed` entries — the same
    string, one path being a suffix of the other, the same basename (how a criterion abbreviates
    a claim it already spelled in full), or a glob claim matching it."""
    for claim in claimed:
        claim = claim.strip("`")
        if token == claim or claim.endswith("/" + token) or token.endswith("/" + claim):
            return True
        if _GLOB_CHAR_RE.search(claim) and fnmatch.fnmatch(token, claim):
            return True
        if token.rsplit("/", 1)[-1] == claim.rsplit("/", 1)[-1]:
            return True
    return False


def migration_without_post_state(body: str) -> list[str]:
    """Warn when a ticket reads like a migration but every acceptance criterion is satisfied
    by its artifact existing (#144, ADR-0076 in `collod873/claude-workflow`).

    Spec #134 closed COMPLETED over two migrations nobody ran, because both tickets said
    *"Ship a script that ..."* and both criteria said *a test passes*. A suite passing proves
    the script works; it never proves the script ran. So a criterion counts as post-state
    evidence unless it either names a test or names nothing but paths the ticket itself claims
    — and a body carrying no post-state criterion at all draws this warning.

    Never refuses, matching `NO_EVIDENCE_WARNING`'s severity: "is this a migration?" is a
    judgement, and a refusal wrong in the deny direction stops legitimate filing dead. A
    criterion naming no file-ish token at all (`git notes --ref=sessions list` prints 29) is
    given the benefit of the doubt and counts as post-state.
    """
    if not MIGRATION_RE.search(body):
        return []
    blocks = criteria_blocks(body) or []
    if not blocks:
        return []
    claimed = claimed_paths(body)
    for block in blocks:
        if TEST_MENTION_RE.search(block):
            continue
        tokens = _evidence_tokens(block)
        if tokens and all(_is_claimed(t, claimed) for t in tokens):
            continue
        return []
    return [MIGRATION_NO_POST_STATE_WARNING]


def claims_collide(a_paths: list[str], b_paths: list[str]) -> bool:
    """True when any path/glob in `a_paths` overlaps any in `b_paths` — exact match, a
    glob matching the other's literal path (either direction), or one naming a directory
    that contains the other. The intersection ADR-0007 wires a blocking edge from."""
    for a in a_paths:
        a_dir = a.rstrip("/") + "/"
        for b in b_paths:
            b_dir = b.rstrip("/") + "/"
            if a == b or fnmatch.fnmatch(b, a) or fnmatch.fnmatch(a, b):
                return True
            if b.startswith(a_dir) or a.startswith(b_dir):
                return True
    return False
