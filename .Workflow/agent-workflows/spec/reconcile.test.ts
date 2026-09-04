import { describe, expect, it } from "vitest";
import { extractCriteria } from "../shared/ticket-shape";
import { createFakeStage, createFakeStages } from "../shared/stage.fake";
import { createIssueGh } from "./gh.fake";
import { runSpecReconciler, SPEC_RECONCILE_MODEL } from "./reconcile";
import { runSpecCritique, SPEC_AUTHOR_ALLOWED_TOOLS } from "./spec";

const SPEC = {
  title: "PRD: A spec written in a session",
  body:
    "## Problem\nIt stalls.\n\n## Acceptance criteria\n- [ ] The re-export is deleted.\n- [ ] The consumer is repointed.",
};

const RESOLUTIONS = [
  {
    decision: "Repoint every consumer and delete every duplicate; a re-export would leave it in place.",
    reason: "The restatement already rules out keeping a compatibility shim.",
  },
  {
    decision: "The check is the gauntlet, not the unit test.",
    reason: "Only the gauntlet observes the whole tree the criterion is actually about.",
  },
];

const REWRITTEN =
  "## Problem\nIt stalls.\n\n## Acceptance criteria\n- [ ] Every consumer is repointed and every duplicate deleted — check: `make gate`\n- [ ] The check is the gauntlet, not a unit test — check: `make gate`\n\n## Assumptions\n\n- **Repoint every consumer and delete every duplicate.** The restatement already rules out keeping a compatibility shim.";

const RECONCILED =
  "## Problem\nIt stalls.\n\n## Acceptance criteria\n- [ ] Every consumer is repointed and every duplicate deleted — check: `make gate`\n- [ ] The check is the gauntlet, not a unit test — check: `make gate`\n\n## Assumptions\n\n" +
  "- **Repoint every consumer and delete every duplicate; a re-export would leave it in place.** The restatement already rules out keeping a compatibility shim.\n" +
  "- **The check is the gauntlet, not the unit test.** Only the gauntlet observes the whole tree the criterion is actually about.";

const reconciled = (body: string) => JSON.stringify({ body });

describe("runSpecReconciler", () => {
  it("runs on the Opus model, on the author's own toolbelt, with its prompt on stdin", async () => {
    const fake = createFakeStage(reconciled(REWRITTEN));

    await runSpecReconciler(fake.exec, { ...SPEC, resolutions: RESOLUTIONS });

    expect(fake.calls).toHaveLength(1);
    const [argv] = fake.calls;
    expect(argv[argv.indexOf("--model") + 1]).toBe(SPEC_RECONCILE_MODEL);
    expect(argv[argv.indexOf("--allowedTools") + 1]).toBe(SPEC_AUTHOR_ALLOWED_TOOLS.join(","));
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
    const fake = createFakeStage(reconciled(REWRITTEN));

    await expect(
      runSpecReconciler(fake.exec, { ...SPEC, resolutions: RESOLUTIONS }),
    ).resolves.toBe(RECONCILED);
  });

  it("refuses an empty body rather than writing one over the spec", async () => {
    const fake = createFakeStage(reconciled(""));

    await expect(
      runSpecReconciler(fake.exec, { ...SPEC, resolutions: RESOLUTIONS }),
    ).rejects.toThrow();
  });

  describe("the never-drop bound", () => {
    it("refuses a rewrite that comes back with fewer checkbox lines than it was given", async () => {
      const shorter =
        "## Problem\nIt stalls.\n\n## Acceptance criteria\n- [ ] Every consumer is repointed — check: `make gate`";
      const fake = createFakeStage(reconciled(shorter));

      await expect(
        runSpecReconciler(fake.exec, { ...SPEC, resolutions: RESOLUTIONS }),
      ).rejects.toThrow();
    });

    it("keeps criteria matchable verbatim against the body after a rewrite", async () => {
      const fake = createFakeStage(reconciled(REWRITTEN));

      const body = await runSpecReconciler(fake.exec, { ...SPEC, resolutions: RESOLUTIONS });

      expect(extractCriteria(body)).toEqual([
        "Every consumer is repointed and every duplicate deleted — check: `make gate`",
        "The check is the gauntlet, not a unit test — check: `make gate`",
      ]);
    });
  });
});

describe("the reconciler is the end of a clearing run", () => {
  it("runs no critic stage after it", async () => {
    const gh = createIssueGh((fields) =>
      fields === "title,body" ? JSON.stringify(SPEC) : fields === "comments" ? JSON.stringify({ comments: [] }) : undefined,
    ).gh;
    const critiqued = JSON.stringify({ resolutions: RESOLUTIONS });
    const fake = createFakeStages([critiqued, reconciled(REWRITTEN)]);

    await runSpecCritique(fake.exec, gh, 194);

    expect(fake.calls).toHaveLength(2);
    expect(fake.calls[0]).not.toContain("--allowedTools");
    expect(fake.calls[1]).toContain("--allowedTools");
  });
});
