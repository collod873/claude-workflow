import { copyFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BIN, SAVED_PR, execute, git, heard, saving, scratch, script } from "./scenarios.ts";

function savedWithAutoMerge<Saved extends ReturnType<typeof saving>>(saved: Saved, opening: RegExp[]): Saved {
  expect(heard(saved.run())).toEqual({ status: 0, stderr: "", lines: [expect.stringContaining(SAVED_PR)] });
  expect(saved.pushed()).toBe(saved.built);
  expect(saved.calls()).toEqual([
    [expect.stringMatching(/^issue view 726\b/), saved.built],
    ...opening.map((call) => [expect.stringMatching(call), saved.built]),
    [expect.stringMatching(/^pr merge ticket\/726 --auto .*--match-head-commit [0-9a-f]{40}$/), saved.built],
  ]);
  return saved;
}

describe("the save step pushes the branch before anything can refuse it, and opens the PR red or green (#726)", () => {
  it("pushes the build as it stands past a gate that refuses it and a main that moved on, then opens the PR with auto-merge on", () => {
    const { session, built, judged } = savedWithAutoMerge(saving(), [/^pr create .*--base main --head ticket\/726\b/]);

    expect(git(session, "rev-parse", "HEAD")).toBe(built);
    expect(judged()).toBe(false);
  });

  it("keeps the PR already open for the branch, with auto-merge on at the new head", () => {
    savedWithAutoMerge(saving({ alreadyOpen: true }), [/^pr create .*--head ticket\/726\b/, /^pr view ticket\/726\b/]);
  });

  it("says one line naming the branch it kept, and opens nothing, when the push fails", () => {
    const { run, pushed, calls } = saving({ remoteRefuses: "the remote refuses every push" });

    const result = run();

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr.trimEnd().split("\n")).toEqual([expect.stringContaining("ticket/726")]);
    expect(result.stderr).toMatch(/kept/);
    expect(pushed()).toBe("");
    expect(calls()).toEqual([]);
  });
});

describe("bin/save asks spelled for the ticket branch prefix (#1121)", () => {
  it("pushes and opens nothing when spelled cannot answer", () => {
    const root = scratch("save-unspelled-");
    script(join(root, "bin", "spelled"), "printf 'node: not found\\n' >&2\nexit 127\n");
    copyFileSync(join(BIN, "save"), join(root, "bin", "save"));
    for (const tool of ["git", "gh"]) script(join(root, "bin", tool), `printf '%s\\n' "$*" >>"${join(root, "calls")}"\n`);

    expect(execute(join(root, "bin", "save"), root, { PATH: `${join(root, "bin")}:${process.env.PATH}` }, ["726"])).toEqual({
      status: 1,
      stdout: "",
      stderr: "save: the branch prefix could not be read: node: not found\n",
    });
    expect(existsSync(join(root, "calls"))).toBe(false);
  });
});

describe("bin/save's red exits name the stop the builder reads (#835)", () => {
  it("a push is refused leaves a save log whose first line names the push is refused row", () => {
    const { run, log } = saving({ remoteRefuses: "the remote refuses every push" });

    const result = run();

    expect(result.status).toBe(1);
    expect(log().split("\n")[0]).toBe("1 refusals, stopped at: Save: the push is refused");
  });

  it("a PR that is not open with auto-merge on leaves a save log whose first line names that row", () => {
    const { run, log } = saving({ autoMergeRefused: true });

    const result = run();

    expect(result.status).toBe(1);
    expect(log().split("\n")[0]).toBe("1 refusals, stopped at: Save: the PR is not open with auto-merge on");
  });
});

describe("bin/save names auto-merge off as the repo's fault, not the ticket's (#1150)", () => {
  it("exits 3 with one line naming the repo and bin/enrol, and its log names the stop, when GitHub refuses auto-merge for the repo", () => {
    const { session, log } = saving({ autoMergeOff: true });

    const result = execute(join(BIN, "save"), session, { PATH: `${join(session, "..", "bin")}:${process.env.PATH}`, GH_REPO: "collod873/Lumaria" }, ["726"]);

    expect(result.status).toBe(3);
    expect(result.stderr.trimEnd().split("\n")).toEqual(["save: #726's PR is open, but collod873/Lumaria has auto-merge off, the repo's fault and not the ticket's: run bin/enrol collod873/Lumaria"]);
    expect(log().split("\n")[0]).toBe("1 refusals, stopped at: Save: the repo has auto-merge off");
  });
});

describe("bin/save's consent-only quote (meter) reads the ticket's last > passage under Why (#906)", () => {
  it("puts a consent-only quote (meter) line on the PR, quoting the passage and its word count, when the ticket's last > passage under Why is 5 words or fewer", () => {
    const { run, prBody } = saving({
      why: [
        "The owner proposed a plan and later confirmed it:",
        "",
        "> The assistant proposed building a consent-only quote meter that flags short trailing quotes as likely consent",
        "> rather than intent, spanning this single passage across two consecutive quoted lines held together",
        "",
        "> ok do those",
      ].join("\n"),
    });

    expect(run().status).toBe(0);
    const line = (prBody() ?? "").split("\n").find((row) => row.startsWith("consent-only quote (meter): would refuse,"));
    expect(line).toBeDefined();
    expect(line).toContain("ok do those");
    expect(line).toMatch(/\b3\b/);
    expect(line).toMatch(/\bwords?\b/);
  });

  it("says the quote carries intent, would refuse nothing, when the last > passage is over 5 words, or Why has no > passage at all", () => {
    const long = saving({
      why: ["The owner, in session:", "", "> Let's ship the whole consent meter feature by the end of this week please"].join("\n"),
    });

    expect(long.run().status).toBe(0);
    expect(long.prBody() ?? "").toContain("consent-only quote (meter): would refuse nothing");

    const none = saving({
      why: 'The owner, in session: "this quotes only inline, never a > line, so Why carries no passage at all".',
    });

    expect(none.run().status).toBe(0);
    expect(none.prBody() ?? "").toContain("consent-only quote (meter): would refuse nothing");
  });
});
