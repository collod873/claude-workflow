import { describe, expect, it } from "vitest";
import { createFakeStage, createFakeStages } from "../shared/stage.fake";
import { runSpecReconciler } from "./reconcile";
import { specFormat } from "./spec-format";
import { runSpecAuthor, type DecidedContext } from "./spec";

const CONTEXT: DecidedContext = {
  ownerWords: "the owner's words",
  decisions: "a decision, with its reason",
  rulings: "ADR-0060",
  boundaries: "a boundary",
  openGuesses: "none yet",
};

const SWEEP = JSON.stringify({ rulings: [] });
const DRAFT = JSON.stringify({ title: "A spec", body: "The whole statement of the work.", openQuestions: [] });
const SILENT_CRITIC = JSON.stringify({ resolutions: [] });

const RECONCILE_INPUT = {
  title: "PRD: A spec written in a session",
  body: "## Problem\nIt stalls.\n\n## Acceptance criteria\n- [ ] The re-export is deleted.",
  resolutions: [{ decision: "Delete the re-export.", reason: "The restatement rules out a shim." }],
};

const RECONCILED = JSON.stringify({
  body: "## Problem\nIt stalls.\n\n## Acceptance criteria\n- [ ] The re-export is deleted — check: `make gate`",
});

describe("specFormat() reads docs/agents/spec-format.md's lane variant", () => {
  it("carries the core contract and the lane variant, and no variant this lane never produces", () => {
    const format = specFormat();

    expect(format).toContain("## Acceptance criteria");
    expect(format).toContain("### Lane spec");
    expect(format).toContain("exactly one");
    expect(format).toContain("check:");
    expect(format).toContain("## Assumptions");
    expect(format).not.toContain("### Session spec");
  });
});

describe("both of lane 02's body-writing stages take the spec contract by injection", () => {
  it("hands the author the contract itself, with no placeholder left unrendered", async () => {
    const fake = createFakeStages([SWEEP, DRAFT, SILENT_CRITIC]);

    await runSpecAuthor(fake.exec, CONTEXT);

    const prompt = fake.stdins[1];
    expect(prompt).toContain(specFormat());
    expect(prompt).not.toContain("{{");
  });

  it("hands the reconciler the same contract, with no placeholder left unrendered", async () => {
    const fake = createFakeStage(RECONCILED);

    await runSpecReconciler(fake.exec, RECONCILE_INPUT);

    const prompt = fake.stdins[0];
    expect(prompt).toContain(specFormat());
    expect(prompt).not.toContain("{{");
  });
});
