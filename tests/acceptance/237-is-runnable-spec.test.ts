import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { repoRoot } from "./workflow-shape.fixture";
import {
  TICKET_SHAPE_SOURCE,
  TICKET_SHAPE_TEST,
  moduleUrl,
  probeResult,
  runTsx,
} from "./237-spec-pass.fixture";

/**
 * #237, criterion 1. `isRunnableSpec` is reached the way a shell would reach it — a child process
 * that imports `shared/ticket-shape.ts` by absolute file URL and prints what the function answered
 * for each body — because nothing under `tests/acceptance/` may import across the boundary.
 *
 * The probe normalises the answer rather than demanding a bare boolean: a predicate that returns
 * the command it parsed, or a `{ ok }` record, is still a predicate. What it will not do is call a
 * rejection an acceptance — every rejecting shape below has to come back falsy.
 */
const PROBE = `
const MODULE = process.env.PROBE_MODULE;
const cases = JSON.parse(process.env.PROBE_CASES || "{}");
function accepted(value) {
  if (typeof value === "boolean") return value;
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.length > 0;
  if (typeof value === "object") {
    const keys = ["ok", "runnable", "isRunnable", "valid"];
    for (const key of keys) {
      if (key in value) return Boolean(value[key]);
    }
    if ("command" in value) return Boolean(value.command);
    if ("errors" in value) return Array.isArray(value.errors) ? value.errors.length === 0 : !value.errors;
    if ("reason" in value) return !value.reason;
    return true;
  }
  return Boolean(value);
}
function show(value) {
  try {
    const text = JSON.stringify(value);
    return text === undefined ? String(value) : text;
  } catch (err) {
    return String(value);
  }
}
(async () => {
  const result = { exported: "missing", cases: {}, error: null };
  try {
    const mod = await import(MODULE);
    const isRunnableSpec = mod.isRunnableSpec;
    result.exported = typeof isRunnableSpec;
    for (const name of Object.keys(cases)) {
      const body = cases[name];
      let value = undefined;
      let threw = null;
      try {
        value = isRunnableSpec(body);
      } catch (err) {
        threw = err && err.message ? err.message : String(err);
        try {
          value = isRunnableSpec({ title: "A spec", body: body });
          threw = null;
        } catch (second) {
          value = undefined;
        }
      }
      result.cases[name] = { accepted: accepted(value), raw: show(value), threw: threw };
    }
  } catch (err) {
    result.error = err && err.message ? err.message : String(err);
  }
  console.log("PROBE:" + JSON.stringify(result));
})();
`;

const heading = "## Acceptance criteria";

const CASES: Record<string, string> = {
  "one well-formed check-marked criterion": [
    "## Problem Statement",
    "Nothing asks whether the product does the thing.",
    "",
    heading,
    "",
    "- [ ] I'll know it works when I can see a verdict on the spec — check: `true`",
    "",
  ].join("\n"),

  "no acceptance criteria heading at all": [
    "## Problem Statement",
    "A body nobody wrote criteria into.",
    "",
    "## Solution",
    "Something.",
    "",
  ].join("\n"),

  "the heading with zero items under it": [heading, "", "Some prose and no checkbox at all.", ""].join(
    "\n",
  ),

  "two well-formed check-marked criteria": [
    heading,
    "",
    "- [ ] I'll know it works when I can see a verdict — check: `true`",
    "- [ ] And also when the second thing happens — check: `true`",
    "",
  ].join("\n"),

  "one criterion whose marker has no backticked command": [
    heading,
    "",
    "- [ ] I'll know it works when I can see a verdict — check: true",
    "",
  ].join("\n"),

  "one criterion with prose trailing the backticked command": [
    heading,
    "",
    "- [ ] I'll know it works when I can see a verdict — check: `true` and then look at it",
    "",
  ].join("\n"),
};

interface ShapeProbe {
  exported: string;
  cases: Record<string, { accepted: boolean; raw: string; threw: string | null }>;
  error: string | null;
}

describe("#237 — isRunnableSpec, the one implementation of the spec shape rule", () => {
  // - [ ] `isRunnableSpec` accepts exactly one well-formed check-marked criterion, rejects zero, two, or a malformed one — check: `npx vitest run .Workflow/agent-workflows/shared/ticket-shape.test.ts`
  it("accepts exactly one well-formed check-marked criterion and rejects zero, two, or a malformed one", () => {
    expect(existsSync(TICKET_SHAPE_SOURCE), `${TICKET_SHAPE_SOURCE} is missing`).toBe(true);

    const probe = probeResult<ShapeProbe>(
      runTsx(PROBE, {
        PROBE_MODULE: moduleUrl(TICKET_SHAPE_SOURCE),
        PROBE_CASES: JSON.stringify(CASES),
      }),
    );

    expect(probe.error, "the probe could not import shared/ticket-shape.ts").toBeNull();
    expect(
      probe.exported,
      "shared/ticket-shape.ts must export isRunnableSpec — the lane 09 pass calls it rather than " +
        "composing the rule out of the grammar primitives at its own call site",
    ).toBe("function");

    const verdicts = Object.fromEntries(
      Object.entries(probe.cases).map(([name, answer]) => [name, answer.accepted]),
    );

    expect(verdicts, `raw answers: ${JSON.stringify(probe.cases, null, 2)}`).toEqual({
      "one well-formed check-marked criterion": true,
      "no acceptance criteria heading at all": false,
      "the heading with zero items under it": false,
      "two well-formed check-marked criteria": false,
      "one criterion whose marker has no backticked command": false,
      "one criterion with prose trailing the backticked command": false,
    });
  }, 240_000);

  // - [ ] `isRunnableSpec` accepts exactly one well-formed check-marked criterion, rejects zero, two, or a malformed one — check: `npx vitest run .Workflow/agent-workflows/shared/ticket-shape.test.ts`
  it("has a ticket-shape.test.ts of its own, and that check command passes", () => {
    // Asserted before the run, so a `passWithNoTests` config can never make a green exit status
    // mean "there was nothing to run".
    expect(
      existsSync(TICKET_SHAPE_TEST),
      "criterion 1's check names .Workflow/agent-workflows/shared/ticket-shape.test.ts, and it does not exist",
    ).toBe(true);

    const run = spawnSync(
      "npx",
      ["vitest", "run", ".Workflow/agent-workflows/shared/ticket-shape.test.ts"],
      { cwd: repoRoot, encoding: "utf8", timeout: 300_000, maxBuffer: 64 * 1024 * 1024 },
    );

    expect(run.status, `${run.stdout ?? ""}\n${run.stderr ?? ""}`).toBe(0);
  }, 330_000);
});
