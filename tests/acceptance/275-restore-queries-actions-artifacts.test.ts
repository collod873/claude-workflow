import { describe, expect, it } from "vitest";
import { ACTION_PATH, actionYml } from "./275-checkpoint-wiring.fixture";

/**
 * #275, criterion 3.
 *
 * The criterion, verbatim from the issue body:
 *
 * - [ ] The restore phase queries actions/artifacts rather than a plain download-artifact — check: `grep -q 'actions/artifacts' .github/actions/checkpoints/action.yml`
 *
 * The needle is the criterion's own: `actions/download-artifact` does not contain the substring
 * `actions/artifacts`, so the grep really does separate a query from a plain download.
 *
 * The second assertion is what "rather than a plain download-artifact" rules out: the ticket allows
 * `actions/download-artifact` given a resolved `run-id`, and forbids only the bare form that sees
 * the current run's artifacts and so restores nothing across runs. So a download step is fine
 * exactly when the action also names the run it resolved.
 */

describe("#275 — restoring a previous run's checkpoints", () => {
  it("The restore phase queries actions/artifacts rather than a plain download-artifact", () => {
    const yml = actionYml();
    expect(yml, `${ACTION_PATH} does not exist`).not.toBe("");

    expect(yml, "the action has a restore phase").toContain("restore");
    expect(yml, "the action never queries actions/artifacts").toContain("actions/artifacts");

    if (/uses\s*:\s*["']?actions\/download-artifact/.test(yml)) {
      expect(
        yml,
        "a download-artifact restore has to name the run-id it resolved, or it only ever sees this run's artifacts",
      ).toMatch(/run-id\s*:/);
    }
  });
});
