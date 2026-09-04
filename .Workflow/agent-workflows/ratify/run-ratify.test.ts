import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFakeGit, type FakeGit } from "../shared/git.fake";
import { createRecordingGh } from "../shared/gh.fake";
import { createFakeStage, type FakeStage } from "../shared/stage.fake";
import { observation } from "../shared/observation.fixture";
import type { Observation } from "../shared/observation-schema";
import { RATIFICATION_DUE_DISPATCH_ACTION } from "../shared/ratification-dispatch";
import { runRatify, ratifierBranchName } from "./run-ratify";
import { ratifierVerdict } from "./verdict.fixture";

const silent = () => {};

async function ratifyDue(overrides: { prdClosed: boolean }) {
  const stage = createFakeStage("");
  const git = createFakeGit(() => "");

  const outcome = await runRatify({
    git: git.git,
    gh: createRecordingGh().gh,
    exec: stage.exec,
    repoDir: "/repo",
    head: "headsha",
    prBase: "main",
    eventAction: RATIFICATION_DUE_DISPATCH_ACTION,
    log: silent,
    ...overrides,
  });

  return { outcome, git, stage };
}

describe("runRatify: scope: which dispatches this lane runs on at all", () => {
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
    const { outcome, git, stage } = await ratifyDue({ prdClosed: false });

    expect(outcome).toEqual({ action: "skipped", code: "not-due", releasedCount: 0 });
    expect(stage.calls).toEqual([]);
    expect(git.calls.some((argv) => argv.includes("update-ref"))).toBe(false);
  });

  it("advances the bookmark without opening anything when memory has already decided everything", async () => {
    const { outcome, git, stage } = await ratifyDue({ prdClosed: true });

    expect(outcome).toEqual({ action: "ran", code: "nothing-to-ratify", releasedCount: 0 });
    expect(stage.calls).toEqual([]);
    expect(git.calls.filter((argv) => argv.includes("update-ref"))).toEqual([
      ["-C", "/repo", "update-ref", "refs/ratifier/last", "headsha"],
    ]);
  });
});

function observationLog(notes: Array<{ commit: string; observations: Observation[] }>): string {
  return notes.map((note) => `${note.commit}\x1f${JSON.stringify(note.observations)}\x1e`).join("");
}

function repoCarrying(notes: Array<{ commit: string; observations: Observation[] }>) {
  return createFakeGit((args) => {
    if (args.includes("rev-parse")) return "basesha\n";
    if (args.some((arg) => arg === "--notes=observations")) return observationLog(notes);
    return "";
  });
}

const rejecting = () =>
  createFakeStage(
    JSON.stringify(ratifierVerdict({ verdict: "reject", landedAs: undefined, fallback: undefined, reason: "no" })),
  );

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

describe("runRatify: which notes in the range the batch actually sees (#324)", () => {
  let repoDir: string;
  beforeEach(() => {
    repoDir = mkdtempSync(join(tmpdir(), "run-ratify-"));
    writeFileSync(join(repoDir, "CODING_STANDARDS.md"), "# Coding Standards\n\n## Standards\n");
  });
  afterEach(() => rmSync(repoDir, { recursive: true, force: true }));

  it("batches a VIOLATION from every note in the range, not just the newest", async () => {
    const git = repoCarrying([
      {
        commit: "newsha",
        observations: [observation({ finding: "restated in new.ts", lens: "VIOLATION", sites: ["new.ts:1"], released: true })],
      },
      {
        commit: "oldsha",
        observations: [observation({ finding: "restated in old.ts", lens: "VIOLATION", sites: ["old.ts:1"], released: true })],
      },
    ]);
    const stage = rejecting();

    const outcome = await ratifyDueRun(git, stage, repoDir);

    expect(outcome.releasedCount).toBe(2);
    expect(stage.calls).toHaveLength(2);
    const prompts = stage.stdins.join("\n");
    expect(prompts).toContain("old.ts:1");
    expect(prompts).toContain("new.ts:1");
  });

  it("takes PROPOSED from the nearest note alone, because the two-site gate already folded it forward", async () => {
    const git = repoCarrying([
      { commit: "newsha", observations: [observation({ finding: "a pattern", sites: ["a.ts:1", "b.ts:2"], released: true })] },
      { commit: "oldsha", observations: [observation({ finding: "a pattern", sites: ["a.ts:1"], released: true })] },
    ]);
    const stage = rejecting();

    await ratifyDueRun(git, stage, repoDir);

    expect(stage.calls).toHaveLength(1);
    expect(stage.stdins.join("\n")).toContain("b.ts:2");
  });

  it("names a VIOLATION once when two notes in the range carry it at the same site", async () => {
    const repeated = observation({ finding: "restated", lens: "VIOLATION", sites: ["a.ts:1"], released: true });
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
