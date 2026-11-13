import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { describe, expect, it } from "vitest";
import { agedLogs, GITHUB_ERRED, landSession, MAIN_RACED, MERGE_REFUSAL as REFUSAL, TICKET_TITLE, type LandStage, type Merge } from "./land.part.ts";
import { CONTRACT, git, LANDED_PR as PR, PC_RUNS_ON, plant, settleMapOf } from "./scenarios.ts";

const JUDGED_CHECK = "description=judged by land on the commit before the push (ADR-0008)";
const DASH = "\u2014";
const OFF_THE_PC = ["name: Changelog draft", "on:", "  pull_request:", "jobs:", "  draft:", "    runs-on: ubuntu-latest", "    steps:", "      - run: ./draft", "  notes:", `    runs-on: ${PC_RUNS_ON}`, "    steps:", "      - run: ./notes", "  ship:", "    uses: collod873/claude-workflow/.github/workflows/ship.yml@main", ""].join("\n");

const sessionAheadOfMain = (commits: number, options: Omit<Parameters<typeof landSession>[0], "messages"> = {}) => landSession({ messages: Array.from({ length: commits }, (_, n) => `change ${n + 1}`), ...options });

function mainGained(root: string, remote: string, files: Record<string, string>): string {
  const other = join(root, "other");
  git(root, "clone", "--quiet", remote, other);
  git(other, "config", "user.email", "other@test");
  git(other, "config", "user.name", "other");
  for (const [file, content] of Object.entries(files)) plant(other, file, content);
  git(other, "add", "-A");
  git(other, "commit", "--quiet", "-m", "another session's change");
  git(other, "push", "--quiet", "origin", "main");
  return git(other, "rev-parse", "HEAD");
}

const landedElsewhere = (root: string, remote: string, file: string, content: string) => mainGained(root, remote, { [file]: content });

const APPENDS_PARTS = "ls parts >>derived/index";

function committedBy(session: string, message: string, files: Record<string, string>): string {
  for (const [file, content] of Object.entries(files)) plant(session, file, content);
  git(session, "add", "-A");
  git(session, "commit", "--quiet", "-m", message);
  return git(session, "rev-parse", "HEAD");
}

const leftAt = (session: string) => ({
  head: git(session, "rev-parse", "HEAD"),
  branch: git(session, "symbolic-ref", "--short", "HEAD"),
  changed: git(session, "status", "--porcelain", "--untracked-files=all"),
  rebasing: existsSync(join(session, ".git", "rebase-merge")),
});

