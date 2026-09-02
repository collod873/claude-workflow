import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { GhExec } from "../shared/gh";
import { execGit } from "../shared/git";
import { createFakeGit } from "../shared/git.fake";
import { createFakeStage } from "../shared/stage.fake";
import { stubClaudeCli } from "../shared/claude-cli.stub";
import { sessionRecord } from "./session-record.fixture";
import { writeSessionRecord } from "./session-notes";
import { AUDIT_DISPATCH_ACTION, KNOWLEDGE_BASE_CHECKOUT_DIR, runAudit } from "./run-audit";

const RUN_AUDIT_PATH = fileURLToPath(new URL("./run-audit.ts", import.meta.url));

/** A throwaway git repo with a bare `origin` — `runAudit` fetches notes refs from one before it reads anything. */
function makeRepo(): {
  dir: string;
  origin: string;
  commit: (path: string, contents: string, message: string) => string;
} {
  const origin = mkdtempSync(join(tmpdir(), "run-audit-origin-"));
  execFileSync("git", ["init", "-q", "--bare", origin]);

  const dir = mkdtempSync(join(tmpdir(), "run-audit-"));
  execFileSync("git", ["init", "-q", dir]);
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: dir });
  execFileSync("git", ["remote", "add", "origin", origin], { cwd: dir });

  function commit(path: string, contents: string, message: string): string {
    writeFileSync(join(dir, path), contents, "utf8");
    execFileSync("git", ["add", "."], { cwd: dir });
    execFileSync("git", ["commit", "-q", "-m", message], { cwd: dir });
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir, encoding: "utf8" }).trim();
  }

  return { dir, origin, commit };
}

/**
 * Writes `spine` under `<repoDir>/knowledge-base/<corpusPath>` — the corpus
 * checkout `runAudit` reads via `KNOWLEDGE_BASE_CHECKOUT_DIR`, so a session
 * record's hydration succeeds. Every test whose record is meant to reach
 * `runObservations`, or to reach the empty-range check past hydration, needs
 * this; a test proving `corpus-missing` deliberately skips it instead.
 */
function writeCorpusFile(repoDir: string, corpusPath: string, spine: string): void {
  const path = join(repoDir, KNOWLEDGE_BASE_CHECKOUT_DIR, corpusPath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, spine, "utf8");
}

/** A minimal recording `GhExec` — the seam the ratification-due dispatch would go out through. */
function fakeGh(): { gh: GhExec; calls: string[][] } {
  const calls: string[][] = [];
  const gh: GhExec = (args) => {
    calls.push(args);
    return "https://github.com/owner/repo/pull/1\n";
  };
  return { gh, calls };
}

/** Reads back the note a fresh clone of `origin` sees for `sha` on `ref` — mirrors `notes-sync.test.ts`'s `verifyNote`. */
function verifyNote(origin: string, ref: string, sha: string): string {
  const verifyDir = mkdtempSync(join(tmpdir(), "run-audit-verify-"));
  execFileSync("git", ["clone", "-q", origin, "."], { cwd: verifyDir });
  execFileSync("git", ["-C", verifyDir, "fetch", "-q", "origin", `+refs/notes/${ref}:refs/notes/${ref}`]);
  dirs.push(verifyDir);
  return execFileSync("git", ["-C", verifyDir, "notes", `--ref=${ref}`, "show", sha], { encoding: "utf8" }).trim();
}

let dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs = [];
});

describe("runAudit — scope: which dispatches are judged at all", () => {
  it("makes no git or exec call when the dispatch action isn't an audit", async () => {
    const git = createFakeGit();
    const stage = createFakeStage("");

    const outcome = await runAudit({
      git: git.git,
      gh: fakeGh().gh,
      exec: stage.exec,
      repoDir: "/some/repo",
      head: "deadbeef",
      standards: "",
      eventAction: "prd-closed",
      log: () => {},
    });

    expect(outcome).toEqual({ action: "skipped", code: "not-an-audit-dispatch", releasedCount: 0, ratificationDue: false });
    expect(git.calls).toEqual([]);
    expect(stage.calls).toEqual([]);
  });
});

describe("runAudit — a session with nothing to read spends no model", () => {
  it("skips with no exec call when there is no session record at head", async () => {
    const repo = makeRepo();
    dirs.push(repo.dir, repo.origin);

    const head = repo.commit("a.ts", "export const a = 1;\n", "seed");
    const stage = createFakeStage("");

    const outcome = await runAudit({
      git: execGit,
      gh: fakeGh().gh,
      exec: stage.exec,
      repoDir: repo.dir,
      head,
      standards: "",
      eventAction: AUDIT_DISPATCH_ACTION,
      log: () => {},
    });

    expect(outcome).toEqual({ action: "skipped", code: "no-session-record", releasedCount: 0, ratificationDue: false });
    expect(stage.calls).toEqual([]);
  });

  it("skips with no exec call when the session record's own range is empty", async () => {
    const repo = makeRepo();
    dirs.push(repo.dir, repo.origin);

    const head = repo.commit("a.ts", "export const a = 1;\n", "seed");
    const record = sessionRecord({ head, base: head });
    writeSessionRecord({ git: execGit, repoDir: repo.dir, record });
    writeCorpusFile(repo.dir, record.corpusPath, "---\nsession spine\n");
    const stage = createFakeStage("");

    const outcome = await runAudit({
      git: execGit,
      gh: fakeGh().gh,
      exec: stage.exec,
      repoDir: repo.dir,
      head,
      standards: "",
      eventAction: AUDIT_DISPATCH_ACTION,
      log: () => {},
    });

    expect(outcome).toEqual({ action: "skipped", code: "empty-range", releasedCount: 0, ratificationDue: false });
    expect(stage.calls).toEqual([]);
  });
});

