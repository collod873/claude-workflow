import { describe, expect, it } from "vitest";
import { runReconcile } from "../../.Workflow/agent-workflows/dispatch/reconcile";
import { createTracker, RUNNABLE_CRITERION, silent, specBody } from "./237-spec-pass.fixture";

/**
 * #237's third criterion: the pass clears the `needs-human` it wrote, and only that one.
 *
 * `needs-human` is shared pipeline vocabulary — the fix pass, the merge gate and the shape lane all
 * write it. What identifies this pass's own is the pairing: its label is always written alongside a
 * `prd-unrunnable:v1` comment, so the label comes off in the same act that rewrites that comment
 * away. A label standing on a spec whose comment is not the refusal one belongs to another lane and
 * is evidence about something else entirely.
 *
 * Both specs below now carry a runnable body; they differ only in which lane's `needs-human` they
 * are carrying.
 */

describe("#237 — the pass clears only the needs-human it wrote", () => {
  /**
   * #237, third acceptance criterion, verbatim:
   * `needs-human` this pass set clears once the body validates again; one another lane wrote is left untouched — check: `npx vitest run .Workflow/agent-workflows/dispatch/reconcile.test.ts`
   */
  it("`needs-human` this pass set clears once the body validates again; one another lane wrote is left untouched — check: `npx vitest run .Workflow/agent-workflows/dispatch/reconcile.test.ts`", () => {
    const tracker = createTracker([
      {
        number: 700,
        title: "A spec this pass refused last session, since fixed",
        body: specBody([RUNNABLE_CRITERION]),
        labels: ["prd", "needs-human"],
        comments: [
          {
            id: 7001,
            // The pass's own refusal, standing from an earlier session. The marker is spelled both
            // ways an HTML comment is written, because which spacing the constant uses is not what
            // this test is about — that the pairing is what identifies the label's owner is.
            body: [
              "The body named two criteria, so no command was run.",
              "",
              "<!-- prd-unrunnable:v1 -->",
              "<!--prd-unrunnable:v1-->",
            ].join("\n"),
          },
        ],
        children: [701],
      },
      {
        number: 800,
        title: "A spec another lane handed to a human",
        body: specBody([RUNNABLE_CRITERION]),
        labels: ["prd", "needs-human"],
        comments: [
          {
            id: 8001,
            // No marker of this pass's anywhere: the merge gate rejected the same merge twice and
            // said so. Nothing here is this pass's to clear.
            body: "The merge gate rejected the same merge twice, so a human is needed.",
          },
        ],
        children: [801],
      },
    ]);

    runReconcile({ gh: tracker.gh, log: silent });

    const ops = tracker.labelOps();

    expect(ops, "a body that validates again clears the `needs-human` this pass paired with its refusal").toContainEqual({
      issue: 700,
      label: "needs-human",
      op: "remove",
    });

    expect(
      ops.filter((op) => op.issue === 800 && op.label === "needs-human"),
      "another lane's `needs-human` is evidence about something else and is never touched here",
    ).toEqual([]);

    // The label comes off in the same act that rewrites the refusal away, so what a reader of #700
    // sees afterwards is this session's verdict and not the refusal it replaced.
    const rewritten = tracker.bodiesFor(700).join("\n---\n");
    expect(rewritten, "the one comment the pass owns is rewritten whole, to this session's verdict").toContain(
      "prd-check:v1",
    );
    expect(rewritten, "the refusal it is clearing is not left standing beside the verdict").not.toContain(
      "prd-unrunnable:v1",
    );
  });
});