describe("bin/land turns a session's commits into a PR it merges at once, posting the check it passed before the push as the head's status once the push has put the head on GitHub, which takes no status for a commit it lacks (#1344, #1345)", () => {
  it("opens a merge-commit PR from a land branch, posts check as judged for the head after the push and nothing else, merges matching that head, and brings local main up to the merged main (#1386)", () => {
    const { remote, session, head, branch, run, calls, merged, posted } = sessionAheadOfMain(2);

    const result = run();

    expect(result.status, result.stderr).toBe(0);
    expect(calls()).toContainEqual(["pr", "create", "--base", "main", "--head", branch, "--title", "change 2", "--body", "- change 1\n- change 2"]);
    expect(calls().filter(posted)).toEqual([
      ["api", "-X", "POST", `repos/{owner}/{repo}/statuses/${head}`, "-f", "state=success", "-f", "context=check", "-f", JUDGED_CHECK],
    ]);
    expect(calls().filter((call) => call.join(" ").includes("/rules/")), "main requires check alone, so land asks no ruleset what it requires").toEqual([]);
    expect(calls().filter(merged)).toEqual([["pr", "merge", branch, "--merge", "--match-head-commit", head]]);
    expect(git(session, "rev-parse", "HEAD")).toBe(git(remote, "rev-parse", "main"));
    expect(git(session, "rev-parse", "HEAD^2")).toBe(head);
    expect(result.stdout).toBe(`Landed ${PR}\n`);
  });

  it("lands on the repo's default branch when it is master, not main, since land is how every repo ships and Lodato-Life deploys on a push to master", () => {
    const { remote, session, head, branch, run, calls, merged } = sessionAheadOfMain(1, { defaultBranch: "master" });

    const result = run();

    expect(result.status, result.stderr).toBe(0);
    expect(calls()).toContainEqual(["pr", "create", "--base", "master", "--head", branch, "--title", "change 1", "--body", "- change 1"]);
    expect(calls().filter(merged)).toEqual([["pr", "merge", branch, "--merge", "--match-head-commit", head]]);
    expect(git(remote, "rev-parse", "master^2")).toBe(head);
    expect(git(session, "rev-parse", "master")).toBe(git(remote, "rev-parse", "master"));
    expect(result.stdout).toBe(`Landed ${PR}\n`);
  });

  it("merges the PR an earlier land left open for the same head instead of opening another, so a refused merge is landed by running land again, the one way an agent ships", () => {
    const { head, branch, run, calls, merged } = sessionAheadOfMain(1, { openPr: true });

    const result = run();

    expect(result.status, result.stderr).toBe(0);
    expect(calls().filter((call) => call[0] === "pr" && call[1] === "create")).toEqual([]);
    expect(calls().filter(merged)).toEqual([["pr", "merge", branch, "--merge", "--match-head-commit", head]]);
    expect(result.stdout).toBe(`Landed ${PR}\n`);
  });

  it("runs the full check itself when no receipt covers the commit, publishing its receipts, then posts the check and merges on green, so no agent hand-runs a check before landing (#1412)", () => {
    const { run, calls, checked, checkedAs, head, branch, merged, posted } = sessionAheadOfMain(1, { covered: false });

    const result = run();

    expect(result.status, result.stderr).toBe(0);
    expect(checked()).toEqual(["--full --covered", "--full --publish"]);
    expect(checkedAs(), "each check land runs logs land as its caller").toEqual(["land", "land"]);
    expect(calls().filter(posted).map((call) => call.at(-1))).toEqual([JUDGED_CHECK]);
    expect(calls().filter(merged)).toEqual([["pr", "merge", branch, "--merge", "--match-head-commit", head]]);
  });

  it("runs the full check on the Node the ticket repo pins, handed on as TREE_PATH, and its own scripts on the machine's, as the builder's check does (#1446)", () => {
    const { run, checkedOn, treeBin } = sessionAheadOfMain(1, { covered: false, treeNode: true });

    const result = run();

    expect(result.status, result.stderr).toBe(0);
    expect(checkedOn()).toEqual([join(treeBin, "node"), join(treeBin, "node")]);
  });

  it("keeps the coverage probe's reason in the land log when no receipt covers the commit, so a full check that ran can be traced to what was due", () => {
    const { session, head, run } = sessionAheadOfMain(1, { covered: false });

    expect(run().status).toBe(0);
    expect(readFileSync(join(session, ".git", "machine-logs", `land-${head.slice(0, 7)}-session.log`), "utf8")).toContain("check: due test");
  });

  it("pushes nothing, posts nothing and merges nothing when the full check goes red on the commit, and passes on the check's own line naming the red step, so a red landing leaves no branch on GitHub (agent-hooks#176)", () => {
    const { run, calls, checked, remote } = sessionAheadOfMain(1, { covered: false, green: false });

    const result = run();

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("check: red test; log .git/check-logs/test.log\nland: the full check went red on the commit, so nothing was pushed; fix what it names and land again\n");
    expect(checked()).toEqual(["--full --covered", "--full --publish"]);
    expect(git(remote, "for-each-ref", "--format=%(refname)")).toBe("refs/heads/main");
    expect(calls()).toEqual([]);
  });

  it("brings the main checkout, detached as the session launcher leaves it, up to the merged main when landing from a session worktree (#1309)", () => {
    const { root, remote, session: main, run } = sessionAheadOfMain(0);
    git(main, "checkout", "--quiet", "--detach");
    const worktree = join(root, "worktree");
    git(main, "worktree", "add", "--quiet", "-b", "ticket", worktree);
    writeFileSync(join(worktree, "tool"), "merged\n");
    git(worktree, "add", "tool");
    git(worktree, "commit", "--quiet", "-m", "change a tool");

    const result = run([], worktree);

    expect(result.status, result.stderr).toBe(0);
    expect(git(main, "rev-parse", "HEAD")).toBe(git(remote, "rev-parse", "main"));
    expect(readFileSync(join(main, "tool"), "utf8")).toBe("merged\n");
  });

  it("rebases the session's commits onto a main that moved since the session started, and lands them (#869)", () => {
    const { root, remote, session, run, calls, merged } = sessionAheadOfMain(1);
    const moved = landedElsewhere(root, remote, "theirs.txt", "theirs\n");

    const result = run();

    expect(result.status, result.stderr).toBe(0);
    const rebased = git(remote, "rev-parse", "main^2");
    expect(git(remote, "rev-parse", "main^2^")).toBe(moved);
    expect(calls().filter(merged)).toEqual([["pr", "merge", `land/${rebased.slice(0, 12)}`, "--merge", "--match-head-commit", rebased]]);
    expect(git(session, "rev-parse", "HEAD")).toBe(git(remote, "rev-parse", "main"));
  });

  it("rebases, re-pushes the same branch and merges again when GitHub refuses the merge because main moved after the push, \"Base branch was modified\" (#1503)", () => {
    const { remote, session, head, branch, run, calls, merged, posted } = sessionAheadOfMain(1, { merges: ["raced", "merged"], mainMovesOnRefusal: {} });

    const result = run();

    expect(result.status, result.stderr).toBe(0);
    const rebased = git(remote, "rev-parse", "main^2");
    expect(rebased).not.toBe(head);
    expect(git(remote, "log", "-1", "--format=%s", "main^2^")).toBe("another session landed");
    expect(calls().filter(merged)).toEqual([
      ["pr", "merge", branch, "--merge", "--match-head-commit", head],
      ["pr", "merge", branch, "--merge", "--match-head-commit", rebased],
    ]);
    expect(calls().filter(posted).map((call) => `${call[3]} ${call[7]}`)).toEqual([`repos/{owner}/{repo}/statuses/${head} context=check`, `repos/{owner}/{repo}/statuses/${rebased} context=check`]);
    expect(calls().filter((call) => call[1] === "create")).toHaveLength(1);
    expect(git(session, "rev-parse", "HEAD")).toBe(git(remote, "rev-parse", "main"));
    expect(result.stdout).toBe(`Landed ${PR}\n`);
  });

  it.each<[string, { merges: Merge[]; views?: string[] }]>([
    ["with its own transient error (#1503)", { merges: ["erred", "merged"] }],
    ["before it has worked out whether the PR is behind", { merges: ["refused", "merged"], views: ["UNKNOWN"] }],
  ])("tries the same head again when GitHub refuses the merge %s", (_, options) => {
    const { head, branch, run, calls, merged } = sessionAheadOfMain(1, options);

    const result = run();

    expect(result.status, result.stderr).toBe(0);
    expect(calls().filter(merged)).toEqual([
      ["pr", "merge", branch, "--merge", "--match-head-commit", head],
      ["pr", "merge", branch, "--merge", "--match-head-commit", head],
    ]);
  });

  it("lands on bin/github's retry when GitHub answers the merge with a blip, never reading the PR as refused", () => {
    const { head, branch, run, calls, merged } = sessionAheadOfMain(1, { merges: ["blip", "merged"] });

    const result = run();

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe(`Landed ${PR}\n`);
    expect(calls().filter(merged)).toEqual([
      ["pr", "merge", branch, "--merge", "--match-head-commit", head],
      ["pr", "merge", branch, "--merge", "--match-head-commit", head],
    ]);
    expect(calls().some((call) => call[1] === "view")).toBe(false);
  });

  it("lands without trying again when GitHub merged the PR but answered with its transient error (#1503)", () => {
    const { remote, session, run, calls, merged, checked } = sessionAheadOfMain(1, { merges: ["mergedErred"], rounds: "1" });

    const result = run();

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe(`Landed ${PR}\n`);
    expect(calls().filter(merged)).toHaveLength(1);
    expect(checked()).toEqual(["--full --covered"]);
    expect(git(session, "rev-parse", "HEAD")).toBe(git(remote, "rev-parse", "main"));
  });

  it.each<[string, { merges: Merge[]; views?: string[]; rounds?: string }, string, number]>([
    ["once its rounds of rebase and push are spent", { merges: ["raced"], rounds: "2" }, `land: ${PR} did not merge in 2 rounds of rebase and push: ${MAIN_RACED}; it is left open\n`, 2],
    ["once its rounds are spent on GitHub's transient error", { merges: ["erred"], rounds: "2" }, `land: ${PR} did not merge in 2 rounds of rebase and push: ${GITHUB_ERRED}; it is left open\n`, 2],
    ["at once when the PR reads as behind but GitHub refused it for another reason, since no ruleset refuses a merge for being behind (#1503)", { merges: ["refused"], views: ["BEHIND"] }, `land: GitHub refused to merge ${PR}: ${REFUSAL}; it is left open\n`, 1],
    ["at once on a refusal that is neither behind nor a conflict, such as a push that skipped land and so carries no check status", { merges: ["refused"], views: ["BLOCKED"] }, `land: GitHub refused to merge ${PR}: ${REFUSAL}; it is left open\n`, 1],
  ])("ends red naming GitHub's refusal and leaves the PR open %s", (_, options, said, tried) => {
    const { session, head, run, calls, merged } = sessionAheadOfMain(1, options);

    const result = run();

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(said);
    expect(calls().filter(merged)).toHaveLength(tried);
    expect(calls().some((call) => call[1] === "close")).toBe(false);
    expect(git(session, "rev-parse", "HEAD")).toBe(head);
  });

  it("waits for a required check still running on GitHub and merges the same head once it passes, since a spec branch runs CI's own check beside land's status (Mezzanine PR 1998)", () => {
    const { head, branch, run, calls, merged } = sessionAheadOfMain(1, { merges: ["refused", "merged"], views: ["BLOCKED"], required: ["pending", "passed"] });

    const result = run();

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe(`Landed ${PR}\n`);
    expect(calls().filter(merged)).toEqual([
      ["pr", "merge", branch, "--merge", "--match-head-commit", head],
      ["pr", "merge", branch, "--merge", "--match-head-commit", head],
    ]);
  });

  it("ends red naming GitHub's refusal and merges nothing more when the required check it waited on fails", () => {
    const { run, calls, merged } = sessionAheadOfMain(1, { merges: ["refused", "merged"], views: ["BLOCKED"], required: ["pending", "failed"] });

    const result = run();

    expect(result.status).toBe(1);
    expect(result.stderr).toBe(`land: GitHub refused to merge ${PR}: ${REFUSAL}; it is left open\n`);
    expect(calls().filter(merged)).toHaveLength(1);
  });

  it("rebases onto the main it fetches, re-pushes the same branch and merges, closing nothing, when GitHub refuses the merge over a conflict with a main that moved after the push (Lumaria#1332)", () => {
    const { remote, session, head, run, calls, merged } = sessionAheadOfMain(1, { merges: ["refused", "merged"], views: ["DIRTY"], mainMovesOnRefusal: { "theirs.txt": "theirs\n" }, changes: { "mine.txt": "mine\n" } });
    git(session, "checkout", "--quiet", "-b", "ticket/811");

    const result = run(["--ticket", "811"]);

    expect(result.status, result.stderr).toBe(0);
    const rebased = git(remote, "rev-parse", "main^2");
    expect(git(remote, "log", "-1", "--format=%s", "main^2^")).toBe("another session landed");
    expect(calls().filter(merged)).toEqual([
      ["pr", "merge", "ticket/811", "--merge", "--match-head-commit", head],
      ["pr", "merge", "ticket/811", "--merge", "--match-head-commit", rebased],
    ]);
    expect(calls().some((call) => call[1] === "close")).toBe(false);
    expect(result.stdout).toBe(`Landed ${PR}\n`);
  });

  it("names the conflicted files and leaves the PR open and the ticket branch checked out where it was, never main, when main moved after the push into a real conflict (Lumaria#1332)", () => {
    const { remote, session, head, run, calls } = sessionAheadOfMain(1, { merges: ["refused"], views: ["DIRTY"], mainMovesOnRefusal: { "shared.txt": "theirs\n" }, changes: { "shared.txt": "mine\n" } });
    git(session, "checkout", "--quiet", "-b", "ticket/811");

    const result = run(["--ticket", "811"]);

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(`land: HEAD does not rebase cleanly onto origin/main, conflicting in shared.txt, so nothing landed; ${PR} is left open and this checkout is left on ticket/811 as it was: run git rebase origin/main and resolve them\n`);
    expect(calls().some((call) => call[1] === "close")).toBe(false);
    expect(git(remote, "rev-parse", "ticket/811")).toBe(head);
    expect(git(session, "symbolic-ref", "--short", "HEAD")).toBe("ticket/811");
    expect(git(session, "rev-parse", "HEAD")).toBe(head);
    expect(git(session, "status", "--porcelain")).toBe("");
  });

  it("closes a session's land PR and deletes its branch on origin, keeping the session's checkout where it was, when main moved after the push into a real conflict, since the next landing opens its own PR under a new head", () => {
    const { remote, session, head, branch, run, calls } = sessionAheadOfMain(1, { merges: ["refused"], views: ["DIRTY"], mainMovesOnRefusal: { "shared.txt": "theirs\n" }, changes: { "shared.txt": "mine\n" } });

    const result = run();

    expect(result.status).toBe(1);
    expect(result.stderr).toBe(`land: HEAD does not rebase cleanly onto origin/main, conflicting in shared.txt, so nothing landed; ${PR} is closed, since the next landing opens its own, and this checkout is left on main as it was: run git rebase origin/main and resolve them\n`);
    expect(calls().filter((call) => call[1] === "close")).toEqual([["pr", "close", PR]]);
    expect(git(remote, "for-each-ref", "--format=%(refname)", `refs/heads/${branch}`)).toBe("");
    expect(git(session, "symbolic-ref", "--short", "HEAD")).toBe("main");
    expect(git(session, "rev-parse", "HEAD")).toBe(head);
  });

  it("lands nothing and says to rebase by hand when the session's commits conflict with a main that moved (#869)", () => {
    const { root, remote, session, run, calls } = sessionAheadOfMain(0);
    writeFileSync(join(session, "shared.txt"), "mine\n");
    git(session, "add", "shared.txt");
    git(session, "commit", "--quiet", "-m", "this session's change");
    const head = git(session, "rev-parse", "HEAD");
    landedElsewhere(root, remote, "shared.txt", "theirs\n");

    const result = run();

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("land: HEAD does not rebase cleanly onto origin/main, conflicting in shared.txt, so nothing landed; this checkout is left on main as it was: run git rebase origin/main and resolve them\n");
    expect(git(session, "rev-parse", "HEAD")).toBe(head);
    expect(git(session, "status", "--porcelain")).toBe("");
    expect(existsSync(join(session, ".git", "rebase-merge"))).toBe(false);
    expect(git(remote, "for-each-ref", "--format=%(refname)")).toBe("refs/heads/main");
    expect(calls()).toEqual([]);
  });

  it("lands nothing, and leaves it be, while the session is partway through a rebase of its own (#869)", () => {
    const { root, remote, session, run, calls } = sessionAheadOfMain(1);
    landedElsewhere(root, remote, "theirs.txt", "theirs\n");
    mkdirSync(join(session, ".git", "rebase-merge"));

    const result = run();

    expect(result.status).toBe(1);
    expect(result.stderr).toBe("land: a rebase is already in progress here, so nothing landed; finish it or abort it first\n");
    expect(existsSync(join(session, ".git", "rebase-merge"))).toBe(true);
    expect(calls()).toEqual([]);
  });

  it("keeps a failing call's own output in a log and says one line naming it", () => {
    const { remote, session, run } = sessionAheadOfMain(1);
    writeFileSync(join(remote, "hooks", "pre-receive"), "#!/bin/bash\ncat >/dev/null\necho 'branch protection refused this push' >&2\nexit 1\n");
    chmodSync(join(remote, "hooks", "pre-receive"), 0o755);

    const result = run();

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    const log = /^land: git push failed; log (\S.*\.log)\n$/.exec(result.stderr)?.[1] ?? "";
    expect(readFileSync(isAbsolute(log) ? log : join(session, log), "utf8")).toContain("branch protection refused this push");
  });

  it("deletes its logs older than 7 days, keeps today's, and says nothing about either (#693)", () => {
    const { session, run } = sessionAheadOfMain(0);
    const { stale, fresh } = agedLogs(join(session, ".git", "machine-logs"), "land");

    const result = run();

    expect(result).toMatchObject({ status: 0, stdout: "Nothing to land: HEAD is already on origin/main.\n", stderr: "" });
    expect(existsSync(stale)).toBe(false);
    expect(existsSync(fresh)).toBe(true);
  });

  it("opens nothing when there is nothing past origin/main", () => {
    const { run, calls } = sessionAheadOfMain(0);

    const result = run();

    expect(result.status, result.stderr).toBe(0);
    expect(calls()).toEqual([]);
    expect(result.stdout).toContain("Nothing to land");
  });
});

