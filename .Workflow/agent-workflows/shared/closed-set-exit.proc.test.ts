import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { expect, test } from "vitest";
import { slice } from "./plan.fixture";
import { reason } from "./reason";
import { validateClaimsAreMutable } from "./render-body";
import { REPO_ROOT } from "./repo-sources";

const IMMUTABLE_SET_SOURCE = ".Workflow/agent-workflows/shared/immutable-set.json";
const VENUE_SLOTS_SOURCE = ".Workflow/agent-workflows/shared/venue-slots.json";

function immutableClaimRefusal(): string {
  try {
    validateClaimsAreMutable([slice({ title: "Touches the closed set", filesClaimed: ["vitest.config.ts"] })]);
  } catch (err) {
    return reason(err);
  }
  throw new Error("validateClaimsAreMutable accepted a claim on the immutable set");
}

test("#585.1: the immutable-set refusal names the file that holds the set, not only its members", () => {
  expect(immutableClaimRefusal()).toContain(IMMUTABLE_SET_SOURCE);
});

test("#585.2: the immutable-set refusal names the act that changes the set: a commit editing that file", () => {
  expect(immutableClaimRefusal()).toMatch(/commit/i);
});

test("#585.4: bin/gauntlet refuses an unknown venue by naming the file its venue list comes from", () => {
  const run = spawnSync(join(REPO_ROOT, "bin/gauntlet"), ["not-a-venue"], { encoding: "utf8" });

  expect(run.status).not.toBe(0);
  expect(`${run.stderr}${run.stdout}`).toContain(VENUE_SLOTS_SOURCE);
});
