import path from "node:path";
import { describe, expect, it } from "vitest";
import { presence, readIfPresent } from "./327-enrol.fixture";
import { repoRoot } from "./workflow-shape.fixture";

/**
 * #342's third criterion: this repository's own committed baseline carries a non-empty push venue
 * once the ticket's implement run has been through lane 05.
 *
 * This one is about an artifact rather than about a code path, so it is read as an artifact — the
 * committed JSON, parsed, with `venues.push` counted the way the criterion's own check counts it
 * (`Object.keys(...venues.push||{}).length`). The file is not in the immutable set, so reading it
 * is a reading of the thing the ticket changes rather than of something no pull request may touch.
 *
 * Nothing here imports the baseline as a module: a `resolveJsonModule` import is still a specifier
 * the branch under test controls, and this directory is the sealed part.
 *
 * Red today, because `"venues": {}` on `main` has no `push` key at all — 137 suite files measured,
 * zero venue entries.
 */

/** The committed baseline, spelled the way the criterion's own check spells it. */
const RELATIVE = ".Workflow/agent-workflows/shared/timing-baseline.json";

const BASELINE = path.join(
  repoRoot,
  ".Workflow",
  "agent-workflows",
  "shared",
  "timing-baseline.json",
);

/** Only the half this criterion is about; everything else the file carries is left unnamed. */
interface Baseline {
  venues?: { push?: Record<string, unknown> };
}

/** The baseline parsed, or `null` when it is absent or is not JSON — a red assertion, not a throw. */
function parseBaseline(text: string): Baseline | null {
  try {
    return JSON.parse(text) as Baseline;
  } catch {
    return null;
  }
}

describe("#342 the committed baseline carries a push venue", () => {
  // After this ticket's own implement run, this repository's committed baseline carries a
  it("non-empty push venue", () => {
    expect(presence(RELATIVE, BASELINE)).toBe("present");

    const parsed = parseBaseline(readIfPresent(BASELINE));
    expect(parsed === null ? `${RELATIVE} is not readable JSON` : "").toBe("");

    const push = parsed?.venues?.push ?? {};
    const checks = Object.keys(push);
    const report =
      checks.length > 0
        ? ""
        : `${RELATIVE} has no push venue: venues.push is ${JSON.stringify(
            parsed?.venues?.push ?? null,
          )}`;

    expect(report).toBe("");
    expect(checks.length).toBeGreaterThan(0);
  });
});