describe("bin/land settles a rebase that conflicts only in files origin/main's settle map names, where 15 of 37 spec finishes were rebuilt on main by hand over two migrations (#1615)", () => {
  it("takes origin/main's side of the conflicted file, runs the entry's command at the tree's root, and lands what it rebuilt as one commit naming the entry and the base", () => {
    const { root, remote, session, run } = sessionAheadOfMain(1, { changes: { "parts/mine": "a part\n", "derived/index": "mine\n" } });
    const moved = mainGained(root, remote, { [CONTRACT]: settleMapOf(APPENDS_PARTS), "derived/index": "theirs\n" });

    const result = run();

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe(`Landed ${PR}\n`);
    expect(git(remote, "show", "main:derived/index")).toBe("theirs\nmine");
    expect(git(remote, "log", "--format=%s", `${moved}..main^2`).split("\n")).toEqual([`chore: settle index after rebasing onto origin/main at ${moved.slice(0, 7)}`, "change 1"]);
    expect(git(remote, "show", "--format=", "--name-only", "main^2")).toBe("derived/index");
    expect(git(session, "rev-parse", "HEAD")).toBe(git(remote, "rev-parse", "main"));
  });

  it("settles at each commit that conflicts in the entry's files, skips the commit that leaves empty, and still lands one settle commit", () => {
    const { root, remote, session, run } = sessionAheadOfMain(0);
    committedBy(session, "add part one", { "parts/one": "a part\n", "derived/index": "one\n" });
    committedBy(session, "index part one again", { "derived/index": "one\none again\n" });
    const moved = mainGained(root, remote, { [CONTRACT]: settleMapOf(APPENDS_PARTS), "derived/index": "theirs\n" });

    const result = run();

    expect(result.status, result.stderr).toBe(0);
    expect(git(remote, "show", "main:derived/index")).toBe("theirs\none");
    expect(git(remote, "log", "--format=%s", `${moved}..main^2`).split("\n")).toEqual([`chore: settle index after rebasing onto origin/main at ${moved.slice(0, 7)}`, "add part one"]);
  });

  it("lands nothing and leaves the branch head, index and worktree as they were, naming every conflicted file as it does with no settle map, when a later commit conflicts outside the entry's files", () => {
    const { root, remote, session, run, calls } = sessionAheadOfMain(0);
    committedBy(session, "add part one", { "parts/one": "a part\n", "derived/index": "one\n" });
    const head = committedBy(session, "change what both share", { "shared.txt": "mine\n" });
    mainGained(root, remote, { [CONTRACT]: settleMapOf(APPENDS_PARTS), "derived/index": "theirs\n", "shared.txt": "theirs\n" });

    const result = run();

    expect(result.status).toBe(1);
    expect(result.stderr).toBe("land: HEAD does not rebase cleanly onto origin/main, conflicting in derived/index, shared.txt, so nothing landed; this checkout is left on main as it was: run git rebase origin/main and resolve them\n");
    expect(leftAt(session)).toEqual({ head, branch: "main", changed: "", rebasing: false });
    expect(calls()).toEqual([]);
  });

  it("lands nothing and leaves the branch head, index and worktree as they were, naming the command's own last line, when the entry's command fails partway through its rebuild", () => {
    const { root, remote, session, head, run, calls } = sessionAheadOfMain(1, { changes: { "parts/mine": "a part\n", "derived/index": "mine\n" } });
    mainGained(root, remote, { [CONTRACT]: settleMapOf("printf 'half\\n' >derived/index; printf 'half\\n' >derived/snapshot; printf 'index: parts/mine has no number\\n' >&2; exit 1"), "derived/index": "theirs\n" });

    const result = run();

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("land: HEAD does not rebase cleanly onto origin/main, conflicting in derived/index, which the settle map's index could not rebuild: index: parts/mine has no number, so nothing landed; this checkout is left on main as it was: run git rebase origin/main and resolve them\n");
    expect(leftAt(session)).toEqual({ head, branch: "main", changed: "", rebasing: false });
    expect(git(remote, "for-each-ref", "--format=%(refname)")).toBe("refs/heads/main");
    expect(calls()).toEqual([]);
  });

  it("lands nothing and leaves the branch as it was when the entry's command changes a file outside its files, since land lands only a tree that matches its commit", () => {
    const { root, remote, session, head, run, calls } = sessionAheadOfMain(1, { changes: { "parts/mine": "a part\n", "derived/index": "mine\n" } });
    mainGained(root, remote, { [CONTRACT]: settleMapOf(`${APPENDS_PARTS}; date >built-at.txt`), "derived/index": "theirs\n" });

    const result = run();

    expect(result.status).toBe(1);
    expect(result.stderr).toBe("land: HEAD does not rebase cleanly onto origin/main, conflicting in derived/index, which the settle map's index rebuilt while changing built-at.txt outside its files, so nothing landed; this checkout is left on main as it was: run git rebase origin/main and resolve them\n");
    expect(leftAt(session)).toEqual({ head, branch: "main", changed: "", rebasing: false });
    expect(calls()).toEqual([]);
  });

  it("puts the branch head, index and worktree back, with no settle commit, when stopped while the entry's command is still rebuilding, so the next land settles again instead of landing a half-built file", async () => {
    const { root, remote, session, head, held, stoppedWhileHeld } = sessionAheadOfMain(1, { changes: { "parts/mine": "a part\n", "derived/index": "mine\n" } });
    mainGained(root, remote, { [CONTRACT]: settleMapOf(`printf 'half\\n' >derived/index; printf 'half\\n' >derived/snapshot; : >${held}; exec sleep 30`), "derived/index": "theirs\n" });

    const stopped = await stoppedWhileHeld("SIGTERM");

    expect(stopped.status).toBe(143);
    expect(stopped.stderr).toBe("land: stopped by TERM at the rebase, so main is untouched, no PR is open yet and no check status is posted; run land again and it resumes from there\n");
    expect(leftAt(session)).toEqual({ head, branch: "main", changed: "", rebasing: false });
  });

  it("puts the branch head, index and worktree back and lands nothing when the rebase's own process dies while the entry's command is rebuilding", () => {
    const { root, remote, session, head, run, calls } = sessionAheadOfMain(1, { changes: { "parts/mine": "a part\n", "derived/index": "mine\n" } });
    mainGained(root, remote, { [CONTRACT]: settleMapOf("printf 'half\\n' >derived/index; printf 'half\\n' >derived/snapshot; kill -KILL $PPID; sleep 1"), "derived/index": "theirs\n" });

    const result = run();

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/^land: the rebase onto origin\/main could not run, so nothing landed; log \S+\n$/);
    expect(leftAt(session)).toEqual({ head, branch: "main", changed: "", rebasing: false });
    expect(calls()).toEqual([]);
  });
});

