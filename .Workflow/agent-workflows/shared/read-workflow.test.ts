import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readWorkflow, WORKFLOWS_DIR } from "./read-workflow";

describe("readWorkflow", () => {
  it("resolves the path under .github/workflows/, by name alone", () => {
    const { path } = readWorkflow("verify.yml");
    expect(path).toBe(join(WORKFLOWS_DIR, "verify.yml"));
  });

  it("returns the same raw source a direct readFileSync would", () => {
    const { source } = readWorkflow("verify.yml");
    expect(source).toBe(readFileSync(join(WORKFLOWS_DIR, "verify.yml"), "utf8"));
  });

  it("parses the YAML into the workflow's own structure", () => {
    const { workflow } = readWorkflow<{ name: string; jobs: Record<string, unknown> }>("verify.yml");
    // "Verify (reusable)" since ADR-0055/ADR-0132: `verify.yml` itself is the reusable workflow,
    // called through `verify-caller.yml`, whose own name is `Verify` — see that file for why.
    expect(workflow.name).toBe("Verify (reusable)");
    expect(workflow.jobs).toHaveProperty("verify");
  });

  it("reads every real workflow file in the repo without throwing", () => {
    const names = readdirSync(WORKFLOWS_DIR).filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"));
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      expect(() => readWorkflow(name)).not.toThrow();
    }
  });
});
