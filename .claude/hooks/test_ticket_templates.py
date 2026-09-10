#!/usr/bin/env python3
import importlib.util
import os
import re
import tempfile
from pathlib import Path

from _harness import check, finish

HOOKS = Path(__file__).resolve().parent
REPO = next((c for c in (HOOKS.parent, HOOKS.parent.parent) if (c / "bin").is_dir()), HOOKS.parent)
TICKET_FORMAT_DOC = REPO / "docs" / "agents" / "ticket-format.md"
TICKET_FORMAT_SEED = REPO / "setup-matt-pocock-skills" / "ticket-format.md"

_spec = importlib.util.spec_from_file_location("close_gate", HOOKS / "close-gate.py")
_close_gate = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_close_gate)
count_body_criteria = _close_gate.count_body_criteria

_shape_spec = importlib.util.spec_from_file_location(
    "ticket_shape", REPO / "bin" / "ticket_shape.py"
)
ticket_shape = importlib.util.module_from_spec(_shape_spec)
_shape_spec.loader.exec_module(ticket_shape)

VARIANT_KIND = [
    ("Spec sub-issue", "ticket"),
    ("Local-file ticket", None),
    ("Wayfinder decision", "question"),
    ("Question (file-issue question", "question"),
]

def variant_cases():
    text = TICKET_FORMAT_DOC.read_text()
    section_match = re.search(r"^## Variants\s*\n(.*)", text, re.MULTILINE | re.DOTALL)
    if not section_match:
        return
    section = section_match.group(1)
    headings = list(re.finditer(r"^### (.+)$", section, re.MULTILINE))
    for i, heading in enumerate(headings):
        start = heading.end()
        end = headings[i + 1].start() if i + 1 < len(headings) else len(section)
        chunk = section[start:end]
        block = re.search(r"```markdown\n(.*?)```", chunk, re.DOTALL)
        yield heading.group(1).strip(), (block.group(1) if block else None)


TICKET_BODY_CLAIM_RESOLVES = (
    "## Acceptance criteria\n\n- [ ] `.claude/hooks/_hook.py` still exists\n\n"
    "## Files claimed\n\n- .claude/hooks/_hook.py\n"
)

TICKET_BODY_CLAIM_WRONG_PREFIX = (
    "## Acceptance criteria\n\n- [ ] `skills/.claude/hooks/_hook.py` still exists\n\n"
    "## Files claimed\n\n- skills/.claude/hooks/_hook.py\n"
)


def test_unresolved_claimed_paths():
    print("ticket_shape.validate: '## Files claimed' paths checked against the working tree (#136)")

    resolves_warnings = ticket_shape.validate(
        "ticket", TICKET_BODY_CLAIM_RESOLVES, repo_root=REPO
    )
    check("a claim on a path that exists warns nothing", resolves_warnings == [],
          resolves_warnings)

    try:
        wrong_prefix_warnings = ticket_shape.validate(
            "ticket", TICKET_BODY_CLAIM_WRONG_PREFIX, repo_root=REPO
        )
    except ticket_shape.ValidationError as e:
        check("filing still succeeds (no refusal) when a claim doesn't resolve", False, str(e))
    else:
        check("filing still succeeds (no refusal) when a claim doesn't resolve", True)
        check("a claim on `skills/.claude/hooks/_hook.py` warns", len(wrong_prefix_warnings) == 1,
              wrong_prefix_warnings)
        warning_text = wrong_prefix_warnings[0] if wrong_prefix_warnings else ""
        check("the warning names the unresolved claim",
              "skills/.claude/hooks/_hook.py" in warning_text, warning_text)
        check("the warning suggests the real path `.claude/hooks/_hook.py`",
              ".claude/hooks/_hook.py" in warning_text, warning_text)


TICKET_BODY_OUTSIDE_CLAIM = (
    "## Acceptance criteria\n\n- [ ] `src/spine.ts` still exists\n\n"
    "## Files claimed\n\n- src/spine.ts\n"
)

TICKET_BODY_OUTSIDE_TYPO = (
    "## Acceptance criteria\n\n- [ ] `app/src/spine.ts` still exists\n\n"
    "## Files claimed\n\n- app/src/spine.ts\n"
)


