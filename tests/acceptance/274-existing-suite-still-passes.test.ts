import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { absolute, commandLine, LANE_STAGE_NAMES_TEST, runVitest } from "./274-stage-names.fixture";

/**
 * #274's second criterion: the migration is ten one-line additions and nothing else, so the whole
 * existing suite has to come back green underneath it.
 *
 * The run is the criterion's own command, spawned from the checkout root — `tests/acceptance/` may
 * not import the subject, and "the suite passes" is a fact about a process's exit status anyway.
 *
 * **Why the check file is asserted first.** `npx vitest run .Workflow .claude` is green on trunk
 * today, before a line of #274 exists, so an exit-0 assertion on its own would be a claim about the
 * tree this ticket has not touched yet. `.Workflow` is one of the two paths the command names, so
 * once `lane-stage-names.test.ts` is there it is part of the run this criterion is about — and
 * until then, the run being green says nothing about the migration. Asserting the file's presence is
 * what makes the exit status a statement about the post-change suite rather than about trunk.
 */
describe("#274 — the migration leaves the rest of the estate alone", () => {
  // Criterion, verbatim from the ticket:
  // "The full existing suite still passes — check: `npx vitest run .Workflow .claude`"
  it("The full existing suite still passes — check: `npx vitest run .Workflow .claude`", () => {
    expect(
      existsSync(absolute(LANE_STAGE_NAMES_TEST)),
      `${LANE_STAGE_NAMES_TEST} is not in this checkout, so a green \`${commandLine([
        ".Workflow",
        ".claude",
      ])}\` would be a report on the tree before #274 rather than on the migrated one.`,
    ).toBe(true);

    const args = [".Workflow", ".claude"];
    const run = runVitest(args, 2_400_000);

    expect(
      run.status,
      `\`${commandLine(args)}\` — the check this criterion names — did not exit 0` +
        `${run.status === null ? " (the run was killed before it finished)" : ""}:\n${run.output}`,
    ).toBe(0);
  }, 2_700_000);
});
