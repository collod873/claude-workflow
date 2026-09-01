import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BASELINE_RELATIVE_PATH,
  collectViolations,
  describeDelta,
  isConfigured,
  type Violation,
} from "./boundaries-baseline";
import { readBaselineFile } from "./baseline-gate";

const REPO_ROOT = resolve(import.meta.dirname, "../../..");

describe("isConfigured", () => {
  it("is true for this repository, which carries .dependency-cruiser.cjs", () => {
    expect(isConfigured(REPO_ROOT)).toBe(true);
  });

  it("is false for a tree with no .dependency-cruiser.cjs", () => {
    expect(isConfigured("/tmp")).toBe(false);
  });
});

describe("collectViolations against this repository", () => {
  it("matches the committed baseline exactly — the standing debt this ticket filed, no more, no less", () => {
    const fresh = collectViolations(REPO_ROOT);
    const baseline = readBaselineFile<Violation>(join(REPO_ROOT, BASELINE_RELATIVE_PATH));
    const identity = (v: Violation) => `${v.rule} ${v.from} ${v.to}`;

    expect(fresh.map(identity).sort()).toEqual(baseline.items.map(identity).sort());
  });

  it("no longer finds shared/rewrite-session-notes-schema.ts importing observations/ — the one edge this ticket fixed, not baselined", () => {
    const fresh = collectViolations(REPO_ROOT);
    const stillBackwards = fresh.some(
      (v) =>
        v.from.endsWith("shared/rewrite-session-notes-schema.ts") &&
        v.to.includes("/observations/"),
    );
    expect(stillBackwards).toBe(false);
  });
});

describe("describeDelta", () => {
  it("returns undefined for an empty delta", () => {
    expect(describeDelta({ added: [], resolved: [] })).toBeUndefined();
  });

  it("names #305 and the doc for a new violation", () => {
    const violation: Violation = {
      rule: "no-lane-to-lane-implement",
      from: ".Workflow/agent-workflows/implement/x.ts",
      to: ".Workflow/agent-workflows/spec/y.ts",
    };
    const message = describeDelta({ added: [violation], resolved: [] });
    expect(message).toContain("#305");
    expect(message).toContain("docs/agents/module-boundaries.md");
    expect(message).toContain(`${violation.rule}: ${violation.from} → ${violation.to}`);
  });

  it("points at boundaries-baseline.ts's own update mode for a resolved violation", () => {
    const violation: Violation = {
      rule: "shared-no-lane",
      from: ".Workflow/agent-workflows/shared/x.ts",
      to: ".Workflow/agent-workflows/implement/y.ts",
    };
    const message = describeDelta({ added: [], resolved: [violation] });
    expect(message).toContain("node .Workflow/agent-workflows/shared/boundaries-baseline.ts update <root>");
  });
});

describe("this repository's committed baseline file", () => {
  it("parses as JSON with a `why` and a `generated` date", () => {
    const raw = readFileSync(join(REPO_ROOT, BASELINE_RELATIVE_PATH), "utf8");
    const baseline = JSON.parse(raw) as { generated: string; why: string; items: Violation[] };
    expect(baseline.generated).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(baseline.why.length).toBeGreaterThan(0);
    expect(Array.isArray(baseline.items)).toBe(true);
  });
});
