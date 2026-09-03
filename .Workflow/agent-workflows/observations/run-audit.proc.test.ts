import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { execGit } from "../shared/git";
import { createFakeGit } from "../shared/git.fake";
import { createRecordingGh } from "../shared/gh.fake";
import { createFakeStage } from "../shared/stage.fake";
import { stubClaudeCli } from "../shared/claude-cli.stub";
import { scratchDir } from "../shared/scratch.fixture";
import { makeBareRepo, makeTempRepo, noteOnRemote, type TempRepo } from "../shared/temp-repo.fixture";
import { sessionRecord } from "./session-record.fixture";
import { writeSessionRecord } from "./session-notes";
import { AUDIT_DISPATCH_ACTION, KNOWLEDGE_BASE_CHECKOUT_DIR, runAudit } from "./run-audit";

const RUN_AUDIT_PATH = fileURLToPath(new URL("./run-audit.ts", import.meta.url));

/** The standards file the CLI reads from the checkout it is pointed at. */
const STANDARDS = "entry: never duplicate validation logic";

/** A throwaway git repo with a bare `origin` — `runAudit` fetches notes refs from one before it reads anything. */
function makeRepo(): { repo: TempRepo; origin: string } {
  const origin = makeBareRepo("run-audit-origin");
  return { repo: makeTempRepo("run-audit", { origin }), origin };
}

