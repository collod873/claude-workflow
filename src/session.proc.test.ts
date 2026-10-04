import { describe, expect, it } from "vitest";
import { sessionExtras } from "./scenarios.ts";

describe("bin/session-extras keeps what only Workflow needs at session start beside the shared launcher (#869)", () => {
  it("says nothing and installs nothing when package-lock.json did not move and no land PR is stuck", () => {
    const { npm, run } = sessionExtras();
    expect(run()).toMatchObject({ status: 0, stdout: "", stderr: "" });
    expect(npm()).toBeUndefined();
  });
  it("reinstalls the node_modules every worktree shares when main's package-lock.json moved", () => {
    const { main, npm, run } = sessionExtras({ mainMoves: "package-lock.json" });
    expect(run()).toMatchObject({ status: 0, stdout: "" });
    expect(npm()?.slice(0, 2)).toEqual([main, "ci"]);
  });
  it("leaves the shared node_modules alone while a live session is using it, and says when to reinstall", () => {
    const { npm, run } = sessionExtras({ mainMoves: "package-lock.json", live: 1 });
    const result = run();
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("package-lock.json moved while another session is open, so node_modules was not reinstalled; run npm ci in the main checkout once none is\n");
    expect(npm()).toBeUndefined();
  });
  it("says so and fails when the reinstall fails, since every worktree then shares stale node_modules", () => {
    const { run } = sessionExtras({ mainMoves: "package-lock.json", npm: "exit 1\n" });
    expect(run()).toMatchObject({ status: 1, stdout: "npm ci failed in the main checkout, so every worktree shares stale node_modules\n" });
  });
  it("names the land PRs that failed a check or conflict with main", () => {
    const { run } = sessionExtras({ gh: "[[ \"$1 $2\" == \"pr list\" ]] && printf '#12\\n#15\\n'\nexit 0\n" });
    expect(run().stdout).toBe("land PRs #12, #15 failed a check or conflict with main; ask Claude to look\n");
  });
  it("names at most eight stuck land PRs so the note stays one line", () => {
    const { run } = sessionExtras({ gh: "printf '#%s\\n' {1..12}\nexit 0\n" });
    expect(run().stdout).toBe("land PRs #1, #2, #3, #4, #5, #6, #7, #8 failed a check or conflict with main; ask Claude to look\n");
  });
  it("passes on why and fails when the land PR lookup is refused, so a refusal never reads as no stuck PRs", () => {
    const { run } = sessionExtras({ gh: "printf 'gh: authentication required\\n' >&2\nexit 4\n" });
    expect(run()).toMatchObject({ status: 1, stdout: "", stderr: "gh: authentication required\n" });
  });
});
