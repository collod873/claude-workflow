import { describe, expect, it } from "vitest";
import { moduleUrl } from "./237-spec-pass.fixture";
import {
  CRITIC_SOURCE,
  RESOLUTIONS,
  runProbe,
  SPEC_TITLE,
  specBody,
} from "./262-critic-pen.fixture";

/**
 * The criterion this file is the acceptance test for, verbatim:
 *
 * - [ ] The critic returns resolutions carrying a decision and a reason, not a findings list — check: `npx vitest run .Workflow/agent-workflows/spec/critic.test.ts`
 *
 * Reached the way a shell reaches it: a child process imports `critic.ts` by absolute file URL,
 * calls the real `runSpecCritic` with a fake `StageExec` that answers with the wire shape under
 * test, and prints what came back. Nothing here mocks the critic — the fake stands in for the CLI,
 * which is the seam `critic.ts` already takes as a parameter.
 */

const PROBE = `
const MODULE = process.env.PROBE_MODULE;
const RESPONSE = process.env.PROBE_RESPONSE || "";
const INPUT = JSON.parse(process.env.PROBE_INPUT || "{}");

const calls = [];
const exec = async (...args) => {
  calls.push(
    args.map((value) => {
      if (typeof value === "string") return value;
      try { return JSON.stringify(value) || String(value); } catch (err) { return String(value); }
    }),
  );
  return RESPONSE;
};

(async () => {
  let result = null;
  let keys = [];
  let error = null;
  try {
    const mod = await import(MODULE);
    result = await mod.runSpecCritic(exec, INPUT);
    keys = result && typeof result === "object" ? Object.keys(result) : [];
  } catch (err) {
    error = err && err.message ? err.message : String(err);
  }
  console.log(
    "PROBE:" +
      JSON.stringify({
        result: result === undefined ? null : result,
        keys: keys,
        calls: calls,
        error: error,
      }),
  );
})();
`;

interface CriticProbe {
  result: Record<string, unknown> | null;
  keys: string[];
  calls: string[][];
  error: string | null;
}

function probeCritic(response: string): CriticProbe {
  return runProbe<CriticProbe>(
    PROBE,
    {
      PROBE_MODULE: moduleUrl(CRITIC_SOURCE),
      PROBE_INPUT: JSON.stringify({ title: SPEC_TITLE, body: specBody() }),
      PROBE_RESPONSE: response,
    },
    { result: null, keys: [], calls: [], error: null },
  );
}

describe("#262 — the critic gains a pen", () => {
  it("The critic returns resolutions carrying a decision and a reason, not a findings list", () => {
    const resolved = probeCritic(JSON.stringify({ resolutions: RESOLUTIONS }));

    expect(resolved.error, "runSpecCritic refused a resolutions payload").toBeNull();
    expect(resolved.keys).toContain("resolutions");
    expect(resolved.keys).not.toContain("findings");
    expect(resolved.result?.resolutions).toEqual(RESOLUTIONS);

    // Two fields, not one sentence carrying both: a reason that is a field can be checked for, and
    // a resolution that names no reason is not a resolution this lane may write into a body.
    const reasonless = probeCritic(
      JSON.stringify({ resolutions: [{ decision: RESOLUTIONS[0].decision }] }),
    );
    expect(reasonless.error, "a resolution carrying no reason was accepted").not.toBeNull();

    // And the outbox is gone: a findings list is no longer a shape this stage can hand back — it
    // either refuses the payload or returns something that is not a findings list.
    const legacy = probeCritic(
      JSON.stringify({ findings: ['"handles errors gracefully" admits two implementations.'] }),
    );
    expect(
      legacy.error !== null || !legacy.keys.includes("findings"),
      "the critic still returns a findings list",
    ).toBe(true);
  }, 600_000);
});