/** Commits `a.ts` at `export const a = <value>` — the one-line change every range below is made of. */
function commitA(repo: TempRepo, value: number, message: string): string {
  repo.write("a.ts", `export const a = ${value};\n`);
  return repo.commit(message);
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

/** A session record at `head` whose range is `base..head`, written to the repo's notes and — unless `spine` is omitted — to the corpus. */
function recordSession(repo: TempRepo, range: { head: string; base: string; touchedPaths?: string[] }, spine?: string): void {
  const record = sessionRecord(range);
  writeSessionRecord({ git: execGit, repoDir: repo.dir, record });
  if (spine !== undefined) writeCorpusFile(repo.dir, record.corpusPath, spine);
}

/** The spine of a session the corpus captured in full — enough front matter and prompt for hydration to read it as a real one. */
const FULL_SPINE = "---\nsession_id: session-123\n---\n\n## User Prompts\n- do the thing\n";

/**
 * `runAudit` against `repo` at `head` with the real git, a silent log, and the audit dispatch
 * action — every fixture-repo test's call, differing only in the stage's answer and what the
 * test wants to watch.
 */
function audit(
  repo: TempRepo,
  head: string,
  stageOutput: string,
  options: { gh?: ReturnType<typeof createRecordingGh>; log?: (line: string) => void } = {},
) {
  const stage = createFakeStage(stageOutput);
  const outcome = runAudit({
    git: execGit,
    gh: (options.gh ?? createRecordingGh()).gh,
    exec: stage.exec,
    repoDir: repo.dir,
    head,
    standards: STANDARDS,
    eventAction: AUDIT_DISPATCH_ACTION,
    log: options.log ?? (() => {}),
  });
  return { outcome, stage };
}

describe("runAudit — scope: which dispatches are judged at all", () => {
  it("makes no git or exec call when the dispatch action isn't an audit", async () => {
    const git = createFakeGit();
    const stage = createFakeStage("");

    const outcome = await runAudit({
      git: git.git,
      gh: createRecordingGh().gh,
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
    const { repo } = makeRepo();
    const head = commitA(repo, 1, "seed");

    const { outcome, stage } = audit(repo, head, "");

    expect(await outcome).toEqual({ action: "skipped", code: "no-session-record", releasedCount: 0, ratificationDue: false });
    expect(stage.calls).toEqual([]);
  });

  it("skips with no exec call when the session record's own range is empty", async () => {
    const { repo } = makeRepo();
    const head = commitA(repo, 1, "seed");
    recordSession(repo, { head, base: head }, "---\nsession spine\n");

    const { outcome, stage } = audit(repo, head, "");

    expect(await outcome).toEqual({ action: "skipped", code: "empty-range", releasedCount: 0, ratificationDue: false });
    expect(stage.calls).toEqual([]);
  });
});

describe("runAudit — a session record whose corpus file is missing", () => {
  it("skips with corpus-missing and makes no exec call, before any model call", async () => {
    const { repo } = makeRepo();
    const base = commitA(repo, 1, "seed");
    const head = commitA(repo, 2, "the session's own commit");
    // No spine — the corpus checkout is absent entirely, so hydration must
    // fail on a session record that otherwise looks ordinary.
    recordSession(repo, { head, base, touchedPaths: ["a.ts"] });

    const { outcome, stage } = audit(repo, head, "");

    expect(await outcome).toEqual({ action: "skipped", code: "corpus-missing", releasedCount: 0, ratificationDue: false });
    expect(stage.calls).toEqual([]);
  });
});

describe("runAudit — an ordinary session", () => {
  it("runs both lenses, pushes one merged note, evaluates ratification scope with prdClosed false, and reports the released count", async () => {
    const { repo, origin } = makeRepo();
    const base = commitA(repo, 1, "seed");
    const head = commitA(repo, 2, "the session's own commit");
    recordSession(repo, { head, base, touchedPaths: ["a.ts"] }, FULL_SPINE);
    const gh = createRecordingGh();
    const logs: string[] = [];

    const { outcome } = audit(repo, head, "Finding: duplicated validation logic\nSite: a.ts:1\n", { gh, log: (line) => logs.push(line) });

    // VIOLATION carries no two-site gate (always released); PROPOSED's first
    // sighting does not clear it — so exactly one of the two lands released.
    expect(await outcome).toEqual({ action: "ran", code: "audited", releasedCount: 1, ratificationDue: false });
    expect(logs.some((line) => line.includes("released 1"))).toBe(true);

    // Below `DEFAULT_RATIFICATION_THRESHOLD` and `prdClosed: false` — the trigger never fires, so
    // the ratifier lane's door was not rung and no `gh` call was made at all.
    expect(gh.calls).toEqual([]);

    const note = JSON.parse(noteOnRemote(origin, "observations", head)) as unknown[];
    expect(note).toEqual([
      { finding: "duplicated validation logic", lens: "PROPOSED", sites: ["a.ts:1"], released: false },
      { finding: "duplicated validation logic", lens: "VIOLATION", sites: ["a.ts:1"], released: true },
    ]);
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

/** A repo with the standards file the CLI reads and one seed commit — the checkout every CLI run below is pointed at. */
function makeCliRepo(): { repo: TempRepo; seed: string } {
  const { repo } = makeRepo();
  repo.write("CODING_STANDARDS.md", `${STANDARDS}\n`);
  return { repo, seed: commitA(repo, 1, "seed") };
}

/** Runs the real `run-audit.ts` entrypoint against `repo` at `head` and returns its stdout. */
function runCli(repo: TempRepo, head: string, base: NodeJS.ProcessEnv = process.env): string {
  return execFileSync("npx", ["tsx", RUN_AUDIT_PATH], { env: cliEnv(base, repo.dir, head), encoding: "utf8" });
}

describe("run-audit.ts (CLI) exit code", () => {
  it("exits 0 and reports skipped when the head has no session record", () => {
    const { repo, seed } = makeCliRepo();

    expect(runCli(repo, seed)).toContain("skipped (no-session-record)");
  });

  it("exits 0 and reports skipped when the session record's own range is empty", () => {
    const { repo, seed } = makeCliRepo();
    recordSession(repo, { head: seed, base: seed }, "---\nsession spine\n");

    expect(runCli(repo, seed)).toContain("skipped (empty-range)");
  });

  it("exits 0 and reports the released count when every step succeeds", () => {
    const { repo, seed: base } = makeCliRepo();
    const head = commitA(repo, 2, "the session's own commit");
    recordSession(repo, { head, base, touchedPaths: ["a.ts"] }, FULL_SPINE);
    const { env } = stubClaudeCli(scratchDir("run-audit-stub"), "Finding: duplicated validation logic\nSite: a.ts:1\n");

    expect(runCli(repo, head, env)).toContain("ran (audited): released 1");
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
