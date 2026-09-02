import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFakeGit, type FakeGit } from "../shared/git.fake";
import { createRecordingGh } from "../shared/gh.fake";
import { createFakeStage, type FakeStage } from "../shared/stage.fake";
import { RATIFICATION_DUE_DISPATCH_ACTION } from "./dispatch";
import { runRatify, ratifierBranchName } from "./run-ratify";
import { ratifierVerdict } from "./verdict.fixture";

const silent = () => {};

describe("runRatify — scope: which dispatches this lane runs on at all", () => {
  it("makes no git or model call when the dispatch is not a ratification-due", async () => {
    const git = createFakeGit();
    const stage = createFakeStage("");

    const outcome = await runRatify({
      git: git.git,
      gh: createRecordingGh().gh,
      exec: stage.exec,
      repoDir: "/repo",
      head: "headsha",
      prdClosed: false,
      prBase: "main",
      eventAction: "session-captured",
      log: silent,
    });

    expect(outcome).toEqual({ action: "skipped", code: "not-a-ratification-dispatch", releasedCount: 0 });
    expect(git.calls).toEqual([]);
    expect(stage.calls).toEqual([]);
  });

  it("spends no model when the trigger has not fired, and leaves the bookmark where it was", async () => {
    const stage = createFakeStage("");
    // No bookmark, no observation notes, no PRD close — nothing has accumulated.
    const git = createFakeGit(() => "");

    const outcome = await runRatify({
      git: git.git,
      gh: createRecordingGh().gh,
      exec: stage.exec,
      repoDir: "/repo",
      head: "headsha",
      prdClosed: false,
      prBase: "main",
      eventAction: RATIFICATION_DUE_DISPATCH_ACTION,
      log: silent,
    });

    expect(outcome).toEqual({ action: "skipped", code: "not-due", releasedCount: 0 });
    expect(stage.calls).toEqual([]);
    expect(git.calls.some((argv) => argv.includes("update-ref"))).toBe(false);
  });

  it("advances the bookmark without opening anything when memory has already decided everything", async () => {
    const stage = createFakeStage("");
    // A PRD close fires the trigger on its own; every read answers empty, so no finding survives.
    const git = createFakeGit(() => "");

    const outcome = await runRatify({
      git: git.git,
      gh: createRecordingGh().gh,
      exec: stage.exec,
      repoDir: "/repo",
      head: "headsha",
      prdClosed: true,
      prBase: "main",
      eventAction: RATIFICATION_DUE_DISPATCH_ACTION,
      log: silent,
    });

    expect(outcome).toEqual({ action: "ran", code: "nothing-to-ratify", releasedCount: 0 });
    expect(stage.calls).toEqual([]);
    expect(git.calls.filter((argv) => argv.includes("update-ref"))).toEqual([
      ["-C", "/repo", "update-ref", "refs/ratifier/last", "headsha"],
    ]);
  });
});

/**
 * One finding as a note carries it on the wire. Spelled here rather than
 * imported from `observations/`: what these tests fabricate is git-log output,
 * the same as the commit hashes around it, and the module-boundary gate keeps
 * this lane out of that one (`docs/agents/module-boundaries.md`).
 */
interface NotedFinding {
  finding: string;
  lens: string;
  sites: string[];
  released: boolean;
}

/** A released finding, since an unreleased one never reaches this lane at all. */
function noted(overrides: Partial<NotedFinding> & { finding: string }): NotedFinding {
  return { lens: "PROPOSED", sites: ["a.ts:1"], released: true, ...overrides };
}

/**
 * One `git log --notes=observations` answer, in the `%H\x1f%N\x1e` shape
 * `readObservations` parses, notes newest first as git hands them back.
 */
function observationLog(notes: Array<{ commit: string; observations: NotedFinding[] }>): string {
  return notes.map((note) => `${note.commit}\x1f${JSON.stringify(note.observations)}\x1e`).join("");
}

/**
 * A repo whose range carries `notes`, whose every site's file still exists,
 * and whose ratification memory is empty — so what reaches the batch is
 * decided by `releasedObservations` alone.
 */
function repoCarrying(notes: Array<{ commit: string; observations: NotedFinding[] }>) {
  return createFakeGit((args) => {
    if (args.includes("rev-parse")) return "basesha\n";
    if (args.some((arg) => arg === "--notes=observations")) return observationLog(notes);
    return "";
  });
}

/** A stage that rejects whatever it is handed — every finding skips, nothing lands, nothing pushes. */
const rejecting = () =>
  createFakeStage(
    JSON.stringify(ratifierVerdict({ verdict: "reject", landedAs: undefined, fallback: undefined, reason: "no" })),
  );

