import { copyFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { HELD } from "./spelled.ts";
import { BIN, SAVED_PR, execute, git, heard, saving, scratch, script } from "./scenarios.ts";

function savedWithAutoMerge<Saved extends ReturnType<typeof saving>>(saved: Saved, opening: RegExp[]): Saved {
  expect(heard(saved.run())).toEqual({ status: 0, stderr: "", lines: [expect.stringContaining(SAVED_PR)] });
  expect(saved.pushed()).toBe(saved.built);
  const calls = saved.calls();
  expect(calls.map(([, head]) => head)).toEqual(calls.map(() => saved.built));
  expect(calls[0]?.[0]).toMatch(new RegExp(`^api -X POST repos/{owner}/{repo}/statuses/${saved.built} .*-f state=success -f context=check\\b`));
  for (const call of opening) expect(calls.some(([said]) => call.test(said ?? ""))).toBe(true);
  expect(calls.at(-1)?.[0]).toMatch(/^pr merge ticket\/726 --auto .*--match-head-commit [0-9a-f]{40}$/);
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
    const { run, pushed, calls, log } = saving({ remoteRefuses: "the remote refuses every push" });

    const result = run();

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr.trimEnd().split("\n")).toEqual([expect.stringContaining("ticket/726")]);
    expect(result.stderr).toMatch(/kept/);
    expect(pushed()).toBe("");
    expect(calls()).toEqual([]);
    expect(log().split("\n")[0]).toBe("1 refusals, stopped at: Save: the push is refused");
  });
});

describe("bin/save posts the builder's green check as the pushed head's check status, the whole check a ticket PR merges on, once the push has put the head on GitHub (#1345)", () => {
  it("posts no status when the builder says the check left steps to the repo's own CI, so that CI's check is the one GitHub waits for", () => {
    const saved = saving();

    const result = saved.run("726", "--unjudged");

    expect(result.status, result.stderr).toBe(0);
    expect(saved.pushed()).toBe(saved.built);
    expect(saved.calls().some(([call]) => call?.startsWith("api -X POST") === true)).toBe(false);
    expect(saved.calls().some(([call]) => call?.startsWith("pr merge") === true)).toBe(true);
  });

  it("ends red naming the stop, with the branch pushed and no PR opened, when GitHub refuses the status, since a head without it never merges", () => {
    const saved = saving({ statusRefused: true });

    const result = saved.run();

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr.trimEnd().split("\n")).toEqual([expect.stringMatching(/^save: #726 pushed to ticket\/726, but its green check could not be posted as the status its PR merges on; log /)]);
    expect(saved.pushed()).toBe(saved.built);
    expect(saved.calls().some(([call]) => call?.startsWith("pr create") === true)).toBe(false);
    expect(saved.log().split("\n")[0]).toBe("1 refusals, stopped at: Save: the check status is refused");
  });
});

describe("bin/save leaves auto-merge off on a held ticket's PR, so a paused or stuck ticket never merges (#1174)", () => {
  it.each(HELD)("opens the PR of a ticket labelled %s but turns no auto-merge on, ending green in one line", (label) => {
    const saved = saving({ held: label });

    const result = saved.run();

    expect(result.status, result.stderr).toBe(0);
    expect(saved.pushed()).toBe(saved.built);
    expect(saved.calls().some(([call]) => call?.startsWith("pr create") === true)).toBe(true);
    expect(saved.calls().some(([call]) => call?.startsWith("pr merge") === true)).toBe(false);
    expect(heard(result)).toEqual({ status: 0, stderr: "", lines: [expect.stringContaining(`auto-merge stays off while #726 is labelled ${label}`)] });
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

describe("bin/save puts the consent-only quote (meter) line on the PR (#906)", () => {
  it("quotes the ticket's last short > passage under Why in the PR body", () => {
    const { run, prBody } = saving({ why: ["The owner, in session:", "", "> ok do those"].join("\n") });

    expect(run().status).toBe(0);
    expect(prBody() ?? "").toContain('consent-only quote (meter): would refuse, quoting "ok do those" (3 words)');
  });
});
