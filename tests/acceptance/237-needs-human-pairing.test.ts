import { describe, expect, it } from "vitest";
import {
  OWN_REFUSAL_COMMENT,
  RUNNABLE_SPEC_BODY,
  labelWrites,
  markerWrites,
  runReconcilePass,
  sliceBody,
} from "./237-spec-pass.fixture";

/**
 * #237, criterion 3. Both scenarios are the same spec state seen twice — a runnable body under a
 * standing `needs-human` — and differ only in what the label is paired with. Where the pass's own
 * `prd-unrunnable:v1` comment stands beside it, the label is the pass's and comes off in the same
 * act that rewrites that comment away. Where it does not, the label is another lane's signal about
 * something else, and the pass has no business touching it.
 */

const ITS_OWN = {
  issues: [
    {
      number: 320,
      title: "A spec whose body was fixed since the last session",
      body: RUNNABLE_SPEC_BODY,
      labels: ["prd", "needs-human"],
      comments: [OWN_REFUSAL_COMMENT],
      children: [321],
    },
    {
      number: 321,
      title: "Its tracer slice",
      body: sliceBody(320),
      labels: [],
      comments: [],
      children: [],
    },
  ],
};

const ANOTHER_LANE_S = {
  issues: [
    {
      number: 330,
      title: "A spec another lane flagged",
      body: RUNNABLE_SPEC_BODY,
      labels: ["prd", "needs-human"],
      // No prd-unrunnable:v1 anywhere on it — so this needs-human is not paired with this pass.
      comments: ["A criterion is still unmet after the fix pass.\n\n<!-- fix-pass:v1 -->"],
      children: [331],
    },
    {
      number: 331,
      title: "Its tracer slice",
      body: sliceBody(330),
      labels: [],
      comments: [],
      children: [],
    },
  ],
};

describe("#237 — the pass clears only the needs-human it paired with its own refusal", () => {
  // - [ ] `needs-human` this pass set clears once the body validates again; one another lane wrote is left untouched — check: `npx vitest run .Workflow/agent-workflows/dispatch/reconcile.test.ts`
  it("clears the needs-human it set, in the same act that rewrites its refusal to a verdict", () => {
    const probe = runReconcilePass(ITS_OWN);

    expect(probe.error, "runReconcile threw rather than returning an outcome").toBeNull();

    const verdict = markerWrites(probe.calls, "prd-check:v1");
    expect(
      verdict.length,
      `the refusal was not rewritten to a verdict for #320. calls: ${JSON.stringify(probe.calls, null, 2)}`,
    ).toBeGreaterThan(0);

    expect(
      labelWrites(probe.calls).removed,
      "a label only ever added would leave a spec that later closed green still reading " +
        "'an agent tried and stopped'",
    ).toContain("needs-human");
  }, 240_000);

  // - [ ] `needs-human` this pass set clears once the body validates again; one another lane wrote is left untouched — check: `npx vitest run .Workflow/agent-workflows/dispatch/reconcile.test.ts`
  it("leaves a needs-human another lane wrote alone, even while writing that spec's verdict", () => {
    const probe = runReconcilePass(ANOTHER_LANE_S);

    expect(probe.error, "runReconcile threw rather than returning an outcome").toBeNull();

    // The pass did reach #330 — so the label being left is a decision, not a spec it skipped.
    expect(
      markerWrites(probe.calls, "prd-check:v1").length,
      `the pass wrote no verdict for #330. calls: ${JSON.stringify(probe.calls, null, 2)}`,
    ).toBeGreaterThan(0);

    expect(
      labelWrites(probe.calls).removed,
      "needs-human is shared pipeline vocabulary; one standing on a spec whose comment is not this " +
        "pass's refusal is not this pass's to touch",
    ).not.toContain("needs-human");
  }, 240_000);
});