describe("runAudit — a session record whose corpus file is missing", () => {
  it("skips with corpus-missing and makes no exec call, before any model call", async () => {
    const repo = makeRepo();
    dirs.push(repo.dir, repo.origin);

    const base = repo.commit("a.ts", "export const a = 1;\n", "seed");
    const head = repo.commit("a.ts", "export const a = 2;\n", "the session's own commit");
    writeSessionRecord({
      git: execGit,
      repoDir: repo.dir,
      record: sessionRecord({ head, base, touchedPaths: ["a.ts"] }),
    });
    // No `writeCorpusFile` call — the corpus checkout is absent entirely, so
    // hydration must fail on a session record that otherwise looks ordinary.
    const stage = createFakeStage("");

    const outcome = await runAudit({
      git: execGit,
      gh: fakeGh().gh,
      exec: stage.exec,
      repoDir: repo.dir,
      head,
      standards: "",
      eventAction: AUDIT_DISPATCH_ACTION,
      log: () => {},
    });

    expect(outcome).toEqual({ action: "skipped", code: "corpus-missing", releasedCount: 0, ratificationDue: false });
    expect(stage.calls).toEqual([]);
  });
});

describe("runAudit — an ordinary session", () => {
  it("runs both lenses, pushes one merged note, evaluates ratification scope with prdClosed false, and reports the released count", async () => {
    const repo = makeRepo();
    dirs.push(repo.dir, repo.origin);

    const base = repo.commit("a.ts", "export const a = 1;\n", "seed");
    const head = repo.commit("a.ts", "export const a = 2;\n", "the session's own commit");
    const record = sessionRecord({ head, base, touchedPaths: ["a.ts"] });
    writeSessionRecord({ git: execGit, repoDir: repo.dir, record });
    writeCorpusFile(repo.dir, record.corpusPath, "---\nsession_id: session-123\n---\n\n## User Prompts\n- do the thing\n");

    const stage = createFakeStage("Finding: duplicated validation logic\nSite: a.ts:1\n");
    const gh = fakeGh();
    const logs: string[] = [];

    const outcome = await runAudit({
      git: execGit,
      gh: gh.gh,
      exec: stage.exec,
      repoDir: repo.dir,
      head,
      standards: "entry: never duplicate validation logic",
      eventAction: AUDIT_DISPATCH_ACTION,
      log: (line) => logs.push(line),
    });

    // VIOLATION carries no two-site gate (always released); PROPOSED's first
    // sighting does not clear it — so exactly one of the two lands released.
    expect(outcome).toEqual({ action: "ran", code: "audited", releasedCount: 1, ratificationDue: false });
    expect(logs.some((line) => line.includes("released 1"))).toBe(true);

    // Below `DEFAULT_RATIFICATION_THRESHOLD` and `prdClosed: false` — the trigger never fires, so
    // the ratifier lane's door was not rung and no `gh` call was made at all.
    expect(gh.calls).toEqual([]);

    const note = JSON.parse(verifyNote(repo.origin, "observations", head)) as unknown[];
    expect(note).toEqual([
      { finding: "duplicated validation logic", lens: "PROPOSED", sites: ["a.ts:1"], released: false },
      { finding: "duplicated validation logic", lens: "VIOLATION", sites: ["a.ts:1"], released: true },
    ]);
  });
});

describe("audit.yml agrees with the scope rule it is a copy of", () => {
  const workflow = readFileSync(
    fileURLToPath(new URL("../../../.github/workflows/audit.yml", import.meta.url)),
    "utf8",
  );

  // #314, ADR-0055 (amended by ADR-0132): the trigger moved to the caller stub, since a reusable
  // workflow's own `on:` is `workflow_call` — see the block below.
  it("is reusable — a caller supplies the trigger", () => {
    expect(workflow).toMatch(/^"on":\s*\n\s*workflow_call:/m);
  });

  it("gates the job on the same dispatch action the entrypoint checks", () => {
    expect(workflow).toContain(`action == '${AUDIT_DISPATCH_ACTION}'`);
  });

  // Spec #134 §"The runner reads the corpus over a deploy key": the checkout that lands
  // Knowledge-Base on the runner has to land it at the same directory `readSessionRecord` reads
  // via `KNOWLEDGE_BASE_CHECKOUT_DIR`, joined onto whichever checkout `TARGET_WORKSPACE` names
  // (#314) — no compiler sees across the YAML/TypeScript boundary, so this test does.
  it("checks out Knowledge-Base at the directory the entrypoint reads it from", () => {
    expect(workflow).toContain("repository: collod873/Knowledge-Base");
    expect(workflow).toContain(`path: target/${KNOWLEDGE_BASE_CHECKOUT_DIR}`);
  });
});

