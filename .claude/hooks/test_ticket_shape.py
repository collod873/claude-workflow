#!/usr/bin/env python3
import importlib.util
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

import _harness
from _harness import check, finish

HOOKS = Path(__file__).resolve().parent
REPO = next((c for c in (HOOKS.parent, HOOKS.parent.parent) if (c / "bin").is_dir()), HOOKS.parent)
BIN = REPO / "bin"

_spec = importlib.util.spec_from_file_location("ticket_shape", BIN / "ticket_shape.py")
ticket_shape = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(ticket_shape)


TICKET_BODY_CLAIMS_CI = (
    "## Acceptance criteria\n\n- [ ] the lane runs green - check: `true`\n\n"
    "## Files claimed\n\n- .github/workflows/ci.yml\n"
)

TICKET_BODY_CLAIMS_VITEST_CONFIG = (
    "## Acceptance criteria\n\n- [ ] the suite runs - check: `true`\n\n"
    "## Files claimed\n\n- vitest.config.ts\n"
)

TICKET_BODY_CLAIMS_MIXED = (
    "## Acceptance criteria\n\n- [ ] it works - check: `true`\n\n"
    "## Files claimed\n\n- src/thing.ts\n- .github/workflows/ci.yml\n"
)

TICKET_BODY_CLAIMS_NONE_IMMUTABLE = (
    "## Acceptance criteria\n\n- [ ] it works - check: `true`\n\n"
    "## Files claimed\n\n- bin/ticket_shape.py\n"
)


def refusal(call) -> str | None:
    try:
        call()
    except ticket_shape.ValidationError as e:
        return str(e)
    return None


def test_immutable_set_pinned_to_shared_json():
    print("the Python and TypeScript sides agree on the immutable set")

    shared = json.loads(ticket_shape.IMMUTABLE_SET_PATH.read_text())
    check("shared JSON is a non-empty list", isinstance(shared, list) and len(shared) > 0, shared)
    check("Python's IMMUTABLE_SET is read from that same JSON",
          list(ticket_shape.IMMUTABLE_SET) == shared, (ticket_shape.IMMUTABLE_SET, shared))


def test_touches_immutable_set():
    print("touches_immutable_set: entry and prefix matching")

    check("flags vitest.config.ts itself",
          ticket_shape.touches_immutable_set(["vitest.config.ts"]) == ["vitest.config.ts"])
    check("flags a path under .github/",
          ticket_shape.touches_immutable_set([".github/workflows/verify.yml"])
          == [".github/workflows/verify.yml"])
    check("does not flag a path outside the set",
          ticket_shape.touches_immutable_set(["src/thing.ts"]) == [])
    check("does not flag an empty list", ticket_shape.touches_immutable_set([]) == [])


def test_validate_ticket_admits_immutable_claim_for_by_hand():
    print("validate('ticket', ...) admits a '## Files claimed' path in the immutable set, "
          "which classify_venue routes to by-hand")

    for name, body, path in (
        ("a .github/ claim", TICKET_BODY_CLAIMS_CI, ".github/workflows/ci.yml"),
        ("a vitest.config.ts claim", TICKET_BODY_CLAIMS_VITEST_CONFIG, "vitest.config.ts"),
        ("a mixed claim", TICKET_BODY_CLAIMS_MIXED, ".github/workflows/ci.yml"),
    ):
        msg = refusal(lambda: ticket_shape.validate("ticket", body))
        check(f"{name} is not refused", msg is None, msg)
        claimed = ticket_shape.claimed_paths(body)
        check(f"{name} classifies as immutable-set",
              ticket_shape.classify_venue(claimed) == "immutable-set" and path in claimed, claimed)

    warnings = ticket_shape.validate("ticket", TICKET_BODY_CLAIMS_NONE_IMMUTABLE, repo_root=REPO)
    check("a claim outside the immutable set validates with no warning", warnings == [], warnings)


def test_classify_venue_workstation_paths():
    print("classify_venue: a home-dir or .claude/ settings path is workstation, "
          "independent of immutable-set")

    home_dir = "~/.claude/settings.json"
    claude_settings = ".claude/settings.json"
    ordinary = "src/router.ts"

    check("home-dir path classifies as workstation",
          ticket_shape.classify_venue([home_dir]) == "workstation")
    check("home-dir path is not in the immutable set",
          ticket_shape.touches_immutable_set([home_dir]) == [])
    check(".claude/ settings path classifies as workstation",
          ticket_shape.classify_venue([claude_settings]) == "workstation")
    check("an ordinary path does not classify as workstation",
          ticket_shape.classify_venue([ordinary]) != "workstation")
    check("an immutable-set path classifies, but not as workstation",
          ticket_shape.classify_venue(["vitest.config.ts"]) == "immutable-set")
    check("a path outside both sets classifies as nothing",
          ticket_shape.classify_venue([ordinary]) is None)


