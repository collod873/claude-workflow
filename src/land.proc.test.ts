import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, onTestFinished } from "vitest";
import { agedLogs, cloned } from "./scenarios.ts";

const land = fileURLToPath(new URL("../bin/land", import.meta.url));

const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_")));

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

const PR = "https://github.com/collod873/claude-workflow/pull/1";
const REFUSAL = "GraphQL: Pull Request is not mergeable (mergePullRequest)";
const SKIPPED_REVIEW = "description=skipped: a session landing is judged by its pre-push, not reviewed (ADR-0008)";

type Merge = "merged" | "refused";

function recordingGh(root: string, remote: string, { merges, views, mainMovesOnRefusal }: { merges: Merge[]; views: string[]; mainMovesOnRefusal: boolean }) {
  const dir = join(root, "gh");
  mkdirSync(dir);
  const path = join(dir, "gh");
  const log = join(dir, "argv.jsonl");
  const counted = (name: string) => `$(( $(ls ${JSON.stringify(dir)} | grep -c ${name}-) + 1 ))`;
  writeFileSync(
    path,
    [
      "#!/bin/bash",
      `python3 -c 'import json,sys; print(json.dumps(sys.argv[1:]))' "$@" >> ${JSON.stringify(log)}`,
      `remote=${JSON.stringify(remote)}`,
      `merges=(${merges.join(" ")})`,
      `views=(${views.join(" ")})`,
      'case "$1 $2" in',
      `  "pr create") echo ${PR} ;;`,
      '  "pr view")',
      `    n=${counted("view")}; touch ${JSON.stringify(dir)}/view-$n`,
      "    (( n > ${#views[@]} )) && n=${#views[@]}",
      '    echo "${views[n - 1]}"',
      "    ;;",
      '  "pr merge")',
      `    n=${counted("merge")}; touch ${JSON.stringify(dir)}/merge-$n`,
      "    (( n > ${#merges[@]} )) && n=${#merges[@]}",
      "    if [[ ${merges[n - 1]} == merged ]]; then",
      "      for (( at = 1; at <= $#; at++ )); do [[ ${!at} == --match-head-commit ]] && { next=$(( at + 1 )); sha=${!next}; }; done",
      '      git -C "$remote" update-ref refs/heads/main "$(git -C "$remote" commit-tree "$sha^{tree}" -p main -p "$sha" -m merged)"',
      "    else",
      `      printf '%s\\n' ${JSON.stringify(REFUSAL)} >&2`,
      ...(mainMovesOnRefusal ? ['      git -C "$remote" update-ref refs/heads/main "$(git -C "$remote" commit-tree "main^{tree}" -p main -m "another session landed")"'] : []),
      "      exit 1",
      "    fi",
      "    ;;",
      "esac",
      "exit 0",
      "",
    ].join("\n"),
  );
  chmodSync(path, 0o755);
  const calls = (): string[][] => {
    try {
      return readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as string[]);
    } catch {
      return [];
    }
  };
  return { path, calls };
}

function sessionAheadOfMain(commits: number, { merges = ["merged"], views = ["BLOCKED"], mainMovesOnRefusal = false, rounds = "3" }: { merges?: Merge[]; views?: string[]; mainMovesOnRefusal?: boolean; rounds?: string } = {}) {
  const root = mkdtempSync(join(tmpdir(), "land-"));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const { remote, session } = cloned(root, "base");
  git(remote, "config", "user.email", "github@test");
  git(remote, "config", "user.name", "github");
  for (let n = 1; n <= commits; n++) {
    git(session, "commit", "--quiet", "--allow-empty", "-m", `change ${n}`);
  }
  const gh = recordingGh(root, remote, { merges, views, mainMovesOnRefusal });
  const run = (from = session) =>
    spawnSync(land, [], {
      cwd: from,
      encoding: "utf8",
      env: { ...env, PATH: `${join(root, "gh")}:${process.env.PATH}`, LAND_ROUNDS: rounds, LAND_PAUSE_SECONDS: "0" },
    });
  const head = git(session, "rev-parse", "HEAD");
  const merged = (call: string[]) => call[0] === "pr" && call[1] === "merge";
  const posted = (call: string[]) => call[0] === "api" && call.includes("context=review");
  return { root, remote, session, head, branch: `land/${head.slice(0, 12)}`, run, calls: gh.calls, merged, posted };
}

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

describe("bin/land turns a session's commits into a PR it merges at once, on the check its pre-push posted (#1344)", () => {
  it("opens a merge-commit PR from a land branch, posts review as skipped for the head, merges matching that head, and brings local main up to the merged main", () => {
    const { remote, session, head, branch, run, calls, merged, posted } = sessionAheadOfMain(2);

    const result = run();

    expect(result.status, result.stderr).toBe(0);
    expect(calls()).toContainEqual(["pr", "create", "--base", "main", "--head", branch, "--title", "change 2", "--body", "- change 1\n- change 2"]);
    expect(calls().filter(posted)).toEqual([["api", "-X", "POST", `repos/{owner}/{repo}/statuses/${head}`, "-f", "state=success", "-f", "context=review", "-f", SKIPPED_REVIEW]]);
    expect(calls().filter(merged)).toEqual([["pr", "merge", branch, "--merge", "--match-head-commit", head]]);
    expect(calls().map((call) => call[1])).toEqual(["-X", "create", "merge"]);
    expect(git(session, "rev-parse", "HEAD")).toBe(git(remote, "rev-parse", "main"));
    expect(git(session, "rev-parse", "HEAD^2")).toBe(head);
    expect(result.stdout).toBe(`Landed ${PR}\n`);
  });

  it("brings the main checkout, detached as the session launcher leaves it, up to the merged main when landing from a session worktree (#1309)", () => {
    const { root, remote, session: main, run } = sessionAheadOfMain(0);
    git(main, "checkout", "--quiet", "--detach");
    const worktree = join(root, "worktree");
    git(main, "worktree", "add", "--quiet", "-b", "ticket", worktree);
    writeFileSync(join(worktree, "tool"), "merged\n");
    git(worktree, "add", "tool");
    git(worktree, "commit", "--quiet", "-m", "change a tool");

    const result = run(worktree);

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
    expect(calls().filter(posted).map((call) => call[3])).toEqual([`repos/{owner}/{repo}/statuses/${head}`, `repos/{owner}/{repo}/statuses/${rebased}`]);
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

  it("opens nothing when there is nothing past origin/main", () => {
    const { run, calls } = sessionAheadOfMain(0);

    const result = run();

    expect(result.status, result.stderr).toBe(0);
    expect(calls()).toEqual([]);
    expect(result.stdout).toContain("Nothing to land");
  });
});
