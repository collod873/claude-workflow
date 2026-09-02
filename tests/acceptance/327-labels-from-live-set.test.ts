import { describe, expect, it } from "vitest";
import {
  ENROL_SOURCE,
  ENROL_SOURCE_RELATIVE,
  laneCode,
  laneFiles,
  presence,
} from "./327-enrol.fixture";

/**
 * The pipeline label names criterion 1's own check greps for, spelled exactly as it spells them.
 *
 * A lane that reads this repository's live label set has no reason to carry any of them: the
 * vocabulary in `docs/agents/pipeline-labels.md` is prose about labels that already exist here, and
 * a second copy in code is the manifest with a shebang ADR-0057 rejected.
 */
const PIPELINE_LABELS = ["fuzzy", "needs-human", "prd", "ticket", "sliceable", "running", "spec/gap"];

/** The check's own pattern: the name as a quoted literal, which is what a manifest looks like. */
const QUOTED_LABEL = new RegExp('"(' + PIPELINE_LABELS.join("|") + ')"');

describe("#327 — the label set an enrolled repository receives", () => {
  // The label set written to a target is read from this repository's live labels, not from any
  it("names no pipeline label in the lane, because the lane reads them live", () => {
    expect(presence(ENROL_SOURCE_RELATIVE, ENROL_SOURCE)).toBe("present");

    // `*.test.ts` and `*.md` are left out: a suite proving the reconciliation has to name labels to
    // build a target with, and prose about labels is what the criterion says a file may hold.
    const literals = laneFiles()
      .filter((file) => !file.relative.endsWith(".test.ts") && !file.relative.endsWith(".md"))
      .flatMap((file) =>
        file.text
          .split("\n")
          .map((line, index) => ({ line: line.trim(), at: index + 1 }))
          .filter((entry) => QUOTED_LABEL.test(entry.line))
          .map((entry) => `${file.relative}:${entry.at}: ${entry.line}`),
      );

    expect(literals).toEqual([]);

    // ...and the lane does write labels at all: a file carrying no label code satisfies the absence
    // above for the wrong reason.
    expect(laneCode()).toMatch(/label/i);
  });
});
