import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readWorkflow, WORKFLOWS_DIR } from "./read-workflow.ts";

/**
 * `enrol.yml`'s trigger surface, which is the whole of ADR-0053's guarantee for the one credential
 * this repository stores that reaches outward (#326).
 *
 * `ENROL_PAT` can write a workflow file into every repository the owner has. The standing rule is
 * that no credential is referenced by a job a pull request can trigger, and here that rule is not
 * enforced by any permission — it is enforced by the trigger list being exactly two events, neither
 * of which a pull request can fire. So the list is asserted as an exact set rather than by checking
 * that the wrong ones are absent: a third trigger added later is the failure this catches, whatever
 * it is.
 *
 * Deliberately imports nothing from `enrol/` — `shared/` may never import a lane
 * (docs/agents/module-boundaries.md), and everything below is a fact about the YAML and the
 * directory it sits in rather than about the lane's own modules.
 */

const { workflow, source } = readWorkflow<{
  on: {
    push?: { branches?: string[]; paths?: string[] };
    workflow_dispatch?: unknown;
  };
  jobs: Record<string, { steps: Array<{ run?: string }> }>;
}>("enrol.yml");

/** `.github/workflows/*-caller.yml` as the workflow's own `paths:` filter spells it, made testable. */
function matcherFor(glob: string): RegExp {
  return new RegExp(`^${glob.split("*").map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join("[^/]*")}$`);
}

describe("enrol.yml's trigger surface", () => {
  it("fires on exactly two events, neither of which a pull request can fire (ADR-0053)", () => {
    expect(Object.keys(workflow.on).sort()).toEqual(["push", "workflow_dispatch"]);
  });

  it("is not itself a reusable workflow, because no enrolled repository enrols anyone", () => {
    // The absence of `workflow_call` is what leaves this lane out of the stub set: the set is
    // globbed as `*-caller.yml`, and a lane with no caller has no stub to ship.
    expect(Object.keys(workflow.on)).not.toContain("workflow_call");
    expect(readdirSync(WORKFLOWS_DIR)).not.toContain("enrol-caller.yml");
  });

  it("fires on a push to main only, filtered to the stub set it ships", () => {
    expect(workflow.on.push?.branches).toEqual(["main"]);

    const paths = workflow.on.push?.paths ?? [];
    const stubs = readdirSync(WORKFLOWS_DIR).filter((name) => name.endsWith("-caller.yml"));

    // The filter is only worth anything if it actually matches this repository's stubs — a typo in
    // the glob is a lane that never fires, which is invisible in a run history that has no runs.
    expect(stubs.length).toBeGreaterThan(0);
    for (const stub of stubs) {
      expect(
        paths.some((glob) => matcherFor(glob).test(`.github/workflows/${stub}`)),
        `no paths: filter in enrol.yml matches .github/workflows/${stub}`,
      ).toBe(true);
    }
  });

  it("spends ENROL_PAT rather than the built-in token, which cannot write another repository", () => {
    expect(source).toContain("secrets.ENROL_PAT");
  });
});

/**
 * `walk-home.yml`'s trigger surface (ADR-0136, #326, #330) — the second and only other reference
 * to `ENROL_PAT`, so ADR-0053's guarantee holds for it exactly as it holds for `enrol.yml` above:
 * no pull request may ever start a job that can see the credential that writes into an enrolled
 * repository's own tracker.
 */
const { workflow: walkHome, source: walkHomeSource } = readWorkflow<{
  on: { repository_dispatch?: { types?: string[] }; schedule?: unknown; workflow_dispatch?: unknown; push?: unknown };
}>("walk-home.yml");

describe("walk-home.yml's trigger surface", () => {
  it("fires on exactly the session-captured dispatch — neither a pull request nor a clock can fire it (ADR-0053, ADR-0004)", () => {
    expect(Object.keys(walkHome.on)).toEqual(["repository_dispatch"]);
    expect(walkHome.on.repository_dispatch?.types).toEqual(["session-captured"]);
  });

  it("spends ENROL_PAT rather than the built-in token, which cannot write into an enrolled repository's tracker", () => {
    expect(walkHomeSource).toContain("secrets.ENROL_PAT");
  });

  it("is not in the stub set — no enrolled repository sweeps the estate on this repository's behalf", () => {
    expect(readdirSync(WORKFLOWS_DIR)).not.toContain("walk-home-caller.yml");
  });
});
