import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { jobs, workflowPath } from "./workflow-shape.fixture";

const acceptanceYml = workflowPath("acceptance.yml");

describe("#201 lane 04 first authoring — ordering into lane 05", () => {
  // - [ ] `ticket-ready` for a slice is sent after that slice's acceptance tests are on `main`, not before — check: `grep -q "ticket-ready" .github/workflows/acceptance.yml`
  it("`ticket-ready` for a slice is sent after that slice's acceptance tests are on `main`, not before", () => {
    expect(existsSync(acceptanceYml)).toBe(true);
    const yml = readFileSync(acceptanceYml, "utf8");

    // Lane 05 is told by lane 04, so the send lives in acceptance.yml at all.
    expect(yml, "acceptance.yml sends ticket-ready").toMatch(/ticket-ready/);

    const byJob = jobs(yml);
    const announcing = Object.entries(byJob).filter(([, text]) => text.includes("ticket-ready"));
    expect(announcing.length, "a job in acceptance.yml sends ticket-ready").toBeGreaterThan(0);

    for (const [name, text] of announcing) {
      // The tests are on main first: the push comes before the announcement, in
      // the same job, so lane 05 can never claim the slice ahead of its tests.
      const pushIdx = text.search(/\bpush\b/);
      const readyIdx = text.indexOf("ticket-ready");
      expect(pushIdx, `job ${name} pushes the acceptance tests`).toBeGreaterThan(-1);
      expect(pushIdx, `job ${name} pushes before it sends ticket-ready`).toBeLessThan(readyIdx);
    }
  });
});
