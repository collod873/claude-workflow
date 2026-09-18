#!/usr/bin/env python3
import fnmatch
import json
import os
import re
import shutil
import subprocess
from pathlib import Path

KINDS = ("note", "question", "ticket", "spec")

SHARED_DIR = Path(__file__).resolve().parent / "lib"

IMMUTABLE_SET_PATH = SHARED_DIR / "immutable-set.json"
IMMUTABLE_SET: tuple[str, ...] = tuple(json.loads(IMMUTABLE_SET_PATH.read_text()))

RULES_PATH = SHARED_DIR / "ticket-shape.rules.json"
RULES = json.loads(RULES_PATH.read_text())
FRAGMENTS = RULES["fragments"]
GRAMMAR = RULES["grammar"]
REFUSALS = RULES["refusals"]

FLAG_BITS = {"m": re.MULTILINE, "i": re.IGNORECASE, "g": 0}


def compile_rule(name: str) -> re.Pattern:
    rule = GRAMMAR[name]
    source = rule["source"]
    for fragment, spelling in FRAGMENTS.items():
        source = source.replace("{" + fragment + "}", spelling)
    flags = 0
    for letter in rule["flags"]:
        flags |= FLAG_BITS[letter]
    return re.compile(source, flags)


def touches_immutable_set(paths: list[str]) -> list[str]:
    return [p for p in paths if any(p == entry or p.startswith(entry) for entry in IMMUTABLE_SET)]


WORKSTATION_PATH_EXACT = ("~",)
WORKSTATION_PATH_PREFIXES = ("~/", ".claude/settings")


def is_workstation_path(path: str) -> bool:
    stripped = path.strip("`")
    return stripped in WORKSTATION_PATH_EXACT or stripped.startswith(WORKSTATION_PATH_PREFIXES)


def classify_venue(paths: list[str]) -> str | None:
    if any(is_workstation_path(p) for p in paths):
        return "workstation"
    if touches_immutable_set(paths):
        return "immutable-set"
    return None


def caller_repo_root(start: Path | None = None) -> Path:
    here = (start or Path.cwd()).resolve()
    for d in (here, *here.parents):
        if (d / ".git").exists():
            return d
    return here


GIT_REMOTE_TIMEOUT_SECONDS = 10


def repo_slug_from_url(url: str) -> str | None:
    owner, _, name = url.strip().rstrip("/").removesuffix(".git").rpartition("/")
    owner = owner.rpartition(":")[2].rpartition("/")[2]
    return f"{owner}/{name}" if owner and name else None


