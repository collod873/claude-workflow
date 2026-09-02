import { describe, expect, it } from "vitest";
import { laneSuiteReport } from "./327-enrol.fixture";

/**
 * Criterion 6 names `npx vitest run .Workflow/agent-workflows/enrol/enrol.test.ts` as its check. A
 * repository whose labels fail is still worth the setting and the secrets, and a pass that stopped
 * at the first failure would leave the estate half-enrolled — while a pass that swallowed the
 * failure would report success on a repository that got nothing.
 */
describe("#327 — one repository's failure against the rest of the pass", () => {
  // A failure in labels, setting, or secrets for one repository does not stop the pass over the
  it("reports the failure, finishes the pass, and still exits non-zero", () => {
    expect(laneSuiteReport()).toBe("");
  }, 900_000);
});
