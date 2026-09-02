import { describe, expect, it } from "vitest";
import { laneSuiteReport } from "./327-enrol.fixture";

/**
 * Criterion 5 names `npx vitest run .Workflow/agent-workflows/enrol/enrol.test.ts` as its check.
 * `ENROL_PAT` is the machine's one outward credential, and it is referenced by a workflow in the
 * very directory the secret set is derived from — so it is exactly the name a derivation that
 * forgot its exclusions would propagate outward.
 */
describe("#327 — the machine's outward credential", () => {
  // `ENROL_PAT` is never among the secrets written to a target — check:
  it("is never written to an enrolled repository", () => {
    expect(laneSuiteReport()).toBe("");
  }, 900_000);
});
