import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SPEC_RECONCILE_SOURCE } from "./262-critic-pen.fixture";

/**
 * The criterion this file is the acceptance test for, verbatim:
 *
 * - [ ] The checkbox count reuses the existing criteria counter, not a second regex — check: `grep -q 'ticket-shape' .Workflow/agent-workflows/spec/reconcile.ts`
 *
 * A rule about which module owns a piece of arithmetic is stated in the source or nowhere, so this
 * one is read off the file — the criterion's own check is a `grep`. Two implementations of "what
 * counts as a criterion" is how the count that guards the pen comes to disagree with the count lane
 * 04 slices on, and neither would look different from the outside.
 */

describe("#262 — one counter, not two", () => {
  it("The checkbox count reuses the existing criteria counter, not a second regex", () => {
    const source = readFileSync(SPEC_RECONCILE_SOURCE, "utf8");

    // The criterion's own check, run as the criterion runs it.
    expect(source).toContain("ticket-shape");

    // And named where it means something: an import specifier, not a mention in a comment.
    expect(source).toMatch(/from\s+["'][^"']*ticket-shape[^"']*["']/);
    expect(source).toContain("countCriteria");

    // "Not a second regex": no checkbox pattern of its own, in the code rather than the prose —
    // a docstring is free to spell `- [ ]` out while explaining what the shared counter counts.
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .map((line) => line.replace(/\/\/.*$/, ""))
      .join("\n");
    expect(
      /\/[^\n/]*\\\[[^\n/]*\//.test(code),
      "reconcile.ts carries a bracket-matching regex of its own",
    ).toBe(false);
  });
});
