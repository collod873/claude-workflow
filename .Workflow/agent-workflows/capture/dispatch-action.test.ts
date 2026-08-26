import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { RECONCILE_DISPATCH_ACTION } from "../close-gate/reconcile";
import { AUDIT_DISPATCH_ACTION } from "../observations/run-audit";

/**
 * The guard #107 was missing.
 *
 * Every other test on this dispatch reads one side of the boundary: `run-audit.test.ts` asserted
 * `audit.yml` agreed with `run-audit.ts`, `reconcile.test.ts` asserts the same of its own pair,
 * and `session-capture.test.ts` asserts the hook sends what the hook says it sends. All three
 * passed for fourteen consecutive `Audit` runs that executed nothing, because the audit pair
 * agreed with each other on a name — `audit` — that the emitter had never sent.
 *
 * Nothing crossed from the emitter to a consumer. This file is that crossing: it reads the hook's
 * own source for the string on the wire and holds every consumer to it, so a consumer renamed
 * alone fails here rather than going quiet in CI.
 */

function repoFile(path: string): string {
  return readFileSync(fileURLToPath(new URL(`../../../${path}`, import.meta.url)), "utf8");
}

const HOOK_SOURCE = repoFile(".claude/hooks/session-capture-hook.mjs");

/** The dispatch action as the emitter actually spells it — the one authority the consumers copy. */
const WIRE_ACTION = (() => {
  const match = HOOK_SOURCE.match(/^const DISPATCH_EVENT_TYPE = "([^"]+)";$/m);
  if (!match) {
    throw new Error("session-capture-hook.mjs no longer declares DISPATCH_EVENT_TYPE as a literal");
  }
  return match[1];
})();

describe("every consumer of the capture dispatch scopes on the name the hook sends", () => {
  it("the hook sends it under that name", () => {
    // The literal above is derived from the hook, so this pins the shape the derivation assumes:
    // the same string reaching `gh api --field event_type=`, not merely declared beside it.
    expect(HOOK_SOURCE).toContain("`event_type=${DISPATCH_EVENT_TYPE}`");
    expect(WIRE_ACTION).toBe("session-captured");
  });

  it("audit.yml gates its job on it", () => {
    expect(repoFile(".github/workflows/audit.yml")).toContain(`github.event.action == '${WIRE_ACTION}'`);
  });

  it("run-audit.ts checks for it", () => {
    expect(AUDIT_DISPATCH_ACTION).toBe(WIRE_ACTION);
  });

  it("close-gate-reconcile.yml gates its job on it", () => {
    expect(repoFile(".github/workflows/close-gate-reconcile.yml")).toContain(
      `github.event.action == '${WIRE_ACTION}'`,
    );
  });

  it("reconcile.ts checks for it", () => {
    expect(RECONCILE_DISPATCH_ACTION).toBe(WIRE_ACTION);
  });
});
