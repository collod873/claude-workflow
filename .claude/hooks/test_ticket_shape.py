#!/usr/bin/env python3
import importlib.util
import json
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


def test_validate_ticket_refuses_immutable_claim():
    print("validate('ticket', ...) refuses a '## Files claimed' path in the immutable set")

    msg = refusal(lambda: ticket_shape.validate("ticket", TICKET_BODY_CLAIMS_CI))
    check("refuses (raises ValidationError, not a warning)", msg is not None, msg)
    check("refusal names the offending path", msg is not None and ".github/workflows/ci.yml" in msg, msg)

    msg = refusal(lambda: ticket_shape.validate("ticket", TICKET_BODY_CLAIMS_VITEST_CONFIG))
    check("refuses a claim naming vitest.config.ts",
          msg is not None and "vitest.config.ts" in msg, msg)

    msg = refusal(lambda: ticket_shape.validate("ticket", TICKET_BODY_CLAIMS_MIXED))
    check("refuses when only one of several claimed paths is immutable",
          msg is not None and ".github/workflows/ci.yml" in msg, msg)

    warnings = ticket_shape.validate("ticket", TICKET_BODY_CLAIMS_NONE_IMMUTABLE, repo_root=REPO)
    check("a claim outside the immutable set is not refused on that account",
          warnings == [], warnings)


def main():
    with tempfile.TemporaryDirectory(prefix="ticket-shape-test-"):
        test_immutable_set_pinned_to_shared_json()
        print()
        test_touches_immutable_set()
        print()
        test_validate_ticket_refuses_immutable_claim()

    finish("All ticket_shape checks passed.")


if __name__ == "__main__":
    main()
