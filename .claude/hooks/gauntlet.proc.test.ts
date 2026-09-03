import { spawnSync } from "node:child_process";
import { chmodSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { scratchDir } from "../../.Workflow/agent-workflows/shared/scratch.fixture.ts";

// The hook and the runner, driven as the processes they are: a hook's contract is its exit code
// and its stdout, and a runner's is which slots it ran. The toolchain is stubbed throughout —
// the hook is pointed at a gauntlet that answers with a canned exit (`GAUNTLET_BIN`), and the
// runner at a contract whose every slot is a shell one-liner (`GAUNTLET_CONTRACT`). Nothing here
// runs a real tsc, eslint or vitest.

const REPO_ROOT = resolve(import.meta.dirname, "../..");
const HOOK = join(REPO_ROOT, ".claude/hooks/gauntlet.sh");
const GAUNTLET = join(REPO_ROOT, "bin/gauntlet");

type Run = { status: number | null; stdout: string; stderr: string };

function runHook(venue: string, payload: string, env: Record<string, string> = {}): Run {
  // WORKFLOW_STAGE defaults off rather than inherited: this suite is itself something a stage's
  // model can run from a Bash tool, and an ambient "1" would silence every case below.
  const run = spawnSync(HOOK, [venue], {
    input: payload,
    encoding: "utf8",
    cwd: REPO_ROOT,
    env: { ...process.env, WORKFLOW_STAGE: "", ...env },
  });
  return { status: run.status, stdout: run.stdout, stderr: run.stderr };
}

/** A gauntlet that reports whatever the test needs it to, without running any checks. */
function stubGauntlet(exitCode: number, stdout = ""): string {
  const path = join(scratchDir("gauntlet-stub"), "gauntlet");
  // Absolute interpreter, as the real scripts: the PATH-scrubbed cases below would otherwise fail
  // on the stub rather than on the code under test. `%b` so the fixtures' `\n` are real newlines.
  writeFileSync(path, `#!/bin/bash\nprintf '%b' ${JSON.stringify(stdout)}\nexit ${exitCode}\n`);
  chmodSync(path, 0o755);
  return path;
}

const editOf = (filePath: string) =>
  JSON.stringify({ hook_event_name: "PostToolUse", tool_input: { file_path: filePath } });
const STOP = JSON.stringify({ hook_event_name: "Stop" });

describe("the hook", () => {
  it("hands a failure back to Claude rather than refusing the edit", () => {
    const result = runHook("turn", editOf("a.ts"), { GAUNTLET_BIN: stubGauntlet(1, "--- typecheck ---\nerror TS2322: nope\n") });

    // exit 0 is load-bearing: JSON emitted alongside a non-zero exit is discarded by the harness.
    expect(result.status).toBe(0);
    const out = JSON.parse(result.stdout);
    expect(out.decision).toBe("block");
    expect(out.reason).toContain("error TS2322: nope");
  });

  it("says nothing on a green run, and nothing about a file it has nothing to say about", () => {
    expect(runHook("turn", editOf("a.ts"), { GAUNTLET_BIN: stubGauntlet(0) }).stdout).toBe("");
    expect(runHook("turn", editOf("README.md"), { GAUNTLET_BIN: stubGauntlet(1, "never") }).stdout).toBe("");
  });

  it("reports a turn-end failure once, then stays quiet so a red suite mid-task cannot hold the session", () => {
    const gauntlet = stubGauntlet(1, "--- test ---\n1 failed\n");

    const first = runHook("stop", STOP, { GAUNTLET_BIN: gauntlet });
    const again = runHook("stop", JSON.stringify({ hook_event_name: "Stop", stop_hook_active: true }), {
      GAUNTLET_BIN: gauntlet,
    });

    expect(JSON.parse(first.stdout).reason).toContain("1 failed");
    expect(again.status).toBe(0);
    expect(again.stdout).toBe("");
  });

  // A stage is one agent process in a pipeline run, and its contract is that its last message is
  // an `<output>` block. Blocking asks for another turn, and the turn it gets is spent on the
  // hook: #134 died that way. Both venues are covered because a stage has no human to read either.
  it("says nothing inside a stage session, at either venue", () => {
    const gauntlet = stubGauntlet(1, "--- test ---\n1 failed\n");
    const stage = { WORKFLOW_STAGE: "1", GAUNTLET_BIN: gauntlet };

    expect(runHook("stop", STOP, stage).stdout).toBe("");
    expect(runHook("turn", editOf("a.ts"), stage).stdout).toBe("");
    // The gate is the marker, not the venue: with it absent the same run reports.
    expect(JSON.parse(runHook("stop", STOP, { GAUNTLET_BIN: gauntlet }).stdout).decision).toBe("block");
  });

  it("stays quiet on a payload it cannot parse", () => {
    const result = runHook("turn", "not json at all", { GAUNTLET_BIN: stubGauntlet(1, "never") });

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
  });

  it("stays silent when node is absent, and reports when the finder turns it up", () => {
    // The shim's degraded case, made true rather than approximated: scrubbing PATH proves nothing
    // on a box where node lives in a standard directory (it does on a hosted runner), so both
    // halves pin the finder's whole search list through `NODE_ON_PATH_SEARCH_DIRS` — the seam
    // `bin/node-on-path.sh` offers for exactly this — and each assertion is exact on any machine.
    const absent = spawnSync(HOOK, ["turn"], {
      input: editOf("a.ts"),
      encoding: "utf8",
      cwd: REPO_ROOT,
      env: { PATH: "/nonexistent", NODE_ON_PATH_SEARCH_DIRS: "/nonexistent", GAUNTLET_BIN: stubGauntlet(1) },
    });
    expect(absent.status).toBe(0);
    expect(absent.stdout).toBe("");

    const found = spawnSync(HOOK, ["turn"], {
      input: editOf("a.ts"),
      encoding: "utf8",
      cwd: REPO_ROOT,
      env: {
        PATH: "/nonexistent",
        NODE_ON_PATH_SEARCH_DIRS: dirname(process.execPath),
        GAUNTLET_BIN: stubGauntlet(1, "--- lint ---\nboom\n"),
      },
    });
    expect(found.status).toBe(0);
    expect(JSON.parse(found.stdout).reason).toContain("boom");
  });

  // Both events are hot — every Edit|Write, every turn end — so how often the hook fires and how
  // much it injects has to be countable (machinery-audit-2026-08-27).
  it("records one row per fire, quiet paths included, in the shape hook-report reads", () => {
    const dir = scratchDir("gauntlet-logs");
    const env = { GAUNTLET_BIN: stubGauntlet(1, "--- test ---\n1 failed\ngauntlet: FAILED at test\n"), STOP_GATE_LOG_DIR: dir };

    runHook("stop", JSON.stringify({ hook_event_name: "Stop", session_id: "s1", cwd: REPO_ROOT }), env);
    runHook("turn", editOf("README.md"), env);

    const rows = readdirSync(dir).flatMap((name) =>
      readFileSync(join(dir, name), "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line)),
    );
    expect(rows.map((row) => row.verdict)).toEqual(["failed", "out-of-scope"]);
    expect(rows[0]).toMatchObject({ hook: "gauntlet-hook", event: "Stop", session_id: "s1", venue: "stop", checks: "test" });
    expect(rows[0].seconds).toBeTypeOf("number");
  });
});

/** A contract of shell one-liners, written to a scratch file for `GAUNTLET_CONTRACT`. */
function contractOf(slots: Record<string, string | null>): string {
  const path = join(scratchDir("gauntlet-contract"), "contract.json");
  const contract = Object.fromEntries(Object.entries(slots).map(([name, cmd]) => [name, { cmd, why: "stub" }]));
  writeFileSync(path, JSON.stringify(contract));
  return path;
}

function runGauntlet(args: string[], env: Record<string, string> = {}): Run {
  const run = spawnSync(GAUNTLET, args, { encoding: "utf8", cwd: REPO_ROOT, env: { ...process.env, ...env } });
  return { status: run.status, stdout: run.stdout, stderr: run.stderr };
}

describe("the runner", () => {
  it("is green and silent when every slot the venue names exits 0", () => {
    const run = runGauntlet(["push"], { GAUNTLET_CONTRACT: contractOf({ typecheck: "true", lint: "true", test: "true", clones: "true" }) });

    expect(run.stdout).toBe("");
    expect(run.status).toBe(0);
  });

  it("prints each red slot's output and names them all on the verdict line, exiting 1", () => {
    // A non-zero exit is red whatever the number: `tsc` exits 2 on a type error, and the old
    // "could not run" reading of a 2 is what routed three real failures past the bypass counter.
    const run = runGauntlet(["push"], {
      GAUNTLET_CONTRACT: contractOf({ typecheck: "echo TS2322; exit 2", lint: "true", test: "echo 1 failed; exit 1", clones: "true" }),
    });

    expect(run.status).toBe(1);
    expect(run.stdout).toContain("--- typecheck ---\nTS2322");
    expect(run.stdout).toContain("--- test ---\n1 failed");
    expect(run.stdout.trim().split("\n").at(-1)).toBe("gauntlet: FAILED at typecheck test");
  });

  it("runs the push venue's four slots once each and nothing else", () => {
    const log = join(scratchDir("gauntlet-log"), "ran");
    const mark = (name: string) => `echo ${name} >> ${JSON.stringify(log)}`;
    const contract = contractOf({
      typecheck: mark("typecheck"),
      lint: mark("lint"),
      test: mark("test"),
      clones: mark("clones"),
      lint_one: mark("lint_one"),
      test_related: mark("test_related"),
    });

    expect(runGauntlet(["push"], { GAUNTLET_CONTRACT: contract }).status).toBe(0);

    expect(readFileSync(log, "utf8").trim().split("\n").sort()).toEqual(["clones", "lint", "test", "typecheck"]);
  });

  it("hands the turn venue's file to lint_one and test_related, and skips a slot the contract lacks", () => {
    const log = join(scratchDir("gauntlet-log"), "ran");
    const contract = contractOf({
      typecheck: "true",
      lint_one: `echo lint_one <file> >> ${JSON.stringify(log)}`,
      test_related: `echo test_related <file> >> ${JSON.stringify(log)}`,
      lint: "exit 1",
      test: "exit 1",
    });

    expect(runGauntlet(["turn", "a b.ts"], { GAUNTLET_CONTRACT: contract }).status).toBe(0);

    expect(readFileSync(log, "utf8").trim().split("\n").sort()).toEqual(["lint_one a b.ts", "test_related a b.ts"]);
  });

  it("skips a slot carried as cmd: null — a lane may shrink the gate, never grow it", () => {
    const run = runGauntlet(["push"], { GAUNTLET_CONTRACT: contractOf({ typecheck: "true", lint: null, test: "true", clones: null }) });

    expect(run.status).toBe(0);
  });

  it("runs every slot with its own TARGET_WORKSPACE and GAUNTLET_CONTRACT unset", () => {
    // A slot that could see either would point a nested gauntlet at this run's target (ADR-0139).
    const sees = (name: string) => `test -z "\${${name}:-}"`;
    const contract = contractOf({ typecheck: sees("TARGET_WORKSPACE"), lint: sees("GAUNTLET_CONTRACT"), test: "true", clones: "true" });

    const run = runGauntlet(["push"], { GAUNTLET_CONTRACT: contract, TARGET_WORKSPACE: REPO_ROOT });

    expect(run.stdout).toBe("");
    expect(run.status).toBe(0);
  });

  it("refuses an unknown venue rather than silently checking nothing", () => {
    const run = runGauntlet(["overnight"]);

    expect(run.status).toBe(1);
    expect(run.stderr).toContain("usage:");
  });
});
