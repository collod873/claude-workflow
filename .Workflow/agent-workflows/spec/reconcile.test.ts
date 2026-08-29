import { describe, expect, it } from "vitest";
import { createFakeStage, createFakeStages } from "../shared/stage.fake";
import { createIssueGh } from "./gh.fake";
import { runSpecReconciler, SPEC_RECONCILE_MODEL } from "./reconcile";
import { openQuestionsComment } from "./rounds";
import { runSpecCritique, SPEC_AUTHOR_ALLOWED_TOOLS } from "./spec";

const SPEC = {
  title: "PRD: A spec written in a session",
  body: "## Problem\nIt stalls.\n\n## Acceptance criteria\n- [ ] The re-export is deleted.",
};

const ANSWERS = [
  "Round 9: repoint every consumer and delete every duplicate — a re-export would leave it in place.",
  "Round 11: the check is the gauntlet, not the unit test.",
];

const REWRITTEN = "## Problem\nIt stalls.\n\n## Acceptance criteria\n- [ ] Every consumer is repointed and every duplicate deleted — check: `bin/gauntlet push`";

const reconciled = (body: string) => JSON.stringify({ body });

const SILENT_CRITIC = JSON.stringify({ findings: [] });

describe("runSpecReconciler", () => {
  it("runs on the Opus model, on the author's own toolbelt, with its prompt on stdin", async () => {
    // The author's allow list rather than the critic's open belt (ADR-0060): this stage writes
    // spec prose, so it reads the repository and must reach no second source of intent.
    const fake = createFakeStage(reconciled(REWRITTEN));

    await runSpecReconciler(fake.exec, { ...SPEC, answers: ANSWERS });

    expect(fake.calls).toHaveLength(1);
    const [argv] = fake.calls;
    expect(argv[argv.indexOf("--model") + 1]).toBe(SPEC_RECONCILE_MODEL);
    expect(argv[argv.indexOf("--allowedTools") + 1]).toBe(SPEC_AUTHOR_ALLOWED_TOOLS.join(","));
    // Via stdin, not argv: a spec body plus every comment on it has no upper bound, and a single
    // argv element is capped at 128 KiB.
    expect(fake.stdins[0]).toContain(SPEC.body);
  });

  it("substitutes the spec's title and body and every answer into the prompt", async () => {
    const fake = createFakeStage(reconciled(REWRITTEN));

    await runSpecReconciler(fake.exec, { ...SPEC, answers: ANSWERS });

    const prompt = fake.stdins[0] ?? "";
    expect(prompt).toContain(SPEC.title);
    expect(prompt).toContain(SPEC.body);
    for (const answer of ANSWERS) expect(prompt).toContain(answer);
    expect(prompt).not.toContain("{{");
  });

  it("returns the rewritten body, unwrapped", async () => {
    const fake = createFakeStage(reconciled(REWRITTEN));

    await expect(runSpecReconciler(fake.exec, { ...SPEC, answers: ANSWERS })).resolves.toBe(
      REWRITTEN,
    );
  });

  it("refuses an empty body rather than writing one over the spec", async () => {
    // The one answer this stage may never give: `updateSpec` would blank the issue with it, and
    // there is no round left in which anyone would notice.
    const fake = createFakeStage(reconciled(""));

    await expect(runSpecReconciler(fake.exec, { ...SPEC, answers: ANSWERS })).rejects.toThrow();
  });
});

/**
 * ADR-0100's second consequence, checked where the chain is: the count was taken against the text
 * the owner answered, so the rewrite is the *last* thing a clearing run spends a model on. A critic
 * re-reading it could raise a fresh finding and re-hold a spec the owner has already cleared, with
 * no round left for him to answer it in.
 */
describe("the reconciler is the end of a clearing run", () => {
  it("runs no critic stage after it", async () => {
    const gh = createIssueGh((fields) =>
      fields === "title,body"
        ? JSON.stringify(SPEC)
        : fields === "comments"
          ? JSON.stringify({ comments: [{ body: openQuestionsComment(["what?"]) }, { body: ANSWERS[0] }] })
          : undefined,
    ).gh;
    const fake = createFakeStages([SILENT_CRITIC, reconciled(REWRITTEN)]);

    await runSpecCritique(fake.exec, gh, 194);

    // Two stages, and the reconciler is the second: it is the only one of the two carrying the
    // author's allow list, so the argvs say which ran in which order without either being named.
    expect(fake.calls).toHaveLength(2);
    expect(fake.calls[0]).not.toContain("--allowedTools");
    expect(fake.calls[1]).toContain("--allowedTools");
  });
});
