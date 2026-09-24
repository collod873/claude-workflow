import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, onTestFinished } from "vitest";
import { agedLogs, cloned } from "./scenarios.ts";

const land = fileURLToPath(new URL("../bin/land", import.meta.url));

const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_")));

const githubMergesLandBranches = `#!/bin/bash
set -euo pipefail
while read -r _ pushed ref; do
  [[ $ref == refs/heads/land/* ]] || continue
  merge=$(git commit-tree "$pushed^{tree}" -p "$(git rev-parse main)" -p "$pushed" -m merged)
  git update-ref refs/heads/main "$merge"
done
`;

const githubMergesLandBranchesAfterAMoment = `#!/bin/bash
set -euo pipefail
read -r _ pushed ref
( sleep 1; git update-ref refs/heads/main "$(git commit-tree "$pushed^{tree}" -p "$(git rev-parse main)" -p "$pushed" -m merged)" ) >/dev/null 2>&1 &
`;

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

const PR = "https://github.com/collod873/claude-workflow/pull/1";

function recordingGh(root: string, prSays: string) {
  const dir = join(root, "gh");
  mkdirSync(dir);
  const path = join(dir, "gh");
  const log = join(dir, "argv.jsonl");
  writeFileSync(
    path,
    [
      "#!/bin/bash",
      `python3 -c 'import json,sys; print(json.dumps(sys.argv[1:]))' "$@" >> ${JSON.stringify(log)}`,
      `[[ "$1 $2" == "pr create" ]] && echo ${PR}`,
      `[[ "$1 $2" == "pr view" ]] && printf '%s\\n' ${JSON.stringify(prSays)}`,
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

function sessionAheadOfMain(
  commits: number,
  { githubMerges, prIsAlreadyClean = false, prSays = "" }: { githubMerges: "at once" | "after a moment" | "never"; prIsAlreadyClean?: boolean; prSays?: string },
) {
  const root = mkdtempSync(join(tmpdir(), "land-"));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const { remote, session } = cloned(root, "base");
  git(remote, "config", "user.email", "github@test");
  git(remote, "config", "user.name", "github");
  for (let n = 1; n <= commits; n++) {
    git(session, "commit", "--quiet", "--allow-empty", "-m", `change ${n}`);
  }
  if (githubMerges !== "never") {
    const hook = githubMerges === "after a moment" ? githubMergesLandBranchesAfterAMoment : githubMergesLandBranches;
    writeFileSync(join(remote, "hooks", "post-receive"), hook);
    chmodSync(join(remote, "hooks", "post-receive"), 0o755);
  }
  const gh = recordingGh(root, prSays);
  const githubRefusingAutoMerge = join(root, "refuses-auto-merge");
  execFileSync("mkdir", [githubRefusingAutoMerge]);
  writeFileSync(
    join(githubRefusingAutoMerge, "gh"),
    `#!/bin/bash\n[[ " $* " == *" --auto "* ]] && { printf 'Pull request is in clean status\\n' >&2; ${JSON.stringify(gh.path)} "$@"; exit 1; }\nexec ${JSON.stringify(gh.path)} "$@"\n`,
  );
  chmodSync(join(githubRefusingAutoMerge, "gh"), 0o755);
  const ghDir = prIsAlreadyClean ? githubRefusingAutoMerge : dirname(gh.path);
  const run = () =>
    spawnSync(land, [], {
      cwd: session,
      encoding: "utf8",
      env: { ...env, PATH: `${ghDir}:${process.env.PATH}`, LAND_WAIT_SECONDS: "2" },
    });
  const head = git(session, "rev-parse", "HEAD");
  return { root, remote, session, head, branch: `land/${head.slice(0, 12)}`, run, calls: gh.calls };
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

describe("bin/land turns a session's commits into a PR that merges itself", () => {
  it("opens a merge-commit PR from a land branch and brings local main up to the merged main", () => {
    const { remote, session, head, branch, run, calls } = sessionAheadOfMain(2, { githubMerges: "at once" });

    const result = run();

    expect(result.status, result.stderr).toBe(0);
    expect(calls()).toContainEqual(["pr", "create", "--base", "main", "--head", branch, "--title", "change 2", "--body", "- change 1\n- change 2"]);
    expect(calls()).toContainEqual(["pr", "merge", branch, "--auto", "--merge", "--match-head-commit", head]);
    expect(git(session, "rev-parse", "HEAD")).toBe(git(remote, "rev-parse", "main"));
    expect(git(session, "rev-parse", "HEAD^2")).toBe(head);
    expect(result.stdout).toContain("Landed");
  });

  it("merges straight away when GitHub refuses auto-merge because the PR has nothing left to wait for", () => {
    const { remote, session, head, branch, run, calls } = sessionAheadOfMain(1, { githubMerges: "at once", prIsAlreadyClean: true });

    const result = run();

    expect(result.status, result.stderr).toBe(0);
    expect(calls()).toContainEqual(["pr", "merge", branch, "--merge", "--match-head-commit", head]);
    expect(git(session, "rev-parse", "HEAD")).toBe(git(remote, "rev-parse", "main"));
  });

  it("waits for a merge GitHub finishes a moment after auto-merge is switched on", () => {
    const { remote, session, run } = sessionAheadOfMain(1, { githubMerges: "after a moment" });

    const result = run();

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("Landed");
    expect(git(session, "rev-parse", "HEAD")).toBe(git(remote, "rev-parse", "main"));
  });

  it("leaves local main alone and says so while the PR's checks are still running", () => {
    const { session, head, run } = sessionAheadOfMain(1, { githubMerges: "never" });

    const result = run();

    expect(result.status, result.stderr).toBe(0);
    expect(git(session, "rev-parse", "HEAD")).toBe(head);
    expect(result.stdout).toContain("Merges when its checks pass");
  });

  it("rebases the session's commits onto a main that moved since the session started, and lands them (#869)", () => {
    const { root, remote, session, run, calls } = sessionAheadOfMain(1, { githubMerges: "at once" });
    const moved = landedElsewhere(root, remote, "theirs.txt", "theirs\n");

    const result = run();

    expect(result.status, result.stderr).toBe(0);
    const rebased = git(remote, "rev-parse", "main^2");
    expect(git(remote, "rev-parse", "main^2^")).toBe(moved);
    expect(calls()).toContainEqual(["pr", "merge", `land/${rebased.slice(0, 12)}`, "--auto", "--merge", "--match-head-commit", rebased]);
    expect(git(session, "rev-parse", "HEAD")).toBe(git(remote, "rev-parse", "main"));
  });

  it("lands nothing and says to rebase by hand when the session's commits conflict with a main that moved (#869)", () => {
    const { root, remote, session, run, calls } = sessionAheadOfMain(0, { githubMerges: "at once" });
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
    const { root, remote, session, run, calls } = sessionAheadOfMain(1, { githubMerges: "at once" });
    landedElsewhere(root, remote, "theirs.txt", "theirs\n");
    mkdirSync(join(session, ".git", "rebase-merge"));

    const result = run();

    expect(result.status).toBe(1);
    expect(result.stderr).toBe("land: a rebase is already in progress here, so nothing landed; finish it or abort it first\n");
    expect(existsSync(join(session, ".git", "rebase-merge"))).toBe(true);
    expect(calls()).toEqual([]);
  });

  it.each([
    ["a required check failed", "failed check", /^land: check failed on \S+; closed it, so fix it and land again\n$/],
    ["main moved under it with a conflict", "conflicts", /^land: \S+ conflicts with main; closed it, so land again to rebase\n$/],
    ["someone closed it", "closed", /^land: \S+ was closed without merging\n$/],
  ])("waits no further, says why and exits non-zero when %s (#869)", (_, prSays, said) => {
    const { session, head, branch, run, calls } = sessionAheadOfMain(1, { githubMerges: "never", prSays });

    const result = run();

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toMatch(said);
    expect(git(session, "rev-parse", "HEAD")).toBe(head);
    expect(calls().some((call) => call[0] === "pr" && call[1] === "close" && call[2] === branch)).toBe(prSays !== "closed");
  });

  it("keeps a failing call's own output in a log and says one line naming it", () => {
    const { remote, session, run } = sessionAheadOfMain(1, { githubMerges: "never" });
    writeFileSync(join(remote, "hooks", "pre-receive"), "#!/bin/bash\ncat >/dev/null\necho 'branch protection refused this push' >&2\nexit 1\n");
    chmodSync(join(remote, "hooks", "pre-receive"), 0o755);

    const result = run();

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    const log = /^land: git push failed; log (\S.*\.log)\n$/.exec(result.stderr)?.[1] ?? "";
    expect(readFileSync(isAbsolute(log) ? log : join(session, log), "utf8")).toContain("branch protection refused this push");
  });

  it("deletes its logs older than 7 days, keeps today's, and says nothing about either (#693)", () => {
    const { session, run } = sessionAheadOfMain(0, { githubMerges: "at once" });
    const { stale, fresh } = agedLogs(join(session, ".git", "machine-logs"), "land");

    const result = run();

    expect(result).toMatchObject({ status: 0, stdout: "Nothing to land: HEAD is already on origin/main.\n", stderr: "" });
    expect(existsSync(stale)).toBe(false);
    expect(existsSync(fresh)).toBe(true);
  });

  it("opens nothing when there is nothing past origin/main", () => {
    const { run, calls } = sessionAheadOfMain(0, { githubMerges: "at once" });

    const result = run();

    expect(result.status, result.stderr).toBe(0);
    expect(calls()).toEqual([]);
    expect(result.stdout).toContain("Nothing to land");
  });
});
