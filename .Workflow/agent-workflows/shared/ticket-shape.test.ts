import { describe, expect, it } from "vitest";
import { countCriteria, extractCriteria, isRunnableSpec, parseCheckMarker, parentPrdNumber } from "./ticket-shape";

/**
 * The grammar `shared/ticket-shape.ts` reads a ticket body with, on bodies written here. What the
 * grammar has to agree with — `bin/ticket_shape.py`, the reader `bin/close-ticket` actually uses
 * — is held in `ticket-shape.proc.test.ts`, which drives both against the same bodies.
 */

const heading = "## Acceptance criteria";

describe("isRunnableSpec", () => {
  it("accepts a body with exactly one well-formed check-marked criterion", () => {
    const body = [
      heading,
      "",
      "- [ ] I'll know it works when I can see a verdict on the spec — check: `true`",
      "",
    ].join("\n");

    expect(isRunnableSpec(body)).toBe(true);
  });

  it("rejects a body with no '## Acceptance criteria' heading at all", () => {
    const body = ["## Problem Statement", "Nothing here declares criteria.", ""].join("\n");

    expect(isRunnableSpec(body)).toBe(false);
  });

  it("rejects the heading present with zero '- [ ]' items under it", () => {
    const body = [heading, "", "Some prose and no checkbox at all.", ""].join("\n");

    expect(isRunnableSpec(body)).toBe(false);
  });

  it("rejects two well-formed check-marked criteria — a spec's check runs on exactly one", () => {
    const body = [
      heading,
      "",
      "- [ ] The first thing — check: `true`",
      "- [ ] And the second — check: `true`",
      "",
    ].join("\n");

    expect(isRunnableSpec(body)).toBe(false);
  });

  it("rejects one criterion whose check: marker names no backtick-quoted command", () => {
    const body = [heading, "", "- [ ] I'll know it works — check: true", ""].join("\n");

    expect(isRunnableSpec(body)).toBe(false);
  });

  it("rejects one criterion whose check: marker carries prose after the backticked command", () => {
    const body = [
      heading,
      "",
      "- [ ] I'll know it works — check: `true` and then look at it",
      "",
    ].join("\n");

    expect(isRunnableSpec(body)).toBe(false);
  });

  it("rejects a criterion with no check: marker attempt at all", () => {
    const body = [heading, "", "- [ ] Plain prose, no marker.", ""].join("\n");

    expect(isRunnableSpec(body)).toBe(false);
  });
});

describe("ticket-shape's existing grammar primitives, exercised so this file is a real suite", () => {
  it("countCriteria counts '- [ ]' items and is null when the heading is absent", () => {
    expect(countCriteria([heading, "", "- [ ] one", "- [x] two"].join("\n"))).toBe(2);
    expect(countCriteria("no heading here")).toBeNull();
  });

  it("extractCriteria strips the checkbox and returns the rest verbatim", () => {
    expect(extractCriteria([heading, "", "- [ ] do the thing — check: `true`"].join("\n"))).toEqual([
      "do the thing — check: `true`",
    ]);
  });

  it("parseCheckMarker answers undefined for prose and for a malformed marker alike", () => {
    expect(parseCheckMarker("do the thing")).toBeUndefined();
    expect(parseCheckMarker("do the thing — check: nope")).toBeUndefined();
    expect(parseCheckMarker("do the thing — check: `make test`")).toBe("make test");
  });

  it("parentPrdNumber reads the heading render-body.ts writes on every slice", () => {
    expect(parentPrdNumber(["## Parent PRD", "#145", ""].join("\n"))).toBe(145);
    expect(parentPrdNumber("no parent here")).toBeUndefined();
  });
});
