import { describe, expect, it } from "vitest";
import {
  RUNNABLE_SPEC_BODY,
  UNRUNNABLE_SPEC_BODY,
  labelWrites,
  markerWrites,
  runReconcilePass,
  sliceBody,
} from "./237-spec-pass.fixture";

/**
 * #237, criterion 2. The pass is driven through `runReconcile` itself, with a fake `GhExec`
 * injected inside a child process — the seam `reconcile.test.ts` already uses — so what is asserted
 * is what a reader of the tracker would see: which marker got written, and which label went on.
 *
 * Each scenario holds exactly one `prd` issue with at least one sub-issue, so a marker found
 * anywhere in the call log belongs to that spec and nothing else. The slice under it is a published
 * one, which is why the reconciler also dispatches it — that is its existing job and is not what
 * these assertions are about.
 */

const RUNNABLE = {
  issues: [
    {
      number: 300,
      title: "A spec that closes on a run of its own check",
      body: RUNNABLE_SPEC_BODY,
      labels: ["prd"],
      comments: [],
      children: [301],
    },
    {
      number: 301,
      title: "The tracer slice",
      body: sliceBody(300),
      labels: [],
      comments: [],
      children: [],
    },
  ],
};

const UNRUNNABLE = {
  issues: [
    {
      number: 310,
      title: "A spec whose body carries two criteria",
      body: UNRUNNABLE_SPEC_BODY,
      labels: ["prd"],
      comments: [],
      children: [311],
    },
    {
      number: 311,
      title: "Its first slice",
      body: sliceBody(310),
      labels: [],
      comments: [],
      children: [],
    },
  ],
};

describe("#237 — lane 09's spec-evaluate pass writes one of two markers, never both", () => {
  // - [ ] The pass upserts `prd-check:v1` for a runnable spec, `prd-unrunnable:v1`+`needs-human` otherwise, mutually exclusive — check: `npx vitest run .Workflow/agent-workflows/dispatch/reconcile.test.ts`
  it("upserts prd-check:v1 for a runnable spec, and neither prd-unrunnable:v1 nor needs-human", () => {
    const probe = runReconcilePass(RUNNABLE);

    expect(probe.error, "runReconcile threw rather than returning an outcome").toBeNull();

    const verdict = markerWrites(probe.calls, "prd-check:v1");
    const refusal = markerWrites(probe.calls, "prd-unrunnable:v1");

    expect(
      verdict.length,
      `no write carried prd-check:v1 for #300. calls: ${JSON.stringify(probe.calls, null, 2)}`,
    ).toBeGreaterThan(0);
    expect(
      refusal,
      "a body the pass could run must never be recorded in the refusal slot — the two markers are " +
        "mutually exclusive",
    ).toEqual([]);
    expect(
      labelWrites(probe.calls).added,
      "needs-human means an agent tried and stopped; nothing stopped here",
    ).not.toContain("needs-human");
  }, 240_000);

  // - [ ] The pass upserts `prd-check:v1` for a runnable spec, `prd-unrunnable:v1`+`needs-human` otherwise, mutually exclusive — check: `npx vitest run .Workflow/agent-workflows/dispatch/reconcile.test.ts`
  it("upserts prd-unrunnable:v1 and needs-human for a body it cannot run, and never prd-check:v1", () => {
    const probe = runReconcilePass(UNRUNNABLE);

    expect(probe.error, "runReconcile threw rather than returning an outcome").toBeNull();

    const verdict = markerWrites(probe.calls, "prd-check:v1");
    const refusal = markerWrites(probe.calls, "prd-unrunnable:v1");

    expect(
      refusal.length,
      `no write carried prd-unrunnable:v1 for #310. calls: ${JSON.stringify(probe.calls, null, 2)}`,
    ).toBeGreaterThan(0);
    expect(
      verdict,
      "a refusal must never be written under the verdict marker — that marker means a check ran, " +
        "and a refusal ran nothing",
    ).toEqual([]);
    expect(
      labelWrites(probe.calls).added,
      "a body the pass cannot run is handed to a human",
    ).toContain("needs-human");
  }, 240_000);
});
