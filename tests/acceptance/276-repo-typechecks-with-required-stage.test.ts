import { describe, expect, it } from "vitest";
import {
  combinedOutput,
  failureReport,
  runFromRoot,
  typecheckCallSite,
} from "./276-required-stage.fixture";

/**
 * #276, criterion 1, verbatim:
 *
 * - [ ] The whole repo still typechecks once every call site is required to name its stage — check: `npx tsc --noEmit`
 *
 * Two halves, and both are load-bearing. `npx tsc --noEmit` on its own is green today, before the
 * `?` comes off `StageOptions.stage` — it would be green with the field absent entirely, so run
 * alone it says nothing about this ticket. The condition the criterion attaches to it is the other
 * half: *once every call site is required to name its stage*. That is asked of the compiler the
 * only way a caller can ask it — a generated call site that omits `stage` has to be refused, and
 * one that supplies it has to compile — and the repo-wide check then says the real call sites all
 * satisfy it.
 */
describe("#276 — the repo typechecks with a required stage", () => {
  it("typechecks the whole repo, and refuses a runStage call site that names no stage", () => {
    const repo = runFromRoot("npx", ["tsc", "--noEmit"], 900_000);
    expect(failureReport("npx tsc --noEmit", repo)).toBe("");

    // A call site that names its stage is the shape every real one now has.
    const named = typecheckCallSite('{ stage: "probe" }');
    expect(
      failureReport("tsc over a call site naming its stage", named),
    ).toBe("");

    // And one that fills in every other StageOptions field but not `stage` is a type error: that is
    // what "required to name its stage" means to a caller, and what the dropped `?` buys.
    const unnamed = typecheckCallSite("{ promptViaStdin: true }");
    expect(unnamed.status).not.toBe(0);
    expect(combinedOutput(unnamed)).toMatch(/stage/);
  }, 1_800_000);
});
