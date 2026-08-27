import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ADR_CORPUS_EVIDENCE_PATH, SESSION_PROMPTS_PATH } from "./scrub-corpus-history.ts";

/**
 * #141: the one `git filter-repo` pass. #134's acceptance criteria ask for one suite that stays
 * green whether or not the runner carries the tool — so this file decides that for itself, once,
 * at load time (`FILTER_REPO_PRESENT`), rather than letting a missing tool fail a test that was
 * never about having it. The "tool is missing" behaviour is asserted unconditionally: `PATH` is
 * rewritten per-run (`pathWithoutGitFilterRepo`) to guarantee that case regardless of what this
 * machine actually has installed, which is what lets both halves of the criteria hold on the same
 * machine without needing two.
 */

const SCRIPT = join(import.meta.dirname, "scrub-corpus-history.ts");

function hasGitFilterRepo(): boolean {
  try {
    execFileSync("git", ["filter-repo", "--version"], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

const FILTER_REPO_PRESENT = hasGitFilterRepo();

/**
 * `process.env.PATH`, minus every directory that carries a `git-filter-repo` executable — a
 * deterministic "the tool is not on PATH", true regardless of whether this machine has the tool
 * installed for real. The alternative — trusting the ambient PATH to already lack it — would make
 * this half of the suite depend on the runner it happens to execute on, which is exactly the
 * coupling the acceptance criteria call out by name.
 */
function pathWithoutGitFilterRepo(): string {
  const dirs = (process.env.PATH ?? "").split(":").filter(Boolean);
  return dirs.filter((dir) => !existsSync(join(dir, "git-filter-repo"))).join(":");
}

function initRepo(dir: string): void {
  execFileSync("git", ["init", "-q", "-b", "main", dir]);
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: dir });
}

function commitFile(dir: string, relPath: string, content: string, message: string): void {
  const full = join(dir, relPath);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content, "utf8");
  execFileSync("git", ["add", "-A"], { cwd: dir });
  execFileSync("git", ["commit", "-q", "-m", message], { cwd: dir });
}

/**
 * A throwaway repo carrying several commits against both target paths: two superseded versions of
 * each, plus a final commit that shrinks `adr-corpus.evidence.json` down to what `HEAD` should
 * keep — the shape #134's criteria describe ("both target paths across several commits").
 */
function buildFixtureRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "scrub-corpus-history-fixture-"));
  initRepo(dir);
  commitFile(dir, SESSION_PROMPTS_PATH, "verbatim prompt body, session one\n", "c1: add both files");
  commitFile(dir, ADR_CORPUS_EVIDENCE_PATH, "evidence full body, version one\n", "c1: add both files (evidence)");
  commitFile(
    dir,
    SESSION_PROMPTS_PATH,
    "verbatim prompt body, session two — more of the owner's own words\n",
    "c2: update both",
  );
  commitFile(
    dir,
    ADR_CORPUS_EVIDENCE_PATH,
    "evidence full body, version two — a whole research note embedded here\n",
    "c2: update both (evidence)",
  );
  commitFile(
    dir,
    ADR_CORPUS_EVIDENCE_PATH,
    "evidence, trimmed to only what HEAD should keep\n",
    "c3: shrink evidence to its current, kept content",
  );
  return dir;
}

function runScript(
  repoPath: string,
  env: NodeJS.ProcessEnv = process.env,
): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [SCRIPT, repoPath], { encoding: "utf8", env });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function gitLog(repoPath: string, ...args: string[]): string {
  return execFileSync("git", ["-C", repoPath, "log", "--all", "-p", "--", ...args], {
    encoding: "utf8",
  });
}

describe("scrub-corpus-history", () => {
  const dirs: string[] = [];
  afterEach(() => {
    while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
  });

  it("exits non-zero and names GitFilterRepoNotFoundError when git filter-repo isn't on PATH", () => {
    const dir = buildFixtureRepo();
    dirs.push(dir);

    const result = runScript(dir, { ...process.env, PATH: pathWithoutGitFilterRepo() });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("GitFilterRepoNotFoundError");

    // A refusal, not a partial rewrite: nothing about the repo moved — `cat-file -e` throws (and
    // so fails this test) if the path is no longer at HEAD.
    execFileSync("git", ["-C", dir, "cat-file", "-e", `HEAD:${SESSION_PROMPTS_PATH}`], {
      stdio: "pipe",
    });
  });

  it.skipIf(!FILTER_REPO_PRESENT)(
    "strips pre-scrub content of both paths from all reachable history, keeping HEAD's evidence bytes intact",
    () => {
      const dir = buildFixtureRepo();
      dirs.push(dir);
      const tipEvidence = readFileSync(join(dir, ADR_CORPUS_EVIDENCE_PATH), "utf8");

      const result = runScript(dir);
      expect(result.status).toBe(0);

      const sessionPromptsHistory = gitLog(dir, SESSION_PROMPTS_PATH);
      expect(sessionPromptsHistory).not.toContain("verbatim prompt body");

      const evidenceHistory = gitLog(dir, ADR_CORPUS_EVIDENCE_PATH);
      expect(evidenceHistory).not.toContain("version one");
      expect(evidenceHistory).not.toContain("version two");
      expect(evidenceHistory).not.toContain("a whole research note embedded here");

      const headEvidence = execFileSync(
        "git",
        ["-C", dir, "show", `HEAD:${ADR_CORPUS_EVIDENCE_PATH}`],
        { encoding: "utf8" },
      );
      expect(headEvidence).toBe(tipEvidence);
    },
  );
});
