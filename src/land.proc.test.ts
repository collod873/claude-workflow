import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { describe, expect, it } from "vitest";
import { agedLogs, git, GITHUB_ERRED, landSession, LANDED_PR as PR, MAIN_RACED, MERGE_REFUSAL as REFUSAL, plant, TICKET_TITLE, type Merge } from "./scenarios.ts";

const JUDGED_CHECK = "description=judged by land on the commit before the push (ADR-0008)";
const DASH = "\u2014";
const TABLE = (state: string) => ["| Root cause | Symptoms | Countermeasure | State |", "|---|---|---|---|", `| a row | its evidence | its prevention | ${state} |`, ""].join("\n");

const sessionAheadOfMain = (commits: number, options: Omit<Parameters<typeof landSession>[0], "messages"> = {}) => landSession({ messages: Array.from({ length: commits }, (_, n) => `change ${n + 1}`), ...options });

function landedElsewhere(root: string, remote: string, file: string, content: string): string {
  const other = join(root, "other");
  git(root, "clone", "--quiet", remote, other);
  git(other, "config", "user.email", "other@test");
  git(other, "config", "user.name", "other");
  writeFileSync(join(other, file), content);
  git(other, "add", file);
  git(other, "commit", "--quiet", "-m", "another session's change");
  git(other, "push", "--quiet", "origin", "main");
  return git(other, "rev-parse", "HEAD");
}

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
    const { run, calls, checked, head, branch, merged, posted } = sessionAheadOfMain(1, { covered: false });

    const result = run();

    expect(result.status, result.stderr).toBe(0);
    expect(checked()).toEqual(["--full --covered", "--full --publish"]);
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

  it("lands a change to docs/root-causes.md alone judged by its root-causes step alone, so the closer's row move lands through it (#1382)", () => {
    const { run, calls, checked, head, merged, posted } = sessionAheadOfMain(1, { covered: false, changes: { "docs/root-causes.md": TABLE("built (#812)") } });

    const result = run();

    expect(result.status, result.stderr).toBe(0);
    expect(checked()).toEqual([]);
    expect(calls().filter(posted).map((call) => call.at(-1))).toEqual(["description=docs/root-causes.md alone changed from main, judged by its root-causes step alone (#1382)"]);
    expect(calls().filter(merged)).toEqual([["pr", "merge", `land/${head.slice(0, 12)}`, "--merge", "--match-head-commit", head]]);
  });

  it("pushes nothing when docs/root-causes.md alone changed and a State is appended to instead of rewritten", () => {
    const { run, calls, remote } = sessionAheadOfMain(1, { covered: false, changes: { "docs/root-causes.md": TABLE("ruled by Collin; built (#812)") } });

    const result = run();

    expect(result.status).toBe(1);
    expect(result.stderr).toBe('docs/root-causes.md row "a row" has the State "ruled by Collin; built (#812)", not unruled, ruled, built or measured with its issues in brackets\nland: docs/root-causes.md is out of shape, so nothing was pushed; rewrite what it names and land again\n');
    expect(git(remote, "for-each-ref", "--format=%(refname)")).toBe("refs/heads/main");
    expect(calls()).toEqual([]);
  });

  it("still runs the full check when docs/root-causes.md changes beside another file", () => {
    const { run, checked } = sessionAheadOfMain(1, { covered: false, changes: { "docs/root-causes.md": TABLE("built (#812)"), "tool": "changed\n" } });

    expect(run().status).toBe(0);
    expect(checked()).toEqual(["--full --covered", "--full --publish"]);
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
    const { remote, session, head, branch, run, calls, merged, posted } = sessionAheadOfMain(1, { merges: ["raced", "merged"], mainMovesOnRefusal: true });

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

  it("closes the PR, deletes its branch on origin, and leaves the local ticket branch checked out where it was when GitHub refuses the merge over a conflict with main (#1503)", () => {
    const { remote, session, head, run, calls } = sessionAheadOfMain(1, { merges: ["refused"], views: ["DIRTY"] });
    git(session, "checkout", "--quiet", "-b", "ticket/811");

    const result = run(["--ticket", "811"]);

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(`land: ${PR} conflicts with main; closed it, so land again to rebase\n`);
    expect(calls().filter((call) => call[1] === "close").map((call) => call.slice(0, 3))).toEqual([["pr", "close", "ticket/811"]]);
    expect(git(remote, "for-each-ref", "--format=%(refname)")).toBe("refs/heads/main");
    expect(git(session, "symbolic-ref", "--short", "HEAD")).toBe("ticket/811");
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
    expect(result.stderr).toMatch(/^land: [^\n]*git rebase origin\/main[^\n]*\n$/);
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

describe("bin/land refuses what must not reach main (#681)", () => {
  it.each([
    ["an em dash", `Refuse a thing\n\nbecause ${DASH} it matters`, (commit: string) => `land: commit ${commit} carries an em dash in its message, so nothing landed; reword it\n`],
    ["a closing keyword before a ticket number", "Fix the thing\n\nCloses #812", (commit: string) => `land: commit ${commit} carries a closing keyword before #812, so nothing landed; reword it\n`],
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

  it("lands a ticket's build from the ticket's own branch, its PR titled as the ticket and saying it builds it, when the reviewer names the ticket (ADR-0012)", () => {
    const { head, run, calls, merged } = sessionAheadOfMain(1);

    const result = run(["--ticket", "811"]);

    expect(result.status, result.stderr).toBe(0);
    expect(calls()).toContainEqual(["pr", "create", "--base", "main", "--head", "ticket/811", "--title", TICKET_TITLE, "--body", "Builds #811\n\n- change 1"]);
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

  it("lands a spec's integration branch from spec/<number>, its PR titled as the spec and saying it builds it, with the reviewers' approve reason commented before it merges (ADR-0013)", () => {
    const REASON = "it builds the spec; the slices share one migration, which I let through";
    const { head, run, calls, merged } = sessionAheadOfMain(1);

    const result = run(["--spec", "974", "--approved", REASON]);

    expect(result.status, result.stderr).toBe(0);
    expect(calls()).toContainEqual(["pr", "create", "--base", "main", "--head", "spec/974", "--title", TICKET_TITLE, "--body", "Builds #974\n\n- change 1"]);
    expect(calls().filter((call) => call[0] === "pr" && call[1] === "comment")).toEqual([["pr", "comment", PR, "--body", `The reviewers approved #974: ${REASON}`]]);
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
