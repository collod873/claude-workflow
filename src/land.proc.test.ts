import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { describe, expect, it } from "vitest";
import { ENROLLED_REVIEW } from "./post.ts";
import { agedLogs, git, home, landSession, LANDED_PR as PR, MERGE_REFUSAL as REFUSAL, type Merge } from "./scenarios.ts";

const JUDGED_CHECK = "description=judged on the owner's PC by its pre-push, before the push (ADR-0008)";
const SKIPPED_REVIEW = "description=skipped: a session landing is judged by its pre-push, not reviewed (ADR-0008)";
const DASH = "\u2014";

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

describe("bin/land turns a session's commits into a PR it merges at once, posting the check its pre-push passed as the head's status once the push has put the head on GitHub, which takes no status for a commit it lacks (#1344, #1345)", () => {
  it("opens a merge-commit PR from a land branch, posts check as judged and tickets / review as skipped for the head after the push, merges matching that head, and brings local main up to the merged main (#1386)", () => {
    const { remote, session, head, branch, run, calls, merged, posted } = sessionAheadOfMain(2);

    const result = run();

    expect(result.status, result.stderr).toBe(0);
    expect(calls()).toContainEqual(["pr", "create", "--base", "main", "--head", branch, "--title", "change 2", "--body", "- change 1\n- change 2"]);
    expect(calls().filter(posted)).toEqual([
      ["api", "-X", "POST", `repos/{owner}/{repo}/statuses/${head}`, "-f", "state=success", "-f", "context=check", "-f", JUDGED_CHECK],
      ["api", "-X", "POST", `repos/{owner}/{repo}/statuses/${head}`, "-f", "state=success", "-f", `context=${ENROLLED_REVIEW}`, "-f", SKIPPED_REVIEW],
    ]);
    expect(calls().filter((call) => call.join(" ").includes("/rules/")), "every repo requires one review name, so land asks no ruleset for it").toEqual([]);
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

  it("runs the full check itself when no receipt covers the pushed tree, publishing its receipts, then posts the check and merges on green, so no agent hand-runs a check before landing (#1412)", () => {
    const { run, calls, checked, head, branch, merged, posted } = sessionAheadOfMain(1, { covered: false });

    const result = run();

    expect(result.status, result.stderr).toBe(0);
    expect(checked()).toEqual(["--full --covered", "--full --publish"]);
    expect(calls().filter(posted).map((call) => call.at(-1))).toEqual([JUDGED_CHECK, SKIPPED_REVIEW]);
    expect(calls().filter(merged)).toEqual([["pr", "merge", branch, "--merge", "--match-head-commit", head]]);
  });

  it("posts no check and merges nothing when the full check it ran goes red, and passes on the check's own line naming the red step", () => {
    const { run, calls, checked, remote, branch } = sessionAheadOfMain(1, { covered: false, green: false });

    const result = run();

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("check: red test; log .git/check-logs/test.log\nland: the full check went red on the pushed tree, so no check status is posted and nothing merges; fix what it names and land again\n");
    expect(checked()).toEqual(["--full --covered", "--full --publish"]);
    expect(git(remote, "rev-parse", branch)).toMatch(/^[0-9a-f]{40}$/);
    expect(calls()).toEqual([]);
  });

  it("lands a change to docs/buckets.md alone with no receipt, since no check step reads it, so the closer's row move lands through it (#1382)", () => {
    const { run, calls, checked, head, merged, posted } = sessionAheadOfMain(1, { covered: false, changes: { "docs/buckets.md": "| a row | moved |\n" } });

    const result = run();

    expect(result.status, result.stderr).toBe(0);
    expect(checked()).toEqual([]);
    expect(calls().filter(posted).map((call) => call.at(-1))).toEqual(["description=docs/buckets.md alone changed from main, and no check step reads it (#1382)", "description=docs/buckets.md alone changed from main, and no check step reads it (#1382)"]);
    expect(calls().filter(merged)).toEqual([["pr", "merge", `land/${head.slice(0, 12)}`, "--merge", "--match-head-commit", head]]);
  });

  it("still runs the full check when docs/buckets.md changes beside another file", () => {
    const { run, checked } = sessionAheadOfMain(1, { covered: false, changes: { "docs/buckets.md": "| a row | moved |\n", "tool": "changed\n" } });

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

  it("rebases, re-pushes the same branch and merges again when GitHub refuses the merge as behind a main that moved after the push", () => {
    const { remote, session, head, branch, run, calls, merged, posted } = sessionAheadOfMain(1, { merges: ["refused", "merged"], views: ["BEHIND"], mainMovesOnRefusal: true });

    const result = run();

    expect(result.status, result.stderr).toBe(0);
    const rebased = git(remote, "rev-parse", "main^2");
    expect(rebased).not.toBe(head);
    expect(git(remote, "log", "-1", "--format=%s", "main^2^")).toBe("another session landed");
    expect(calls().filter(merged)).toEqual([
      ["pr", "merge", branch, "--merge", "--match-head-commit", head],
      ["pr", "merge", branch, "--merge", "--match-head-commit", rebased],
    ]);
    expect(calls().filter(posted).map((call) => `${call[3]} ${call[7]}`)).toEqual([`repos/{owner}/{repo}/statuses/${head} context=check`, `repos/{owner}/{repo}/statuses/${head} context=${ENROLLED_REVIEW}`, `repos/{owner}/{repo}/statuses/${rebased} context=check`, `repos/{owner}/{repo}/statuses/${rebased} context=${ENROLLED_REVIEW}`]);
    expect(calls().filter((call) => call[1] === "create")).toHaveLength(1);
    expect(git(session, "rev-parse", "HEAD")).toBe(git(remote, "rev-parse", "main"));
    expect(result.stdout).toBe(`Landed ${PR}\n`);
  });

  it("tries the merge again when GitHub has not yet worked out whether the PR is behind", () => {
    const { head, branch, run, calls, merged } = sessionAheadOfMain(1, { merges: ["refused", "merged"], views: ["UNKNOWN"] });

    const result = run();

    expect(result.status, result.stderr).toBe(0);
    expect(calls().filter(merged)).toEqual([
      ["pr", "merge", branch, "--merge", "--match-head-commit", head],
      ["pr", "merge", branch, "--merge", "--match-head-commit", head],
    ]);
  });

  it.each<[string, { merges: Merge[]; views: string[]; rounds?: string }, string, number]>([
    ["once its rounds of rebase and push are spent", { merges: ["refused"], views: ["BEHIND"], rounds: "2" }, `land: ${PR} did not merge in 2 rounds of rebase and push: ${REFUSAL}; it is left open\n`, 2],
    ["at once on a refusal that is neither behind nor a conflict, such as a push that skipped the pre-push and so carries no check status", { merges: ["refused"], views: ["BLOCKED"] }, `land: GitHub refused to merge ${PR}: ${REFUSAL}; it is left open\n`, 1],
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

  it("closes the PR and says to land again when GitHub refuses the merge over a conflict with main", () => {
    const { session, head, branch, run, calls } = sessionAheadOfMain(1, { merges: ["refused"], views: ["DIRTY"] });

    const result = run();

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(`land: ${PR} conflicts with main; closed it, so land again to rebase\n`);
    expect(calls()).toContainEqual(["pr", "close", branch, "--delete-branch"]);
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

  it("swaps plain review for tickets / review in this repo's main ruleset with bin/enrol on the owner's token before it posts, then merges, since the App's token is refused that write (#1389)", () => {
    const { run, calls, held, merged, posted } = sessionAheadOfMain(1, { home: home() });

    const result = run();

    expect(result.status, result.stderr).toBe(0);
    const required = held().rules.flatMap(({ parameters }) => (parameters as { required_status_checks?: { context: string }[] } | undefined)?.required_status_checks ?? []).map(({ context }) => context);
    expect(required).toEqual(["check", ENROLLED_REVIEW]);
    const swappedAt = calls().findIndex((call) => call.includes("PUT") && call.some((arg) => arg.includes("/rulesets/")));
    expect(swappedAt).toBeGreaterThan(-1);
    expect(swappedAt).toBeLessThan(calls().findIndex(posted));
    expect(calls().filter(merged)).toHaveLength(1);
  });

  it("runs no bin/enrol and makes no ruleset write in this repo where no rule names plain review (#1389)", () => {
    const { run, calls, held, merged } = sessionAheadOfMain(1, { home: home(undefined, [{ type: "required_status_checks", ruleset_id: 3, parameters: { required_status_checks: [{ context: "check" }, { context: ENROLLED_REVIEW }] } }]) });

    const result = run();

    expect(result.status, result.stderr).toBe(0);
    expect(held().writes).toEqual([]);
    expect(calls().filter((call) => call.some((arg) => arg.includes("/contents/") || arg.includes("/rulesets/"))), "bin/enrol never runs").toEqual([]);
    expect(calls().filter(merged)).toHaveLength(1);
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