def test_claims_resolve_against_the_callers_repo():
    print("ticket_shape.validate: claims resolve against the caller's repo, not this one (#149)")

    with tempfile.TemporaryDirectory() as tmp:
        outside = Path(tmp) / "workflow"
        (outside / "src").mkdir(parents=True)
        (outside / ".git").mkdir()
        (outside / "src" / "spine.ts").write_text("export {}\n")

        root = ticket_shape.caller_repo_root(outside / "src")
        check("caller_repo_root walks up from cwd to the outside repo's root",
              root == outside.resolve(), f"{root} != {outside.resolve()}")

        cwd = Path.cwd()
        try:
            os.chdir(outside / "src")
            resolves = ticket_shape.validate("ticket", TICKET_BODY_OUTSIDE_CLAIM)
            check("a claim that exists in the caller's repo warns nothing", resolves == [],
                  resolves)

            typo = ticket_shape.validate("ticket", TICKET_BODY_OUTSIDE_TYPO)
            check("a claim that exists in neither repo still warns", len(typo) == 1, typo)
            typo_text = typo[0] if typo else ""
            check("the suggestion is drawn from the caller's repo, not this one",
                  "did you mean `src/spine.ts`" in typo_text, typo_text)
        finally:
            os.chdir(cwd)


TICKET_BODY_MIGRATION_TEST_ONLY = (
    "## What to build\n\nA script that runs one `git filter-repo` history-rewrite pass over a "
    "target git repository.\n\n"
    "## Acceptance criteria\n\n"
    "- [ ] `npm test -- scrub-corpus-history.test.ts` exits 0 both on a machine carrying "
    "`git filter-repo` and on one without it\n"
    "- [ ] With the tool present, the same test asserts the rewritten repo's `HEAD` tree still "
    "contains `adr-corpus.evidence.json` with its current bytes intact\n\n"
    "## Files claimed\n\n"
    "- bin/scrub-corpus-history.py\n- hooks/test_scrub_corpus_history.py\n"
)

TICKET_BODY_MIGRATION_CLAIMED_PATH_ONLY = (
    "## What to build\n\nA script that rewrites every record on `refs/notes/sessions` to the "
    "new schema, backfilling `corpusPath`.\n\n"
    "## Acceptance criteria\n\n"
    "- [ ] `grep -n 'collod873' bin/rewrite-session-notes.py` exits nonzero\n\n"
    "## Files claimed\n\n- bin/rewrite-session-notes.py\n"
)

TICKET_BODY_MIGRATION_POST_STATE = (
    "## What to build\n\nRewrite this repository's history to drop the exposed blobs.\n\n"
    "## Acceptance criteria\n\n"
    "- [ ] `npm test -- scrub-corpus-history.test.ts` exits 0\n"
    "- [ ] `git rev-list --all --objects | grep -c session-prompts-2026-08.md` prints 0 against "
    "a fresh mirror clone of the pushed repository\n\n"
    "## Files claimed\n\n- bin/scrub-corpus-history.py\n"
)

TICKET_BODY_FEATURE_TEST_ONLY = (
    "## What to build\n\nA `--json` flag on `bin/lint` that prints its findings as JSON.\n\n"
    "## Acceptance criteria\n\n"
    "- [ ] `npm test -- lint-json.test.ts` exits 0\n\n"
    "## Files claimed\n\n- bin/lint\n"
)


def test_migration_without_post_state():
    print("ticket_shape.validate: a migration ticket must assert the post-state (#144, claude-workflow/ADR-0076)")

    def warned(label, body, expected):
        got = ticket_shape.migration_without_post_state(body)
        check(label, bool(got) == expected, f"{got!r}")

    warned("a migration whose every criterion is a test warns",
           TICKET_BODY_MIGRATION_TEST_ONLY, True)
    warned("a migration whose only evidence is a path it claims warns",
           TICKET_BODY_MIGRATION_CLAIMED_PATH_ONLY, True)
    warned("a migration asserting the post-state of the real target warns nothing",
           TICKET_BODY_MIGRATION_POST_STATE, False)
    warned("an ordinary feature ticket with test-only criteria warns nothing",
           TICKET_BODY_FEATURE_TEST_ONLY, False)

    body = TICKET_BODY_MIGRATION_CLAIMED_PATH_ONLY.replace(
        "bin/rewrite-session-notes.py", "bin/ticket_shape.py"
    )
    warnings = ticket_shape.validate("ticket", body, repo_root=REPO)
    check("validate('ticket', ...) surfaces the warning", len(warnings) == 1, warnings)
    check("filing is not refused, only warned",
          warnings and "migration ticket closes on the migration having run" in warnings[0],
          warnings)


