import { beforeEach, describe, expect, it } from "vitest";
import { isolateCheckpointsPerTest } from "../shared/isolate-checkpoints.setup";
import { extractCriteria } from "../shared/ticket-shape";
import { createFakeStage, createFakeStages } from "../shared/stage.fake";
import { createIssueGh } from "./gh.fake";
import { runSpecReconciler, SPEC_RECONCILE_MODEL } from "./reconcile";
import { runSpecCritique, SPEC_AUTHOR_ALLOWED_TOOLS } from "./spec";

// Several tests in this file reconcile the same `SPEC` against the same
// `RESOLUTIONS`, so more than one call renders the same substituted prompt
// for the "reconcile" stage — without a fresh CHECKPOINTS_DIR per test, a
// later test would silently reuse an earlier test's checkpointed answer. See
// `isolateCheckpointsPerTest`'s own comment.
beforeEach(() => {
  isolateCheckpointsPerTest();
});

const SPEC = {
  title: "PRD: A spec written in a session",
  body:
    "## Problem\nIt stalls.\n\n## Acceptance criteria\n- [ ] The re-export is deleted.\n- [ ] The consumer is repointed.",
};

const RESOLUTIONS = [
  {
    decision: "Repoint every consumer and delete every duplicate — a re-export would leave it in place.",
    reason: "The restatement already rules out keeping a compatibility shim.",
  },
  {
    decision: "The check is the gauntlet, not the unit test.",
    reason: "Only the gauntlet observes the whole tree the criterion is actually about.",
  },
];

/** The prose the model hands back — carrying a partial assumptions section of its own. */
const REWRITTEN =
  "## Problem\nIt stalls.\n\n## Acceptance criteria\n- [ ] Every consumer is repointed and every duplicate deleted — check: `bin/gauntlet push`\n- [ ] The check is the gauntlet, not a unit test — check: `bin/gauntlet push`\n\n## Assumptions\n\n- **Repoint every consumer and delete every duplicate.** The restatement already rules out keeping a compatibility shim.";

/**
 * What the stage resolves to: the model's prose, with the assumptions section rewritten from the
 * resolutions themselves. The model listed one of the two it was handed, which is exactly the
 * fail-open the section is written in code to close.
 */
const RECONCILED =
  "## Problem\nIt stalls.\n\n## Acceptance criteria\n- [ ] Every consumer is repointed and every duplicate deleted — check: `bin/gauntlet push`\n- [ ] The check is the gauntlet, not a unit test — check: `bin/gauntlet push`\n\n## Assumptions\n\n" +
  "- **Repoint every consumer and delete every duplicate — a re-export would leave it in place.** The restatement already rules out keeping a compatibility shim.\n" +
  "- **The check is the gauntlet, not the unit test.** Only the gauntlet observes the whole tree the criterion is actually about.";

const reconciled = (body: string) => JSON.stringify({ body });

describe("runSpecReconciler", () => {
  it("runs on the Opus model, on the author's own toolbelt, with its prompt on stdin", async () => {
    // The author's allow list rather than the critic's open belt (ADR-0060).
    const fake = createFakeStage(reconciled(REWRITTEN));

    await runSpecReconciler(fake.exec, { ...SPEC, resolutions: RESOLUTIONS });

    expect(fake.calls).toHaveLength(1);
    const [argv] = fake.calls;
    expect(argv[argv.indexOf("--model") + 1]).toBe(SPEC_RECONCILE_MODEL);
    expect(argv[argv.indexOf("--allowedTools") + 1]).toBe(SPEC_AUTHOR_ALLOWED_TOOLS.join(","));
    // Via stdin, not argv: a spec body plus every resolution on it has no upper bound, and a single
    // argv element is capped at 128 KiB.
    expect(fake.stdins[0]).toContain(SPEC.body);
  });

  it("substitutes the spec's title, body and every resolution's decision and reason into the prompt", async () => {
    const fake = createFakeStage(reconciled(REWRITTEN));

    await runSpecReconciler(fake.exec, { ...SPEC, resolutions: RESOLUTIONS });

    const prompt = fake.stdins[0] ?? "";
    expect(prompt).toContain(SPEC.title);
    expect(prompt).toContain(SPEC.body);
    for (const resolution of RESOLUTIONS) {
      expect(prompt).toContain(resolution.decision);
      expect(prompt).toContain(resolution.reason);
    }
    expect(prompt).not.toContain("{{");
  });

  it("returns the rewritten body unwrapped, with the assumptions section written from the resolutions", async () => {
    // The model listed one of the two resolutions it was handed. The section that comes back
    // carries both, because it is derived from the input rather than requested of the model —
    // the same treatment the never-drop bound gets, and for the same reason: there is no owner
    // reading the output to notice a missing line.
    const fake = createFakeStage(reconciled(REWRITTEN));

    await expect(
      runSpecReconciler(fake.exec, { ...SPEC, resolutions: RESOLUTIONS }),
    ).resolves.toBe(RECONCILED);
  });

  it("refuses an empty body rather than writing one over the spec", async () => {
    // The one answer this stage may never give: `updateSpec` would blank the issue with it, and
    // there is no reader left to notice.
    const fake = createFakeStage(reconciled(""));

    await expect(
      runSpecReconciler(fake.exec, { ...SPEC, resolutions: RESOLUTIONS }),
    ).rejects.toThrow();
  });

  describe("the never-drop bound", () => {
    it("refuses a rewrite that comes back with fewer checkbox lines than it was given", async () => {
      const shorter =
        "## Problem\nIt stalls.\n\n## Acceptance criteria\n- [ ] Every consumer is repointed — check: `bin/gauntlet push`";
      const fake = createFakeStage(reconciled(shorter));

      // Handed two criteria, the fake stage answers with one — the arithmetic bound (`countCriteria`
      // before and after) is what refuses this, not a promise stated only in the prompt.
      await expect(
        runSpecReconciler(fake.exec, { ...SPEC, resolutions: RESOLUTIONS }),
      ).rejects.toThrow();
    });

    it("keeps criteria matchable verbatim against the body after a rewrite", async () => {
      const fake = createFakeStage(reconciled(REWRITTEN));

      const body = await runSpecReconciler(fake.exec, { ...SPEC, resolutions: RESOLUTIONS });

      expect(extractCriteria(body)).toEqual([
        "Every consumer is repointed and every duplicate deleted — check: `bin/gauntlet push`",
        "The check is the gauntlet, not a unit test — check: `bin/gauntlet push`",
      ]);
    });
  });
});

/**
 * ADR-0100's second consequence, checked where the chain is: the critic's resolutions are the ground
 * truth the rewrite folds in, so the rewrite is the *last* thing a clearing run spends a model on. A
 * critic re-reading it could resolve something fresh and re-open a spec this run already settled.
 */
describe("the reconciler is the end of a clearing run", () => {
  it("runs no critic stage after it", async () => {
    const gh = createIssueGh((fields) =>
      fields === "title,body" ? JSON.stringify(SPEC) : fields === "comments" ? JSON.stringify({ comments: [] }) : undefined,
    ).gh;
    const critiqued = JSON.stringify({ resolutions: RESOLUTIONS });
    const fake = createFakeStages([critiqued, reconciled(REWRITTEN)]);

    await runSpecCritique(fake.exec, gh, 194);

    // Two stages, and the reconciler is the second: it is the only one of the two carrying the
    // author's allow list, so the argvs say which ran in which order without either being named.
    expect(fake.calls).toHaveLength(2);
    expect(fake.calls[0]).not.toContain("--allowedTools");
    expect(fake.calls[1]).toContain("--allowedTools");
  });
});
