import { describe, expect, it } from "vitest";
import {
  STAGE_SOURCE_RELATIVE,
  declaresRequiredStage,
  failureReport,
  runFromRoot,
  stageOptionsBlock,
  stageOptionsMembers,
} from "./276-required-stage.fixture";

/**
 * #276, criterion 2, verbatim:
 *
 * - [ ] stage is declared non-optional on StageOptions — check: `grep -q 'stage: string;' .Workflow/agent-workflows/shared/stage.ts`
 *
 * The criterion's own check is run as it is written — a literal `grep -q` over the claimed file
 * from the checkout root. It is then held to what the sentence in front of the check says, which
 * the `grep` alone cannot tell you: that the match is a member of `StageOptions` rather than a
 * `stage: string;` somewhere else in the file, and that no `stage?:` is left standing beside it.
 */
describe("#276 — StageOptions.stage", () => {
  it("declares stage as a required string on StageOptions, with no `?` left on it", () => {
    const grep = runFromRoot(
      "grep",
      ["-q", "stage: string;", STAGE_SOURCE_RELATIVE],
      60_000,
    );
    expect(failureReport(`grep -q 'stage: string;' ${STAGE_SOURCE_RELATIVE}`, grep)).toBe("");

    const block = stageOptionsBlock();
    expect(block).not.toBeNull();

    // The declaration itself, read past the docstrings every field on this interface carries.
    const members = stageOptionsMembers() ?? "";
    expect(members).toMatch(/^\s*(?:readonly\s+)?stage\s*:\s*string\s*;/m);
    expect(members).not.toMatch(/^\s*(?:readonly\s+)?stage\s*\?\s*:/m);

    expect(declaresRequiredStage()).toBe(true);
  }, 120_000);
});
