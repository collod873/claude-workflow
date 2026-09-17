import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, onTestFinished } from "vitest";
import { stubGh } from "./agent-workflows/shared/stub-gh.fixture";

const land = fileURLToPath(new URL("../bin/land", import.meta.url));

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
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function sessionAheadOfMain(commits: number, { githubMerges }: { githubMerges: "at once" | "after a moment" | "never" }) {
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
  const gh = stubGh("");
  const run = () =>
    spawnSync(land, [], {
      cwd: session,
      encoding: "utf8",
      env: { ...process.env, PATH: `${dirname(gh.path)}:${process.env.PATH}`, LAND_WAIT_SECONDS: "2" },
    });
  return { remote, session, run, calls: gh.calls };
}

describe("bin/land turns a session's commits into a PR that merges itself", () => {
  it("opens a merge-commit PR from a land branch and brings local main up to the merged main", () => {
    const { remote, session, run, calls } = sessionAheadOfMain(2, { githubMerges: "at once" });
    const head = git(session, "rev-parse", "HEAD");
    const branch = `land/${head.slice(0, 12)}`;

    const result = run();

    expect(result.status, result.stderr).toBe(0);
    expect(calls()).toContainEqual(["pr", "create", "--base", "main", "--head", branch, "--title", "change 2", "--body", "- change 1\n- change 2"]);
    expect(calls()).toContainEqual(["pr", "merge", branch, "--auto", "--merge", "--match-head-commit", head]);
    expect(git(session, "rev-parse", "HEAD")).toBe(git(remote, "rev-parse", "main"));
    expect(git(session, "rev-parse", "HEAD^2")).toBe(head);
    expect(result.stdout).toContain("Landed");
  });

  it("waits for a merge GitHub finishes a moment after auto-merge is switched on", () => {
    const { remote, session, run } = sessionAheadOfMain(1, { githubMerges: "after a moment" });

    const result = run();

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("Landed");
    expect(git(session, "rev-parse", "HEAD")).toBe(git(remote, "rev-parse", "main"));
  });

  it("leaves local main alone and says so while the PR's checks are still running", () => {
    const { session, run } = sessionAheadOfMain(1, { githubMerges: "never" });
    const head = git(session, "rev-parse", "HEAD");

    const result = run();

    expect(result.status, result.stderr).toBe(0);
    expect(git(session, "rev-parse", "HEAD")).toBe(head);
    expect(result.stdout).toContain("Merges when its checks pass");
  });

  it("opens nothing when there is nothing past origin/main", () => {
    const { run, calls } = sessionAheadOfMain(0, { githubMerges: "at once" });

    const result = run();

    expect(result.status, result.stderr).toBe(0);
    expect(calls()).toEqual([]);
    expect(result.stdout).toContain("Nothing to land");
  });
});
