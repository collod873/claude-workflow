import { describe, expect, it } from "vitest";
import { CHECK_MARKER_DELIM, parseCheckMarker } from "./ticket-shape";
import { pythonCheckMarkerDelim, pythonParseCheckMarker } from "./ticket-shape.fixture";

/**
 * §3 of #226: the ticket contract is written down twice in code — `bin/ticket_shape.py`, which
 * `bin/close-ticket` reads a ticket with, and `shared/ticket-shape.ts`, which lane 03 renders one
 * with — and the two are held together by one constant, `CHECK_MARKER_DELIM`. This file reads the
 * Python's live off the module, in the real interpreter, and compares it against the TypeScript's
 * imported constant; a copy of either here would be exactly the drift it exists to catch.
 *
 * `render-body.proc.test.ts` drives the rendered body through the Python reader; this file holds
 * the constant itself, and the parse of the criterion shapes the two sides most disagree over.
 */

describe("bin/ticket_shape.py and shared/ticket-shape.ts agree on the check-marker delimiter", () => {
  it("hold the exact same CHECK_MARKER_DELIM alternation", () => {
    expect(CHECK_MARKER_DELIM).toBe(pythonCheckMarkerDelim());
  });
});

describe("the two parse_check_marker implementations read the same command, or the same nothing", () => {
  it.each([
    ["the canonical em-dash form", "The thing is wired — check: `make test`"],
    ["a hyphen delimiter", "The thing is wired - check: `make test`"],
    ["a command carrying its own quotes", "It greps — check: `grep -q 'export function x' shared/x.ts`"],
    ["an unquoted command", "It works — check: make test"],
    ["prose after the command", "It works — check: `make test` in the checkout"],
    ["no marker at all", "It works."],
  ])("%s", (_label, criterion) => {
    expect(parseCheckMarker(criterion) ?? null).toBe(pythonParseCheckMarker(criterion));
  });
});
