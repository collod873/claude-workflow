import { describe, expect, it } from "vitest";
import { git, launching } from "./scenarios.ts";

describe("bin/session starts every session in its own worktree off a current main (#869)", () => {
  it("brings the main checkout up to date, then starts claude from it in a new worktree with the words it was given, saying nothing else", () => {
    const { remote, main, claude, npm, run } = launching();

    const result = run("--model", "opus", "look at the closer");

    expect(result).toMatchObject({ status: 0, stdout: "", stderr: "" });
    expect(git(main, "rev-parse", "HEAD")).toBe(git(remote, "rev-parse", "main"));
    expect(claude()).toEqual([main, "--model", "opus", "look at the closer", "--worktree"]);
    expect(npm()).toBeUndefined();
  });

  it("reinstalls the node_modules every worktree shares when main's package-lock.json moved", () => {
    const { main, npm, run } = launching({ mainMoves: "package-lock.json" });

    expect(run().status).toBe(0);
    expect(npm()?.slice(0, 2)).toEqual([main, "ci"]);
  });

  it("leaves the shared node_modules alone while a live session is using it, and says when to reinstall", () => {
    const { npm, run } = launching({ mainMoves: "package-lock.json", left: { "keen-yak": "held by a live session" } });

    const result = run();

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("session: package-lock.json moved while another session is open, so node_modules was not reinstalled; run npm ci in the main checkout once none is\n");
    expect(npm()).toBeUndefined();
  });

  it("names the worktrees left with uncommitted or unlanded work, passing over one a live session holds and one with nothing to land", () => {
    const { claude, run } = launching({
      left: { "bright-fox": "uncommitted", "calm-owl": "unlanded", "dry-elk": "landed", "keen-yak": "held by a live session" },
    });

    const result = run();

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("session: unlanded work left in bright-fox, calm-owl; claude -w <name> picks one up\n");
    expect(claude()).toBeDefined();
  });

  it("names the land PRs that failed a check or conflict with main", () => {
    const { run } = launching({ gh: "[[ \"$1 $2\" == \"pr list\" ]] && printf '#12\\n#15\\n'\nexit 0\n" });

    expect(run().stdout).toBe("session: land PRs #12, #15 failed a check or conflict with main; ask Claude to look\n");
  });

  it("still starts claude, and says so, when the main checkout cannot fast-forward", () => {
    const { claude, run } = launching({ diverged: true });

    const result = run();

    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/^session: the main checkout could not fast-forward to origin\/main; [^\n]*\n$/);
    expect(claude()).toBeDefined();
  });

  it("exits as claude exits", () => {
    const { run } = launching({ claude: "printf 'claude refused to start\\n' >&2\nexit 3\n" });

    expect(run()).toMatchObject({ status: 3, stderr: "claude refused to start\n" });
  });
});
