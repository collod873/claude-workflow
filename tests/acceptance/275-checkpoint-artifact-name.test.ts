import { describe, expect, it } from "vitest";
import { ACTION_PATH, actionYml } from "./275-checkpoint-wiring.fixture";
import { topLevelBlock } from "./workflow-shape.fixture";

/**
 * #275, criterion 2.
 *
 * The criterion, verbatim from the issue body:
 *
 * - [ ] The artifact name is literally checkpoints-${{ inputs.lane }}-${{ inputs.issue }} — check: `grep -q 'checkpoints-\${{ inputs.lane }}-\${{ inputs.issue }}' .github/actions/checkpoints/action.yml`
 *
 * Asserted as the criterion states it — a literal substring of the action's text, which is what the
 * criterion's own `grep` is looking at. The two inputs the expression reads are asserted alongside
 * it because a composite action cannot resolve `inputs.lane` or `inputs.issue` without declaring
 * them, so the literal name would otherwise expand to `checkpoints--` on every run.
 */

const ARTIFACT_NAME = "checkpoints-${{ inputs.lane }}-${{ inputs.issue }}";

describe("#275 — the checkpoint artifact's name", () => {
  it("The artifact name is literally checkpoints-${{ inputs.lane }}-${{ inputs.issue }}", () => {
    const yml = actionYml();
    expect(yml, `${ACTION_PATH} does not exist`).not.toBe("");

    expect(yml, `the action never spells ${ARTIFACT_NAME}`).toContain(ARTIFACT_NAME);

    const inputs = topLevelBlock(yml, "inputs") ?? "";
    expect(inputs, "the action declares no inputs: block").not.toBe("");
    expect(inputs, "the action names no `lane` input").toMatch(/^\s*lane\s*:/m);
    expect(inputs, "the action names no `issue` input").toMatch(/^\s*issue\s*:/m);
  });
});
