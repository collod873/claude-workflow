import { existsSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  SHARED_DIR,
  TIMING_BASELINE_JSON,
  TIMING_BASELINE_JSON_RELATIVE,
} from "./357-timing.fixture";

/**
 * #357, criterion 1 — the artefact that made a number measured in one place refuse a push in
 * another is deleted outright.
 *
 * Read off disk rather than out of git: a CI checkout's working tree *is* the branch under test, so
 * a file that is absent from disk is absent from the tree, and asking `git ls-files` instead would
 * make the criterion turn on whether the deletion had been staged yet.
 *
 * The directory is walked as well as the path, so a baseline that was moved rather than deleted is
 * still found. The gitignored local half — `timing-baseline.local.json`, this workstation measuring
 * itself — is deliberately not matched: the ticket keeps it, and it is the stop venue's input.
 */

/** Everything sitting in `shared/`, or nothing when the directory is not there. */
function sharedEntries(): string[] {
  try {
    return readdirSync(SHARED_DIR).sort();
  } catch {
    return [];
  }
}

describe("#357 the committed timing baseline", () => {
  // The committed baseline is gone from the tree, so no venue can be judged against a number
  it("is gone from the tree, so no venue can be judged against a number", () => {
    expect(
      existsSync(TIMING_BASELINE_JSON),
      `${TIMING_BASELINE_JSON_RELATIVE} is still in the tree, so a venue can still be judged ` +
        "against a number measured somewhere else",
    ).toBe(false);

    const strays = sharedEntries().filter((name) => name === "timing-baseline.json");
    expect(strays, "a committed timing baseline is still sitting in shared/").toEqual([]);
  });
});