TICKET_BODY_CHECK_MARKER = (
    "## Acceptance criteria\n\n"
    "- [ ] `bin/lint` reports zero findings on this file - check: `bin/lint path/to/file`\n\n"
    "## Files claimed\n\n- None, no files.\n"
)


def test_check_marker_criterion_counts_as_one():
    print("count_body_criteria: a criterion carrying a check: marker still counts as exactly "
          "one (#161)")

    n = count_body_criteria(TICKET_BODY_CHECK_MARKER)
    check("a criterion carrying a check: marker counts as exactly one criterion", n == 1, n)

    blocks = ticket_shape.criteria_blocks(TICKET_BODY_CHECK_MARKER)
    check("criteria_blocks folds the marked criterion into exactly one block",
          blocks is not None and len(blocks) == 1, blocks)

    parsed = ticket_shape.parse_check_marker(blocks[0]) if blocks else None
    check("parse_check_marker extracts the command from the marked criterion",
          parsed == "bin/lint path/to/file", parsed)

    warnings = ticket_shape.validate("ticket", TICKET_BODY_CHECK_MARKER, repo_root=REPO)
    check("a well-formed marker draws no malformed-marker warning",
          not any("check:" in w and "marker" in w for w in warnings), warnings)


def main():
    print("test_ticket_templates: docs/agents/ticket-format.md's variants through count_body_criteria")

    check("ticket-format.md exists", TICKET_FORMAT_DOC.is_file(),
          f"expected {TICKET_FORMAT_DOC}")
    if not TICKET_FORMAT_DOC.is_file():
        finish()

    if TICKET_FORMAT_SEED.parent.is_dir():
        check("setup-matt-pocock-skills/ticket-format.md exists", TICKET_FORMAT_SEED.is_file(),
              f"expected {TICKET_FORMAT_SEED}, the setup seed mirroring the canonical doc (#52)")
    if TICKET_FORMAT_SEED.is_file():
        canonical_bytes = TICKET_FORMAT_DOC.read_bytes()
        seed_bytes = TICKET_FORMAT_SEED.read_bytes()
        check("setup-matt-pocock-skills/ticket-format.md is byte-identical to docs/agents/ticket-format.md",
              seed_bytes == canonical_bytes,
              "the seed drifted from the canonical doc; copy docs/agents/ticket-format.md over it verbatim")

    cases = list(variant_cases())
    check("at least one variant discovered under '## Variants'", len(cases) > 0,
          "no '### ...' heading found; anchor drifted?")

    def variant_kind(label):
        for prefix, kind in VARIANT_KIND:
            if label.startswith(prefix):
                return kind
        return None

    for label, body in cases:
        check(f"{label}: fenced example extracted", body is not None,
              "no ```markdown block found under this heading")
        if body is None:
            continue
        if label.startswith("Question (file-issue question"):
            check(f"{label}: exempt from the criterion-count check (fuzzy, no criteria yet)",
                  True)
        else:
            n = count_body_criteria(body)
            check(f"{label}: parser counts >= 1 criterion", n is not None and n >= 1,
                  f"count_body_criteria returned {n!r} "
                  f"({'no heading' if n is None else 'heading but no - [ ] items'})")

        kind = variant_kind(label)
        if kind is None:
            check(f"{label}: mapped in VARIANT_KIND (accepted as None, not a file-issue shape)",
                  any(label.startswith(prefix) for prefix, _ in VARIANT_KIND),
                  f"{label!r} not found in VARIANT_KIND; add a row (a kind, or None with why)")
            continue
        try:
            ticket_shape.validate(kind, body)
            check(f"{label}: passes ticket_shape.validate({kind!r}, ...)", True)
        except ticket_shape.ValidationError as e:
            check(f"{label}: passes ticket_shape.validate({kind!r}, ...)", False, str(e))

        if label.startswith("Question (file-issue question"):
            check(f"{label}: fenced example carries the file-issue ticketify exit line",
                  "file-issue ticketify" in body, body)

    test_unresolved_claimed_paths()
    test_claims_resolve_against_the_callers_repo()
    test_migration_without_post_state()
    test_check_marker_criterion_counts_as_one()

    finish("all template cases pass")


if __name__ == "__main__":
    main()
