import { describe, expect, it } from "vitest";
import {
  declaresRequiredStage,
  failureReport,
  runFromRoot,
  stageOptionsMembers,
} from "./276-required-stage.fixture";

/**
 * #276, criterion 3, verbatim:
 *
 * - [ ] The full suite still passes — check: `npx vitest run .Workflow .claude`
 *
 * *Still* is the word that has to be honoured. The suite is green today, with `stage` optional or
 * absent, so a run of it on its own asserts nothing about this ticket — it would report the same
 * thing before and after. What the criterion claims is that the suite is green **with the change
 * in it**: every stage's own tests, and the hook tests under `.claude`, survive `stage` becoming a
 * field no caller may omit. So the state of the declaration is established first, and the suite is
 * then run against it.
 */
describe("#276 — the full suite with stage required", () => {
  it("is green with stage a required field on StageOptions", () => {
    // The change this criterion says the suite still passes *with*. Read from the file rather than
    // assumed, so a green suite over an unchanged repo cannot be mistaken for evidence.
    expect(stageOptionsMembers() ?? "").toMatch(/^\s*(?:readonly\s+)?stage\s*:\s*string\s*;/m);
    expect(declaresRequiredStage()).toBe(true);

    const suite = runFromRoot("npx", ["vitest", "run", ".Workflow", ".claude"], 2_400_000);
    expect(failureReport("npx vitest run .Workflow .claude", suite)).toBe("");
  }, 2_700_000);
});
