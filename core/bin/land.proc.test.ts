import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, onTestFinished } from "vitest";

const land = fileURLToPath(new URL("./land", import.meta.url));

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

function recordingGh(root: string) {
  const dir = join(root, "gh");
  mkdirSync(dir);
  const path = join(dir, "gh");
  const log = join(dir, "argv.jsonl");
  writeFileSync(path, `#!/bin/bash\npython3 -c 'import json,sys; print(json.dumps(sys.argv[1:]))' "$@" >> ${JSON.stringify(log)}\n`);
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
  { githubMerges, prIsAlreadyClean = false }: { githubMerges: "at once" | "after a moment" | "never"; prIsAlreadyClean?: boolean },
) {
  const root = mkdtempSync(join(tmpdir(), "land-"));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const remote = join(root, "remote.git");
  const session = join(root, "session");
  git(root, "init", "--quiet", "--bare", "--initial-branch=main", remote);
  git(remote, "config", "user.email", "github@test");
  git(remote, "config", "user.name", "github");
  git(root, "clone", "--quiet", remote, session);
  git(session, "config", "user.email", "session@test");
  git(session, "config", "user.name", "session");
  git(session, "commit", "--quiet", "--allow-empty", "-m", "base");
  git(session, "push", "--quiet", "origin", "main");
  for (let n = 1; n <= commits; n++) {
    git(session, "commit", "--quiet", "--allow-empty", "-m", `change ${n}`);
  }
  if (githubMerges !== "never") {
    const hook = githubMerges === "after a moment" ? githubMergesLandBranchesAfterAMoment : githubMergesLandBranches;
    writeFileSync(join(remote, "hooks", "post-receive"), hook);
    chmodSync(join(remote, "hooks", "post-receive"), 0o755);
  }
  const gh = recordingGh(root);
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
  return { remote, session, head, branch: `land/${head.slice(0, 12)}`, run, calls: gh.calls };
}

describe("core/bin/land turns a session's commits into a PR that merges itself", () => {
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

  it("opens nothing when there is nothing past origin/main", () => {
    const { run, calls } = sessionAheadOfMain(0, { githubMerges: "at once" });

    const result = run();

    expect(result.status, result.stderr).toBe(0);
    expect(calls()).toEqual([]);
    expect(result.stdout).toContain("Nothing to land");
  });
});