def test_repo_slug_from_url():
    print("repo_slug_from_url: every spelling of an origin URL reduces to owner/name")

    check("https with .git",
          ticket_shape.repo_slug_from_url("https://github.com/collod873/claude-workflow.git")
          == "collod873/claude-workflow")
    check("https without .git",
          ticket_shape.repo_slug_from_url("https://github.com/collod873/claude-workflow")
          == "collod873/claude-workflow")
    check("https with a trailing slash",
          ticket_shape.repo_slug_from_url("https://github.com/collod873/claude-workflow/")
          == "collod873/claude-workflow")
    check("ssh scp form",
          ticket_shape.repo_slug_from_url("git@github.com:collod873/claude-workflow.git")
          == "collod873/claude-workflow")
    check("ssh url form",
          ticket_shape.repo_slug_from_url("ssh://git@github.com/collod873/claude-workflow.git")
          == "collod873/claude-workflow")
    check("a url naming a host and nothing else reduces to nothing",
          ticket_shape.repo_slug_from_url("https://github.com/") is None)
    check("an empty url reduces to nothing",
          ticket_shape.repo_slug_from_url("") is None)


def test_current_repo_slug_reads_origin():
    print("current_repo_slug: the origin of the checkout the caller stands in, or None")

    with tempfile.TemporaryDirectory() as d:
        root = Path(d)
        subprocess.run(["git", "init", "-q", str(root)], check=True)
        check("a checkout with no origin has no slug",
              ticket_shape.current_repo_slug(root) is None)
        subprocess.run(["git", "-C", str(root), "remote", "add", "origin",
                        "git@github.com:acme/widgets.git"], check=True)
        check("origin names the slug",
              ticket_shape.current_repo_slug(root) == "acme/widgets")

    with tempfile.TemporaryDirectory() as d:
        check("a directory that is no checkout has no slug",
              ticket_shape.current_repo_slug(Path(d)) is None)


def test_check_marker_word_resolution():
    print("validate('ticket', ...): a check: marker's first word must resolve on PATH or as "
          "an executable file")

    with tempfile.TemporaryDirectory(prefix="ticket-shape-home-") as home:
        bin_dir = Path(home) / "bin"
        bin_dir.mkdir()
        hook_report = bin_dir / "hook-report"
        hook_report.write_text("#!/bin/sh\n")
        hook_report.chmod(0o755)

        old_home = os.environ.get("HOME")
        os.environ["HOME"] = home
        try:
            path_form_body = (
                "## Acceptance criteria\n\n"
                "- [ ] `hook-report` posts a summary - check: `~/bin/hook-report --flag`\n\n"
                "## Files claimed\n\n- None, no files.\n"
            )
            warnings = ticket_shape.validate("ticket", path_form_body, repo_root=REPO)
            check("a check: marker naming an executable ~/-path is accepted, no warning",
                  warnings == [], warnings)
        finally:
            if old_home is None:
                del os.environ["HOME"]
            else:
                os.environ["HOME"] = old_home

    unresolved_word_body = (
        "## Acceptance criteria\n\n"
        "- [ ] the suite passes - check: `no-such-runner-9f3a tests/`\n\n"
        "## Files claimed\n\n- None, no files.\n"
    )
    warnings = ticket_shape.validate("ticket", unresolved_word_body, repo_root=REPO)
    check("a check: marker whose first word doesn't resolve on PATH is refused, naming the word",
          len(warnings) == 1 and "no-such-runner-9f3a" in warnings[0], warnings)


def test_validate_ticket_claim_ceiling():
    print("validate('ticket', ...) refuses a claim wider than the acceptance author can hold "
          "in one prompt")

    def claiming(count):
        files = "".join(f"- src/m{i}.ts\n" for i in range(count))
        return ("## Acceptance criteria\n\n- [ ] it works - check: `true`\n\n"
                f"## Files claimed\n\n{files}")

    at_ceiling = refusal(lambda: ticket_shape.validate(
        "ticket", claiming(ticket_shape.CLAIM_LIMIT), repo_root=REPO))
    check(f"a claim of exactly {ticket_shape.CLAIM_LIMIT} files is admitted",
          at_ceiling is None, at_ceiling)

    over = refusal(lambda: ticket_shape.validate(
        "ticket", claiming(ticket_shape.CLAIM_LIMIT + 1), repo_root=REPO))
    check("one file past the ceiling is refused, naming the stage the width would starve",
          over is not None and "author-repair" in over, over)


def main():
    with tempfile.TemporaryDirectory(prefix="ticket-shape-test-"):
        test_immutable_set_pinned_to_shared_json()
        print()
        test_touches_immutable_set()
        print()
        test_validate_ticket_admits_immutable_claim_for_by_hand()
        print()
        test_classify_venue_workstation_paths()
        print()
        test_repo_slug_from_url()
        print()
        test_current_repo_slug_reads_origin()
        print()
        test_check_marker_word_resolution()
        print()
        test_validate_ticket_claim_ceiling()

    finish("All ticket_shape checks passed.")


if __name__ == "__main__":
    main()
