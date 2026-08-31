import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createFakeGit } from "../shared/git.fake";
import { createRecordingGh } from "../shared/gh.fake";
import { createFakeStage } from "../shared/stage.fake";
import { RATIFICATION_DUE_DISPATCH_ACTION } from "./dispatch";
import { runRatify, ratifierBranchName } from "./run-ratify";

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

  it("filters its trigger to this lane's one action (ADR-0090), not every dispatch", () => {
    expect(workflow).toMatch(
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