/** The one due-and-fired run these three tests differ only in the notes they hand it. */
function ratifyDueRun(git: FakeGit, stage: FakeStage, repoDir: string) {
  return runRatify({
    git: git.git,
    gh: createRecordingGh().gh,
    exec: stage.exec,
    repoDir,
    head: "headsha",
    prdClosed: true,
    prBase: "main",
    eventAction: RATIFICATION_DUE_DISPATCH_ACTION,
    log: silent,
  });
}

describe("runRatify — which notes in the range the batch actually sees (#324)", () => {
  // `runRatify` reads `CODING_STANDARDS.md` off the real filesystem, so these need a real
  // directory — the git seam is still the fake's, since none of this is about git plumbing.
  let repoDir: string;
  beforeEach(() => {
    repoDir = mkdtempSync(join(tmpdir(), "run-ratify-"));
    writeFileSync(join(repoDir, "CODING_STANDARDS.md"), "# Coding Standards\n\n## Standards\n");
  });
  afterEach(() => rmSync(repoDir, { recursive: true, force: true }));

  it("batches a VIOLATION from every note in the range, not just the newest", async () => {
    const git = repoCarrying([
      { commit: "newsha", observations: [noted({ finding: "restated in new.ts", lens: "VIOLATION", sites: ["new.ts:1"] })] },
      { commit: "oldsha", observations: [noted({ finding: "restated in old.ts", lens: "VIOLATION", sites: ["old.ts:1"] })] },
    ]);
    const stage = rejecting();

    const outcome = await ratifyDueRun(git, stage, repoDir);

    // Nothing folds VIOLATION forward between notes, so reading the nearest note alone would hand
    // the batch one of the two the trigger counted — and the bookmark advances past both either way.
    expect(outcome.releasedCount).toBe(2);
    expect(stage.calls).toHaveLength(2);
    const prompts = stage.stdins.join("\n");
    expect(prompts).toContain("old.ts:1");
    expect(prompts).toContain("new.ts:1");
  });

  it("takes PROPOSED from the nearest note alone, because the two-site gate already folded it forward", async () => {
    const git = repoCarrying([
      { commit: "newsha", observations: [noted({ finding: "a pattern", sites: ["a.ts:1", "b.ts:2"] })] },
      // The same finding as the nearest note carries, at the site list it has since superseded.
      { commit: "oldsha", observations: [noted({ finding: "a pattern", sites: ["a.ts:1"] })] },
    ]);
    const stage = rejecting();

    await ratifyDueRun(git, stage, repoDir);

    expect(stage.calls).toHaveLength(1);
    expect(stage.stdins.join("\n")).toContain("b.ts:2");
  });

  it("names a VIOLATION once when two notes in the range carry it at the same site", async () => {
    const repeated = noted({ finding: "restated", lens: "VIOLATION", sites: ["a.ts:1"] });
    const git = repoCarrying([
      { commit: "newsha", observations: [repeated] },
      { commit: "oldsha", observations: [repeated] },
    ]);
    const stage = rejecting();

    await ratifyDueRun(git, stage, repoDir);

    expect(stage.calls).toHaveLength(1);
  });
});

describe("ratifierBranchName", () => {
  it("names the branch for the head it scoped through, so two runs never collide", () => {
    expect(ratifierBranchName("0123456789abcdef0123")).toBe("ratify/0123456789ab");
  });
});

describe("ratify.yml agrees with the dispatch action it is a copy of", () => {
  const workflow = readFileSync(
    fileURLToPath(new URL("../../../.github/workflows/ratify.yml", import.meta.url)),
    "utf8",
  );
  // #315 (ADR-0055): ratify.yml is a reusable workflow now — the trigger itself lives in
  // ratify-caller.yml, and ratify.yml carries only `workflow_call`.
  const caller = readFileSync(
    fileURLToPath(new URL("../../../.github/workflows/ratify-caller.yml", import.meta.url)),
    "utf8",
  );

  it("is a reusable workflow, triggered by ratify-caller.yml's own trigger", () => {
    expect(workflow).toMatch(/^"on":\s*\n\s*workflow_call:/m);
  });

  it("filters its trigger to this lane's one action (ADR-0090), not every dispatch", () => {
    expect(caller).toMatch(
      new RegExp(`repository_dispatch:\\s*\\n\\s*types: \\[${RATIFICATION_DUE_DISPATCH_ACTION}\\]`),
    );
  });

  it("gates the job on the same action the entrypoint checks", () => {
    expect(workflow).toContain(`action == '${RATIFICATION_DUE_DISPATCH_ACTION}'`);
  });

  it("names the entrypoint, which is also what makes this lane reachable to the wiring gate", () => {
    expect(workflow).toContain("agent-workflows/ratify/run-ratify.ts");
  });
});