describe("bin/land stopped by the session limit says where it stopped and leaves a tree the next land resumes from (agent-hooks#411)", () => {
  const NOT_YET = "no PR is open yet and no check status is posted";
  it.each<[LandStage, NodeJS.Signals, boolean, Parameters<typeof landSession>[0], string]>([
    ["check", "SIGTERM", false, {}, NOT_YET],
    ["check", "SIGINT", false, {}, NOT_YET],
    ["check", "SIGHUP", false, {}, NOT_YET],
    ["check", "SIGTERM", true, {}, NOT_YET],
    ["rebase", "SIGTERM", true, {}, NOT_YET],
    ["merge wait", "SIGTERM", false, { merges: ["refused", "merged"], views: ["BLOCKED"], required: ["pending"] }, `${PR} is open and the check status is posted`],
  ])("at the %s on %s with main moved %s, undoes its own rebase, names the stage, main, the PR and its check status in one line, and lands on the next run with no hand step (#1656)", async (stage, signal, mainMoved, options, pr) => {
    const { root, remote, session, head, run, stoppedWhileHeld } = sessionAheadOfMain(1, { ...options, hold: stage });
    const before = git(remote, "rev-parse", "main");
    if (mainMoved) landedElsewhere(root, remote, "theirs.txt", "theirs\n");
    const moved = git(remote, "rev-parse", "main");

    const stopped = await stoppedWhileHeld(signal);

    expect(stopped.status).toBe({ SIGINT: 130, SIGHUP: 129 }[signal as string] ?? 143);
    expect(stopped.stderr).toBe(`land: stopped by ${signal.slice(3)} at the ${stage}, so main is untouched, ${pr}; run land again and it resumes from there\n`);
    expect(git(remote, "rev-parse", "main")).toBe(mainMoved ? moved : before);
    expect(git(session, "status", "--porcelain")).toBe("");
    expect(existsSync(join(session, ".git", "rebase-merge"))).toBe(false);
    expect(git(session, "symbolic-ref", "--short", "HEAD")).toBe("main");
    expect(git(session, "rev-parse", "HEAD")).toBe(head);

    const resumed = run();

    expect(resumed.status, resumed.stderr).toBe(0);
    expect(resumed.stdout).toBe(`Landed ${PR}\n`);
    expect(git(session, "rev-parse", "HEAD")).toBe(git(remote, "rev-parse", "main"));
  });
});

