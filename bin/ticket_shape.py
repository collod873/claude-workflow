#!/usr/bin/env python3
import fnmatch
import re
import subprocess
from pathlib import Path

KINDS = ("note", "question", "ticket", "spec")

def caller_repo_root(start: Path | None = None) -> Path:
    here = (start or Path.cwd()).resolve()
    for d in (here, *here.parents):
        if (d / ".git").exists():
            return d
    return here

QUESTION_HEADING_RE = re.compile(r"^## Question\s*$", re.MULTILINE)
CRITERIA_HEADING_RE = re.compile(r"^##\s+Acceptance criteria\s*$", re.MULTILINE)
CRITERIA_ITEM_RE = re.compile(r"^[ \t]*-\s*\[[ xX]\]", re.MULTILINE)
FILES_CLAIMED_HEADING_RE = re.compile(r"^## Files claimed\s*$", re.MULTILINE)
NEXT_HEADING_RE = re.compile(r"^##\s", re.MULTILINE)

PATH_LINE_RE = re.compile(r"[\w./\-]*[/.][\w./\-]*:\d+")
BACKTICK_RE = re.compile(r"`[^`\n]+`")
FILE_PATH_RE = re.compile(r"\b[\w.\-]+(?:/[\w.\-]+)+\b")

NO_EVIDENCE_WARNING = (
    "no acceptance criterion names a path:line, a backtick-quoted command, or a "
    "file/artifact reference; criteria should be verifiable by a fresh context that has "
    "not seen the diff"
)

CHECK_MARKER_DELIM = r"(?:—|–|(?<=\s)-{1,2}(?=\s))"
CHECK_MARKER_ATTEMPT_RE = re.compile(rf"{CHECK_MARKER_DELIM}\s*check:", re.IGNORECASE)
CHECK_MARKER_RE = re.compile(rf"{CHECK_MARKER_DELIM}\s*check:\s*`([^`\n]+)`\s*$")

MALFORMED_CHECK_MARKER_PREFIX = "acceptance criterion carries a `check:` marker that doesn't parse"

SPEC_NO_CRITERIA = (
    "a spec body needs a '## Acceptance criteria' heading carrying exactly one '- [ ]' item; "
    "the one behavioural claim this spec closes on, in the owner's own words, with a trailing "
    "— check: `<command>` marker naming what proves it"
)
SPEC_CRITERIA_COUNT = (
    "a spec body carries exactly one '- [ ]' acceptance criterion, not {n}: three behavioural "
    "claims are three specs, and a closer handed several has no single sentence to run"
)
SPEC_CRITERION_UNRUNNABLE = (
    "a spec's one acceptance criterion must carry a well-formed trailing — check: `<command>` "
    "marker; a spec closes on that command running green, so a criterion nobody can run leaves "
    "the spec with no definition of done: {criterion}"
)

RED_AT_PUBLISH_TIMEOUT_SECONDS = 30

SPEC_CRITERION_GREEN_AT_PUBLISH = (
    "a spec's one acceptance criterion is already true before any work exists: `{command}` "
    "exited 0 against this tree right now. A criterion that never turns red proves nothing when "
    "it turns green later; rewrite it to name something only the finished spec makes true "
    "(claude-workflow/ADR-0130)"
)

MIGRATION_RE = re.compile(
    r"\b(?:migrat(?:e|es|ed|ing|ion|ions)|backfill(?:s|ed|ing)?|scrub(?:s|bed|bing)?"
    r"|purg(?:e|es|ed|ing)|rewrit(?:e|es|ing|ten)|reindex(?:es|ed|ing)?|one-off)\b",
    re.IGNORECASE,
)

TEST_MENTION_RE = re.compile(r"\btests?\b|\bvitest\b|\bpytest\b|\bjest\b", re.IGNORECASE)

BASENAME_RE = re.compile(r"\b[\w\-]+(?:\.[\w\-]+)+\b")

MIGRATION_NO_POST_STATE_WARNING = (
    "this reads like a migration, but every acceptance criterion is satisfied by the "
    "artifact existing: a test passing, or a path this ticket already claims. A migration "
    "ticket closes on the migration having run: add a criterion asserting the post-state of "
    "what is being migrated, checkable against the real target rather than a fixture the "
    "ticket's own test builds (ADR-0076 in collod873/claude-workflow, #134)"
)

_GLOB_CHAR_RE = re.compile(r"[*?\[]")

NO_FILES_SENTINEL_RE = re.compile(r"^None\b.*no files", re.IGNORECASE)

CATCH_ALL_PATTERNS = frozenset({"**", "*", "**/*", "./**", "**/**", ".", "/", "./*"})

DEGENERATE_CLAIM_MESSAGE = "could not name the files this touches"

class ValidationError(Exception):
    pass

def _criteria_lines(body: str) -> list[str]:
    section = section_text(body, CRITERIA_HEADING_RE)
    return [ln for ln in section.splitlines() if CRITERIA_ITEM_RE.match(ln)]

def _has_evidence(line: str) -> bool:
    return bool(PATH_LINE_RE.search(line) or BACKTICK_RE.search(line) or FILE_PATH_RE.search(line))

def parse_check_marker(criterion: str) -> str | None:
    m = CHECK_MARKER_RE.search(criterion.strip())
    return m.group(1).strip() if m else None