def current_repo_slug(start: Path | None = None) -> str | None:
    root = caller_repo_root(start)
    if not (root / ".git").exists():
        return None
    try:
        result = subprocess.run(
            ["git", "-C", str(root), "remote", "get-url", "origin"],
            capture_output=True, text=True, timeout=GIT_REMOTE_TIMEOUT_SECONDS,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    return repo_slug_from_url(result.stdout) if result.returncode == 0 else None

LINE_TERMINATOR_RE = compile_rule("lineTerminator")


def normalize_newlines(text: str) -> str:
    return LINE_TERMINATOR_RE.sub("\n", text)


QUESTION_HEADING_RE = re.compile(r"^## Question\s*$", re.MULTILINE)
CRITERIA_HEADING_RE = compile_rule("criteriaHeading")
CRITERIA_ITEM_RE = compile_rule("criteriaItem")
FILES_CLAIMED_HEADING_RE = compile_rule("filesClaimedHeading")
NEXT_HEADING_RE = compile_rule("nextHeading")

PATH_LINE_RE = re.compile(r"[\w./\-]*[/.][\w./\-]*:\d+")
FILE_PATH_RE = re.compile(r"\b[\w.\-]+(?:/[\w.\-]+)+\b")

CHECK_MARKER_ATTEMPT_RE = compile_rule("checkMarkerAttempt")
CHECK_MARKER_RE = compile_rule("checkMarker")
CHECK_READS_TRACKER_RE = compile_rule("checkReadsTracker")
CHECK_READS_TRACKER = REFUSALS["checkReadsTracker"]

UNMARKED_CRITERION_PREFIX = "acceptance criterion carries no check: command"

WHOLE_REPO_CHECK_PREFIX = "acceptance criterion's check: runs a whole-repo check"

ALREADY_TRUE_CHECK_PREFIX = "acceptance criterion is already true before any work exists"

CONTRACT_PATH = Path(".claude") / "contract.json"

MALFORMED_CHECK_MARKER_PREFIX = "acceptance criterion carries a `check:` marker that doesn't parse"

UNRESOLVED_CHECK_COMMAND_WORD_PREFIX = (
    "acceptance criterion's check: marker names a command whose first word doesn't resolve"
)

SPEC_NO_CRITERIA = (
    "a spec body needs a '## Acceptance criteria' heading carrying exactly one '- [ ]' item, "
    "the one behavioural claim this spec closes on, in the owner's own words, with a trailing "
    "- check: `<command>` marker naming what proves it"
)
SPEC_CRITERIA_COUNT = (
    "a spec body carries exactly one '- [ ]' acceptance criterion, not {n}. Three behavioural "
    "claims are three specs, and a closer handed several has no single sentence to run"
)
SPEC_CRITERION_UNRUNNABLE = (
    "a spec's one acceptance criterion must carry a well-formed trailing - check: `<command>` "
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

SH_PARSE_TIMEOUT_SECONDS = 5

SPEC_CRITERION_UNPARSEABLE_BY_SH = (
    "acceptance criterion's check: `{command}` cannot be parsed by /bin/sh, the shell "
    "bin/close-ticket and red-at-publish both run every check under ({error}); wrap a "
    "bash-only command (process substitution, arrays) in bash -c '...'"
)

UNPARSEABLE_CHECK_COMMAND_SH_PREFIX = (
    "acceptance criterion's check: marker cannot be parsed by /bin/sh, the shell "
    "bin/close-ticket runs it under"
)

MIGRATION_RE = re.compile(
    r"\b(?:migrat(?:e|es|ed|ing|ion|ions)|backfill(?:s|ed|ing)?|scrub(?:s|bed|bing)?"
    r"|purg(?:e|es|ed|ing)|reindex(?:es|ed|ing)?|one-off)\b",
    re.IGNORECASE,
)

TEST_MENTION_RE = re.compile(
    r"(?<![A-Za-z0-9])tests?(?![A-Za-z0-9])|(?<![A-Za-z0-9])vitest(?![A-Za-z0-9])"
    r"|(?<![A-Za-z0-9])pytest(?![A-Za-z0-9])|(?<![A-Za-z0-9])jest(?![A-Za-z0-9])",
    re.IGNORECASE,
)

BASENAME_RE = re.compile(r"\b[\w\-]+(?:\.[\w\-]+)+\b")

UNMARKED_CRITERION_REASON = (
    "Every criterion ends in - check: `<command>`, the narrowest command that fails before this "
    "ticket's work and passes after it: /drain skips a ticket carrying a criterion without one, "
    "and close-ticket can only record it UNVERIFIED"
)

WHOLE_REPO_CHECK_REASON = (
    "The gate already runs every check .claude/contract.json names on every change, so this "
    "criterion adds nothing a diff can turn from red to green. Name the one test or grep that "
    "proves this ticket's own claim"
)

ALREADY_TRUE_CHECK_REASON = (
    "A criterion names what this ticket's work makes true, so its check fails today. What must "
    "stay true belongs to the tests that already hold it, not to a new criterion"
)

MIGRATION_NO_POST_STATE_WARNING = (
    "this reads like a migration, but every acceptance criterion is satisfied by the "
    "artifact existing: a test passing, or a path this ticket already claims. A migration "
    "ticket closes on the migration having run: add a criterion asserting the post-state of "
    "what is being migrated, checkable against the real target rather than a fixture the "
    "ticket's own test builds (claude-workflow/ADR-0076, #134)"
)

_GLOB_CHAR_RE = re.compile(r"[*?\[]")

NO_FILES_SENTINEL_RE = compile_rule("noFilesSentinel")

CATCH_ALL_PATTERNS = frozenset({"**", "*", "**/*", "./**", "**/**", ".", "/", "./*"})

DEGENERATE_CLAIM_MESSAGE = "could not name the files this touches"

CLAIM_LIMIT = RULES["claimLimit"]

CLAIM_IS_GLOB = REFUSALS["claimIsGlob"]

CLAIM_TOO_WIDE = REFUSALS["claimTooWide"]

MISSING_CRITERIA_HEADING = REFUSALS["missingCriteriaHeading"]
CRITERIA_HEADING_WITHOUT_ITEMS = REFUSALS["criteriaHeadingWithoutItems"]
MISSING_FILES_CLAIMED_HEADING = REFUSALS["missingFilesClaimedHeading"]


class ValidationError(Exception):
    pass


def parse_check_marker(criterion: str) -> str | None:
    m = CHECK_MARKER_RE.search(criterion.strip())
    return m.group(1).strip() if m else None


def _check_command_word(command: str) -> str:
    stripped = command.strip()
    return stripped.split(maxsplit=1)[0] if stripped else ""


def _check_command_word_resolves(word: str, repo_root: Path | None = None) -> bool:
    if "/" not in word:
        return shutil.which(word) is not None
    path = Path(word).expanduser()
    if not path.is_absolute():
        path = (repo_root or caller_repo_root()) / path
    return path.is_file() and os.access(path, os.X_OK)


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
            f"acceptance criterion's check: `{command}` could not be run: {e}. Red-at-publish "
            "could not be checked (claude-workflow/ADR-0130)"
        )
    return result.returncode == 0, None


def _check_sh_parseable(command: str) -> tuple[bool, str | None]:
    try:
        result = subprocess.run(
            ["/bin/sh", "-n", "-c", command],
            capture_output=True, text=True, timeout=SH_PARSE_TIMEOUT_SECONDS,
        )
    except (subprocess.TimeoutExpired, OSError):
        return True, None
    if result.returncode == 0:
        return True, None
    return False, ((result.stderr or result.stdout) or "").strip()


def _unparseable_by_sh_warning(criterion: str, error: str | None) -> str:
    detail = f": {error}" if error else ""
    return f"{UNPARSEABLE_CHECK_COMMAND_SH_PREFIX}: {criterion}{detail}"


def _malformed_check_marker(criterion: str) -> bool:
    return bool(CHECK_MARKER_ATTEMPT_RE.search(criterion)) and parse_check_marker(criterion) is None


def _malformed_check_marker_warning(criterion: str) -> str:
    return (
        f"{MALFORMED_CHECK_MARKER_PREFIX}: {criterion}. A well-formed marker names exactly "
        "one backtick-quoted command immediately after `check:`, with nothing else following "
        "it before the criterion ends"
    )


def _unresolved_check_command_word_reason(word: str) -> str:
    return (
        f"`{word}` has no `/` and doesn't resolve on PATH, and isn't a `/`-path naming an "
        "existing executable file after expanding a leading `~`"
    )


def _unresolved_check_command_word_warning(criterion: str, word: str) -> str:
    return f"{UNRESOLVED_CHECK_COMMAND_WORD_PREFIX}: {criterion}. {_unresolved_check_command_word_reason(word)}"


def _unresolved_check_command_word_error(command: str, word: str) -> str:
    return (
        f"acceptance criterion's check: `{command}` names a command whose first word doesn't "
        f"resolve. {_unresolved_check_command_word_reason(word)}"
    )


def validate(kind: str, body: str, repo_root: Path | None = None) -> list[str]:
    if kind not in KINDS:
        raise ValidationError(f"unknown kind {kind!r}, expected one of {', '.join(KINDS)}")

    body = normalize_newlines(body)

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
            raise ValidationError(MISSING_CRITERIA_HEADING)
        if not CRITERIA_ITEM_RE.search(section_text(body, CRITERIA_HEADING_RE)):
            raise ValidationError(CRITERIA_HEADING_WITHOUT_ITEMS)
        if not FILES_CLAIMED_HEADING_RE.search(body):
            raise ValidationError(MISSING_FILES_CLAIMED_HEADING)
        claimed = claimed_paths(body)
        for entry in claimed:
            if _GLOB_CHAR_RE.search(entry):
                raise ValidationError(CLAIM_IS_GLOB.format(entry=entry))
        if len(claimed) > CLAIM_LIMIT:
            raise ValidationError(
                CLAIM_TOO_WIDE.format(count=len(claimed), limit=CLAIM_LIMIT)
            )
        warnings = []
        whole_repo = whole_repo_commands(repo_root or caller_repo_root())
        for block in criteria_blocks(body) or []:
            if _malformed_check_marker(block):
                warnings.append(_malformed_check_marker_warning(block))
                continue
            command = parse_check_marker(block)
            if command is None:
                warnings.append(f"{UNMARKED_CRITERION_PREFIX}: {block}. {UNMARKED_CRITERION_REASON}")
                continue
            if CHECK_READS_TRACKER_RE.search(command):
                raise ValidationError(CHECK_READS_TRACKER.format(command=command))
            if command in whole_repo:
                warnings.append(f"{WHOLE_REPO_CHECK_PREFIX}: {block}. {WHOLE_REPO_CHECK_REASON}")
            word = _check_command_word(command)
            if word and not _check_command_word_resolves(word, repo_root):
                warnings.append(_unresolved_check_command_word_warning(block, word))
            parseable, sh_error = _check_sh_parseable(command)
            if not parseable:
                warnings.append(_unparseable_by_sh_warning(block, sh_error))
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
    word = _check_command_word(command)
    if word and not _check_command_word_resolves(word, root):
        raise ValidationError(_unresolved_check_command_word_error(command, word))
    parseable, sh_error = _check_sh_parseable(command)
    if not parseable:
        raise ValidationError(SPEC_CRITERION_UNPARSEABLE_BY_SH.format(command=command, error=sh_error))
    green, warning = _check_already_green(command, root)
    if green:
        raise ValidationError(SPEC_CRITERION_GREEN_AT_PUBLISH.format(command=command))
    return [warning] if warning else []


def acceptance_criteria_present(body: str) -> bool:
    return bool(CRITERIA_HEADING_RE.search(normalize_newlines(body)))


def section_text(body: str, heading_re: re.Pattern) -> str:
    body = normalize_newlines(body)
    m = heading_re.search(body)
    if not m:
        return ""
    rest = body[m.end():]
    end = NEXT_HEADING_RE.search(rest)
    return rest[: end.start()] if end else rest


def strip_section(body: str, heading_re: re.Pattern) -> str:
    body = normalize_newlines(body)
    m = heading_re.search(body)
    if not m:
        return body
    rest = body[m.end():]
    end = NEXT_HEADING_RE.search(rest)
    section_end = m.end() + (end.start() if end else len(rest))
    return body[: m.start()] + body[section_end:]


def claimed_paths(body: str) -> list[str]:
    paths = []
    for ln in section_text(body, FILES_CLAIMED_HEADING_RE).split("\n"):
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


def _claimed_path_warnings(body: str, root: Path) -> list[tuple[str, bool]]:
    warnings = []
    for path in claimed_paths(body):
        if _GLOB_CHAR_RE.search(path) or is_workstation_path(path):
            continue
        if (root / path).exists():
            continue
        suggestion = _similar_existing_path(path, root)
        if suggestion:
            warnings.append((
                f"claimed path `{path}` not found in the working tree; did you mean "
                f"`{suggestion}`?",
                False,
            ))
        else:
            warnings.append((f"claimed path `{path}` not found in the working tree", True))
    return warnings


def unresolved_claimed_paths(body: str, repo_root: Path | None = None) -> list[str]:
    return [w for w, _ in _claimed_path_warnings(body, repo_root or caller_repo_root())]


def advisory_warnings(body: str, repo_root: Path | None = None) -> list[str]:
    root = repo_root or caller_repo_root()
    return [w for w, advisory in _claimed_path_warnings(body, root) if advisory]


def criteria_blocks(body: str) -> list[str] | None:
    body = normalize_newlines(body)
    if not CRITERIA_HEADING_RE.search(body):
        return None
    blocks: list[str] = []
    for line in section_text(body, CRITERIA_HEADING_RE).split("\n"):
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


def whole_repo_commands(repo_root: Path) -> set[str]:
    try:
        slots = json.loads((repo_root / CONTRACT_PATH).read_text())
    except (OSError, ValueError):
        return set()
    commands = {slot.get("cmd") for slot in slots.values() if isinstance(slot, dict)}
    return {c.strip() for c in commands if isinstance(c, str) and "<" not in c}


def already_true_checks(
    body: str, repo_root: Path | None = None, exempt_paths: list[str] | None = None
) -> list[str]:
    body = normalize_newlines(body)
    root = repo_root or caller_repo_root()
    exempt = [p.strip("`") for p in claimed_paths(body) + (exempt_paths or [])]
    whole_repo = whole_repo_commands(root)
    warnings = []
    for block in criteria_blocks(body) or []:
        command = parse_check_marker(block)
        if command is None or command in whole_repo or CHECK_READS_TRACKER_RE.search(command):
            continue
        if any(path and path in command for path in exempt):
            continue
        word = _check_command_word(command)
        if not word or not _check_command_word_resolves(word, root):
            continue
        if not _check_sh_parseable(command)[0]:
            continue
        green, unrunnable = _check_already_green(command, root)
        if green:
            warnings.append(
                f"{ALREADY_TRUE_CHECK_PREFIX}: `{command}` exited 0 against this tree right now: "
                f"{block}. {ALREADY_TRUE_CHECK_REASON}"
            )
        elif unrunnable:
            warnings.append(f"{unrunnable}: {block}")
    return warnings


def migration_without_post_state(body: str) -> list[str]:
    body = normalize_newlines(body)
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
