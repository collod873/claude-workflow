import { describe, expect, it } from "vitest";
import { runReconcile } from "../../.Workflow/agent-workflows/dispatch/reconcile";
import {
  createTracker,
  RUNNABLE_CRITERION,
  SECOND_RUNNABLE_CRITERION,
  silent,
  specBody,
} from "./237-spec-pass.fixture";

/**
 * #237's second criterion: lane 09's pass evaluates every open `prd` issue with at least one
 * sub-issue and upserts one comment carrying one of two markers.
 *
 * The two markers share no substring on purpose — a refusal recorded under the verdict marker would
 * satisfy the parent spec's own check with no check command having run, which is the failure the
 * whole feature exists to end.
 *
 * Neither spec here can close: every child is open, so nothing is delivered, and delivery is what
 * gates the close. Evaluation does not wait for it — that is the point of the pass.
 */

const VERDICT_MARKER = "prd-check:v1";
const REFUSAL_MARKER = "prd-unrunnable:v1";

describe("#237 — the spec-evaluate pass writes one marker per spec", () => {
  /**
   * #237, second acceptance criterion, verbatim:
   * The pass upserts `prd-check:v1` for a runnable spec, `prd-unrunnable:v1`+`needs-human` otherwise, mutually exclusive — check: `npx vitest run .Workflow/agent-workflows/dispatch/reconcile.test.ts`
   */
  it("The pass upserts `prd-check:v1` for a runnable spec, `prd-unrunnable:v1`+`needs-human` otherwise, mutually exclusive — check: `npx vitest run .Workflow/agent-workflows/dispatch/reconcile.test.ts`", () => {
    const tracker = createTracker([
      {
        number: 500,
        title: "A spec whose body is runnable",
        body: specBody([RUNNABLE_CRITERION]),
        children: [501],
      },
      {
        number: 600,
        title: "A spec carrying two criteria, which the shape rule refuses",
        body: specBody([RUNNABLE_CRITERION, SECOND_RUNNABLE_CRITERION]),
        children: [601],
      },
    ]);

    runReconcile({ gh: tracker.gh, log: silent });

    const runnable = tracker.bodiesFor(500).join("\n---\n");
    expect(runnable, "a runnable spec gets its verdict recorded under `prd-check:v1`").toContain(VERDICT_MARKER);
    expect(runnable, "a spec the pass could read is not a refusal").not.toContain(REFUSAL_MARKER);

    const unrunnable = tracker.bodiesFor(600).join("\n---\n");
    expect(unrunnable, "a body the pass cannot run is recorded under `prd-unrunnable:v1`").toContain(REFUSAL_MARKER);
    expect(
      unrunnable,
      "a refusal must never be written into the verdict slot — `prd-check:v1` means a check ran",
    ).not.toContain(VERDICT_MARKER);

    const labels = tracker.labelOps();
    expect(labels, "a refusal is an agent that tried and stopped, so the spec is handed to a human").toContainEqual({
      issue: 600,
      label: "needs-human",
      op: "add",
    });
    expect(
      labels.filter((op) => op.issue === 500 && op.label === "needs-human"),
      "a spec the pass read and evaluated is not stuck and gets no `needs-human`",
      ).toEqual([]);

    // Mutually exclusive: whichever marker a spec carries describes what this session found, and no
    // comment the pass writes carries both or neither.
    const written = tracker.commentWrites().filter((write) => write.issue === 500 || write.issue === 600);
    expect(written.length, "each in-scope spec is told what this session found").toBeGreaterThanOrEqual(2);
    for (const write of written) {
      const carried = [VERDICT_MARKER, REFUSAL_MARKER].filter((marker) => write.body.includes(marker));
      expect(carried, `one comment on #${write.issue} carried ${carried.length} markers`).toHaveLength(1);
    }
  });
});