def _check_already_green(command: str, repo_root: Path) -> tuple[bool, str | None]:
    try:
        result = subprocess.run(
            command, shell=True, cwd=repo_root, capture_output=True, text=True,
            timeout=RED_AT_PUBLISH_TIMEOUT_SECONDS,
        )
    except subprocess.TimeoutExpired:
        return False, (
            f"acceptance criterion's check: `{command}` did not finish within "
            f"{RED_AT_PUBLISH_TIMEOUT_SECONDS}s, so red-at-publish could not be checked "
            "(claude-workflow/ADR-0130)"
        )
    except OSError as e:
        return False, (
            f"acceptance criterion's check: `{command}` could not be run: {e}, so red-at-publish "
            "could not be checked (claude-workflow/ADR-0130)"
        )
    return result.returncode == 0, None

def _malformed_check_marker(criterion: str) -> bool:
    return bool(CHECK_MARKER_ATTEMPT_RE.search(criterion)) and parse_check_marker(criterion) is None

def _malformed_check_marker_warning(criterion: str) -> str:
    return (
        f"{MALFORMED_CHECK_MARKER_PREFIX}: {criterion}. A well-formed marker names exactly "
        "one backtick-quoted command immediately after `check:`, with nothing else following "
        "it before the criterion ends"
    )

def validate(kind: str, body: str, repo_root: Path | None = None) -> list[str]:
    if kind not in KINDS:
        raise ValidationError(f"unknown kind {kind!r}; expected one of {', '.join(KINDS)}")

    if kind == "note":
        return []

    if kind == "question":
        if not QUESTION_HEADING_RE.search(body):
            raise ValidationError(
                "missing required '## Question' heading; a `question` states what's undecided"
            )
        return []

    if kind == "ticket":
        if not CRITERIA_HEADING_RE.search(body):
            raise ValidationError(
                "missing required '## Acceptance criteria' heading"
            )
        if not CRITERIA_ITEM_RE.search(section_text(body, CRITERIA_HEADING_RE)):
            raise ValidationError(
                "'## Acceptance criteria' heading has no '- [ ]' items; plain '- ' bullets "
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

    if not CRITERIA_HEADING_RE.search(body):
        raise ValidationError(SPEC_NO_CRITERIA)
    blocks = criteria_blocks(body) or []
    if len(blocks) != 1:
        raise ValidationError(SPEC_CRITERIA_COUNT.format(n=len(blocks)))
    if _malformed_check_marker(blocks[0]):
        raise ValidationError(_malformed_check_marker_warning(blocks[0]))
    command = parse_check_marker(blocks[0])
    if command is None:
        raise ValidationError(SPEC_CRITERION_UNRUNNABLE.format(criterion=blocks[0]))
    root = repo_root or caller_repo_root()
    green, warning = _check_already_green(command, root)
    if green:
        raise ValidationError(SPEC_CRITERION_GREEN_AT_PUBLISH.format(command=command))
    return [warning] if warning else []

def acceptance_criteria_present(body: str) -> bool:
    return bool(CRITERIA_HEADING_RE.search(body))

def section_text(body: str, heading_re: re.Pattern) -> str:
    m = heading_re.search(body)
    if not m:
        return ""
    rest = body[m.end():]
    end = NEXT_HEADING_RE.search(rest)
    return rest[: end.start()] if end else rest

def strip_section(body: str, heading_re: re.Pattern) -> str:
    m = heading_re.search(body)
    if not m:
        return body
    rest = body[m.end():]
    end = NEXT_HEADING_RE.search(rest)
    section_end = m.end() + (end.start() if end else len(rest))
    return body[: m.start()] + body[section_end:]

def claimed_paths(body: str) -> list[str]:
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
    return bool(paths) and all(p in CATCH_ALL_PATTERNS for p in paths)

def _similar_existing_path(path: str, repo_root: Path) -> str | None:
    parts = path.split("/")
    if len(parts) < 2:
        return None
    candidates = {"/".join(parts[1:])}
    if len(parts) >= 3:
        candidates.add("/".join(parts[:-2] + parts[-1:]))
    hits = [c for c in candidates if c and (repo_root / c).exists()]
    return hits[0] if len(hits) == 1 else None

def unresolved_claimed_paths(body: str, repo_root: Path | None = None) -> list[str]:
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
                f"claimed path `{path}` not found in the working tree; did you mean "
                f"`{suggestion}`?"
            )
        else:
            warnings.append(f"claimed path `{path}` not found in the working tree")
    return warnings

def criteria_blocks(body: str) -> list[str] | None:
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
    tokens = [m.rsplit(":", 1)[0] for m in PATH_LINE_RE.findall(text)]
    tokens += FILE_PATH_RE.findall(text)
    tokens += BASENAME_RE.findall(text)
    return [t for t in tokens if t]

def _is_claimed(token: str, claimed: list[str]) -> bool:
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
    for a in a_paths:
        a_dir = a.rstrip("/") + "/"
        for b in b_paths:
            b_dir = b.rstrip("/") + "/"
            if a == b or fnmatch.fnmatch(b, a) or fnmatch.fnmatch(a, b):
                return True
            if b.startswith(a_dir) or a.startswith(b_dir):
                return True
    return False
