import { describe, expect, it } from "vitest";
import { CHECK_MARKER_DELIM, parseCheckMarker } from "./ticket-shape";
import { pythonCheckMarkerDelim, pythonParseCheckMarker } from "./ticket-shape.fixture";

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
