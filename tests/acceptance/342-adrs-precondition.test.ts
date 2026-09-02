import path from "node:path";
import { describe, expect, it } from "vitest";
import { presence, readIfPresent } from "./327-enrol.fixture";
import { repoRoot } from "./workflow-shape.fixture";

/**
 * #342's fourth criterion: the `adrs` check stops gating on whether `~/bin/adr-check` happens to
 * exist — which is the workstation and never a runner — and gates instead on a precondition the
 * target opted into, so a target that never adopted this repository's ADR shape is not judged by
 * it and a dry run against one reaches the checks behind it.
 *
 * The criterion's own check is a `grep` over `bin/gauntlet`, so this reads the same file and
 * asserts the same absence. Two moves rather than one: the file has to be *there* (an absent
 * `bin/gauntlet` would make a bare `not.toContain` pass for the wrong reason, which is the vacuous
 * green this directory exists to avoid), and the presence gate has to be gone from it.
 *
 * What is deliberately *not* asserted is which precondition replaces it. The ticket says "the way
 * `corpus` and `clones` already do" without fixing a spelling, and pinning one down would be a
 * demand the implementer cannot read out of the same sentence.
 *
 * The regex is the criterion's literal grep with its whitespace loosened, so a cosmetic reformat of
 * the same gate — which would defeat a byte-exact `grep` while leaving the behaviour untouched —
 * is still caught.
 */

const RELATIVE = "bin/gauntlet";
const GAUNTLET = path.join(repoRoot, "bin", "gauntlet");

/** The presence gate, exactly as the criterion's own `grep` spells it. */
const PRESENCE_GATE = 'adr-check" ] || exit 0';

describe("#342 the adrs check gates on an opted-into precondition", () => {
  // `bin/gauntlet`'s `adrs` check gates on a precondition the target opted into rather than on
  it("`~/bin/adr-check` being present, so a dry run reaches the checks behind it", () => {
    expect(presence(RELATIVE, GAUNTLET)).toBe("present");

    const text = readIfPresent(GAUNTLET);

    expect(text.includes(PRESENCE_GATE)).toBe(false);

    const gates = text
      .split("\n")
      .map((line, index) => ({ line: line.trim(), number: index + 1 }))
      .filter((entry) => /adr-check/.test(entry.line) && /\|\|\s*exit\s+0/.test(entry.line))
      .map((entry) => `${String(entry.number)}: ${entry.line}`);

    expect(gates).toEqual([]);
  });
});