describe("bin/land refuses what must not reach main (#681)", () => {
  it.each([
    ["an em dash", `Refuse a thing\n\nbecause ${DASH} it matters`, (commit: string) => `land: commit ${commit} carries an em dash in its message, so nothing landed; reword it\n`],
  ])("lands nothing and names the commit whose message carries %s", (_, message, said) => {
    const { remote, session, run, calls } = landSession({ messages: ["a clean change", message, "another clean change"] });
    const refused = git(session, "rev-parse", "--short=7", "HEAD~1");

    const result = run();

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(said(refused));
    expect(git(remote, "for-each-ref", "--format=%(refname)")).toBe("refs/heads/main");
    expect(calls()).toEqual([]);
  });

  it("lands nothing from a private repo whose workflow puts a job on GitHub's runners, naming that job alone, since each of its runs bills minutes (#1624, Mezzanine#1972)", () => {
    const { remote, run, calls, merged } = landSession({ changes: { ".github/workflows/changelog-draft.yml": OFF_THE_PC }, privateRepo: true });

    const result = run();

    expect(result.status).toBe(1);
    expect(result.stderr).toBe(`land: changelog-draft.yml's draft job runs on ubuntu-latest, not ${PC_RUNS_ON}, so it stays on GitHub's runners, which bill this private repo by the minute, so nothing landed; give it that runs-on\n`);
    expect(git(remote, "for-each-ref", "--format=%(refname)")).toBe("refs/heads/main");
    expect(calls().filter(merged)).toEqual([]);
  });

  it("lands that workflow in a public repo, whose runs on GitHub's runners bill nothing", () => {
    const { run, calls, merged } = landSession({ changes: { ".github/workflows/changelog-draft.yml": OFF_THE_PC }, privateRepo: false });

    const result = run();

    expect(result.status, result.stderr).toBe(0);
    expect(calls().filter(merged)).toHaveLength(1);
  });

  it("lands a session's commit that closes an issue by keyword, since its merge already passed the full check", () => {
    const { run, calls, merged } = landSession({ messages: ["Fix the thing\n\nCloses #812"] });

    const result = run();

    expect(result.status, result.stderr).toBe(0);
    expect(calls().filter(merged)).toHaveLength(1);
  });

  it("lands nothing from a spec whose commit closes the spec by keyword, since only its done check closes it (ADR-0013)", () => {
    const { remote, session, run, calls } = landSession({ messages: ["a clean change", "Finish it\n\nCloses #974"] });

    const result = run(["--spec", "974"]);

    expect(result.status).toBe(1);
    expect(result.stderr).toBe(`land: commit ${git(session, "rev-parse", "--short=7", "HEAD")} closes spec #974 by keyword, so nothing landed; only its done check closes it: reword it\n`);
    expect(git(remote, "for-each-ref", "--format=%(refname)")).toBe("refs/heads/main");
    expect(calls().some(([command, action]) => command === "pr" && action === "create")).toBe(false);
  });

  it.each([
    ["a tracked edit", "tool", "edited\n", "tool"],
    ["an untracked file", "notes/draft.txt", "draft\n", "notes/draft.txt"],
  ])("lands nothing, runs no check and names the file when the tree holds %s, so the check grades exactly the commit it ships (agent-hooks#176)", (_, path, content, named) => {
    const { remote, session, run, calls, checked } = landSession({ changes: { tool: "committed\n" } });
    plant(session, path, content);

    const result = run();

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(`land: the tree differs from the commit, so nothing landed; commit or remove ${named} and land again\n`);
    expect(checked()).toEqual([]);
    expect(git(remote, "for-each-ref", "--format=%(refname)")).toBe("refs/heads/main");
    expect(calls()).toEqual([]);
  });

  it("lands a ticket's build from the ticket's own branch, its PR titled as the ticket and closing it on merge, when the reviewer names the ticket (ADR-0012)", () => {
    const { head, run, calls, merged } = sessionAheadOfMain(1);

    const result = run(["--ticket", "811"]);

    expect(result.status, result.stderr).toBe(0);
    expect(calls()).toContainEqual(["pr", "create", "--base", "main", "--head", "ticket/811", "--title", TICKET_TITLE, "--body", "Closes #811\n\n- change 1"]);
    expect(calls().filter(merged)).toEqual([["pr", "merge", "ticket/811", "--merge", "--match-head-commit", head]]);
    expect(result.stdout).toBe(`Landed ${PR}\n`);
  });

  it("comments the reviewer's approve reason on the ticket's PR before it merges, once however many rounds it rebases, so a cost the reviewer let through reaches the owner (#1471)", () => {
    const REASON = "it builds the Why; the slice gate now takes a build runner on every label, which I let through";
    const { run, calls, merged } = sessionAheadOfMain(1, { merges: ["raced", "merged"] });

    const result = run(["--ticket", "811", "--approved", REASON]);

    expect(result.status, result.stderr).toBe(0);
    const commented = calls().findIndex((call) => call[0] === "pr" && call[1] === "comment");
    expect(calls().filter((call) => call[0] === "pr" && call[1] === "comment")).toEqual([["pr", "comment", PR, "--body", `The reviewer approved #811: ${REASON}`]]);
    expect(commented).toBeLessThan(calls().findIndex(merged));
  });

  it("lands a spec's integration branch from spec/<number>, its PR titled as the spec and saying it builds it, with the review's approve reason commented before it merges (ADR-0013)", () => {
    const REASON = "it builds the spec; the slices share one migration, which I let through";
    const { head, run, calls, merged } = sessionAheadOfMain(1);

    const result = run(["--spec", "974", "--approved", REASON]);

    expect(result.status, result.stderr).toBe(0);
    expect(calls()).toContainEqual(["pr", "create", "--base", "main", "--head", "spec/974", "--title", TICKET_TITLE, "--body", "Builds #974\n\n- change 1"]);
    expect(calls().filter((call) => call[0] === "pr" && call[1] === "comment")).toEqual([["pr", "comment", PR, "--body", `The review approved #974: ${REASON}`]]);
    expect(calls().filter(merged)).toEqual([["pr", "merge", "spec/974", "--merge", "--match-head-commit", head]]);
    expect(result.stdout).toBe(`Landed ${PR}\n`);
  });

  it.each([[["--ticket"]], [["--ticket", "eleven"]], [["811"]], [["--ticket", "811", "--approved"]], [["--ticket", "811", "--approved", ""]], [["--approved", "it builds the Why"]], [["--spec"]], [["--spec", "974", "--ticket", "811"]], [["--spec", "974", "--approved", ""]]])("lands nothing and says its usage given %j, since only --ticket or --spec and a number name what lands, and only they take an approve reason, one that says something", (args) => {
    const { remote, run, calls } = landSession();

    const result = run(args);

    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/^land: usage: land \[--ticket <number> \| --spec <number> \[--approved <reason>\]\]/);
    expect(git(remote, "for-each-ref", "--format=%(refname)")).toBe("refs/heads/main");
    expect(calls()).toEqual([]);
  });

  it("lands nothing and says its usage when asked for help, so a --help probe cannot land", () => {
    const { remote, run, calls } = landSession();

    const result = run(["--help"]);

    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/^land: usage: land\b/);
    expect(result.stderr).toBe("");
    expect(git(remote, "for-each-ref", "--format=%(refname)")).toBe("refs/heads/main");
    expect(calls()).toEqual([]);
  });
});
