import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * #274 — every `runStage` call site names its stage.
 *
 * `stage.ts` keys checkpointing and raw-response preservation on `StageOptions.stage`, and both
 * stay off for a call that omits it — so an unnamed call site is a lane that silently opts out of
 * resume. This file is the check #274's first criterion names, living with the subject the way the
 * rest of this directory's tests do.
 *
 * The judgment here is per file, not per call: each file must carry at least as many literal
 * `stage: "<name>"` entries as it has `runStage(` calls. The strict per-call parse — balancing each
 * call's parentheses and reading its last argument — is the acceptance twin's job
 * (`tests/acceptance/274-stage-key-at-every-call-site.test.ts`), which cannot import anything here
 * and re-runs this file as a child besides. Two scanners answering the same question in two places
 * is the divergence the simpler count avoids.
 */

/** `<file> runStage-calls` for the ten call sites #274 claims, relative to the repo root. */
const CLAIMED = [
  ".Workflow/agent-workflows/spec/spec.ts 1",
  ".Workflow/agent-workflows/spec/sweep.ts 1",
  ".Workflow/agent-workflows/spec/critic.ts 1",
  ".Workflow/agent-workflows/spec/reconcile.ts 1",
  ".Workflow/agent-workflows/review/review.ts 2",
  ".Workflow/agent-workflows/review/refuter.ts 1",
  ".Workflow/agent-workflows/implement/implement.ts 1",
  ".Workflow/agent-workflows/fixer/fixer.ts 1",
  ".Workflow/agent-workflows/acceptance/acceptance.ts 1",
];

const ROOT = path.resolve(__dirname, "../../..");

describe("#274 — the ten migrated call sites each carry a literal stage name", () => {
  for (const entry of CLAIMED) {
    const [file, expected] = entry.split(" ");
    it(`${file} names a stage for each of its ${expected} runStage call(s)`, () => {
      const source = readFileSync(path.join(ROOT, file), "utf8");
      const calls = source.match(/\brunStage(?:<[^>]*>)?\(/g) ?? [];
      const names = source.match(/\bstage: "[^"\n]+"/g) ?? [];
      expect(
        calls.length,
        `${file} should carry ${expected} runStage call(s) — a moved or deleted call is a change ` +
          `#274 forbids, not a migration`,
      ).toBe(Number(expected));
      expect(
        names.length,
        `${file} has ${calls.length} runStage call(s) but only ${names.length} literal ` +
          `\`stage: "<name>"\` entr(y/ies) — an unnamed call opts its lane out of checkpointing`,
      ).toBeGreaterThanOrEqual(calls.length);
    });
  }
});