describe("audit-caller.yml gates the reusable workflow", () => {
  const source = readFileSync(
    fileURLToPath(new URL("../../../.github/workflows/audit-caller.yml", import.meta.url)),
    "utf8",
  );

  it("triggers on repository_dispatch", () => {
    expect(source).toMatch(/repository_dispatch/);
  });

  it("calls the reusable workflow at @main, never a pinned SHA or tag", () => {
    expect(source).toContain("collod873/claude-workflow/.github/workflows/audit.yml@main");
  });

  it("inherits secrets, since audit.yml spends CLAUDE_CODE_OAUTH_TOKEN and KNOWLEDGE_BASE_DEPLOY_KEY", () => {
    expect(source).toMatch(/secrets:\s*inherit/);
  });
});

/**
 * The environment one CLI child gets. `TARGET_WORKSPACE` is cleared rather
 * than inherited: every lane's runner exports it (ADR-0055) and `run-audit.ts`
 * reads it *ahead* of `GITHUB_WORKSPACE`, so a child that inherited the
 * runner's would audit the lane's own target checkout instead of the repo this
 * test just built. That reads green on a workstation, where nothing sets it,
 * and red on every runner — which is what left lane 08 unable to push a merge
 * at all, for any pull request, since #327.
 */
function cliEnv(base: NodeJS.ProcessEnv, repoDir: string, head: string): NodeJS.ProcessEnv {
  return {
    ...base,
    TARGET_WORKSPACE: "",
    GITHUB_WORKSPACE: repoDir,
    HEAD_SHA: head,
    EVENT_ACTION: AUDIT_DISPATCH_ACTION,
  };
}

describe("run-audit.ts (CLI) exit code", () => {
  it("exits 0 and reports skipped when the head has no session record", () => {
    const repo = makeRepo();
    dirs.push(repo.dir, repo.origin);
    writeFileSync(join(repo.dir, "CODING_STANDARDS.md"), "entry: never duplicate validation logic\n", "utf8");
    const head = repo.commit("a.ts", "export const a = 1;\n", "seed");

    const stdout = execFileSync("npx", ["tsx", RUN_AUDIT_PATH], {
      env: cliEnv(process.env, repo.dir, head),
      encoding: "utf8",
    });

    expect(stdout).toContain("skipped (no-session-record)");
  });

  it("exits 0 and reports skipped when the session record's own range is empty", () => {
    const repo = makeRepo();
    dirs.push(repo.dir, repo.origin);
    writeFileSync(join(repo.dir, "CODING_STANDARDS.md"), "entry: never duplicate validation logic\n", "utf8");
    const head = repo.commit("a.ts", "export const a = 1;\n", "seed");
    const record = sessionRecord({ head, base: head });
    writeSessionRecord({ git: execGit, repoDir: repo.dir, record });
    writeCorpusFile(repo.dir, record.corpusPath, "---\nsession spine\n");

    const stdout = execFileSync("npx", ["tsx", RUN_AUDIT_PATH], {
      env: cliEnv(process.env, repo.dir, head),
      encoding: "utf8",
    });

    expect(stdout).toContain("skipped (empty-range)");
  });

  it("exits 0 and reports the released count when every step succeeds", () => {
    const repo = makeRepo();
    dirs.push(repo.dir, repo.origin);
    writeFileSync(join(repo.dir, "CODING_STANDARDS.md"), "entry: never duplicate validation logic\n", "utf8");

    const base = repo.commit("a.ts", "export const a = 1;\n", "seed");
    const head = repo.commit("a.ts", "export const a = 2;\n", "the session's own commit");
    const record = sessionRecord({ head, base, touchedPaths: ["a.ts"] });
    writeSessionRecord({ git: execGit, repoDir: repo.dir, record });
    writeCorpusFile(repo.dir, record.corpusPath, "---\nsession_id: session-123\n---\n\n## User Prompts\n- do the thing\n");

    const stubDir = mkdtempSync(join(tmpdir(), "run-audit-stub-"));
    dirs.push(stubDir);
    const { env } = stubClaudeCli(stubDir, "Finding: duplicated validation logic\nSite: a.ts:1\n");

    const stdout = execFileSync("npx", ["tsx", RUN_AUDIT_PATH], {
      env: cliEnv(env, repo.dir, head),
      encoding: "utf8",
    });

    expect(stdout).toContain("ran (audited): released 1");
  });

  it("exits nonzero only when a step throws — a missing HEAD_SHA", () => {
    expect(() =>
      execFileSync("npx", ["tsx", RUN_AUDIT_PATH], {
        env: { ...process.env, HEAD_SHA: "", EVENT_ACTION: AUDIT_DISPATCH_ACTION },
        encoding: "utf8",
      }),
    ).toThrow();
  });
});
