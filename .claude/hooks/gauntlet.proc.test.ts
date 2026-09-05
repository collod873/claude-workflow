import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { describe, expect, it, test } from "vitest";
import { scratchDir } from "../../.Workflow/agent-workflows/shared/scratch.fixture.ts";

const REPO_ROOT = resolve(import.meta.dirname, "../..");
const HOOK = join(REPO_ROOT, ".claude/hooks/gauntlet.sh");
const GAUNTLET = join(REPO_ROOT, "bin/gauntlet");

type Run = { status: number | null; stdout: string; stderr: string };

function runHook(venue: string, payload: string, env: Record<string, string> = {}): Run {
  const run = spawnSync(HOOK, [venue], {
    input: payload,
    encoding: "utf8",
    cwd: REPO_ROOT,
    env: { ...process.env, WORKFLOW_STAGE: "", STOP_GATE_LOG_DIR: scratchDir("gauntlet-hook-default-log"), ...env },
  });
  return { status: run.status, stdout: run.stdout, stderr: run.stderr };
}

function stubGauntlet(exitCode: number, stdout = ""): string {
  const path = join(scratchDir("gauntlet-stub"), "gauntlet");
  writeFileSync(path, `#!/bin/bash\nprintf '%b' ${JSON.stringify(stdout)}\nexit ${exitCode}\n`);
  chmodSync(path, 0o755);
  return path;
}

const editOf = (filePath: string) =>
  JSON.stringify({ hook_event_name: "PostToolUse", tool_input: { file_path: filePath } });
const STOP = JSON.stringify({ hook_event_name: "Stop" });

function expectTurnBlockedByTypecheck(payload: string, env: Record<string, string> = {}): void {
  const blocked = runHook("turn", payload, { GAUNTLET_BIN: stubGauntlet(1, "--- typecheck ---\nerror TS2322: nope\n"), ...env });

  expect(blocked.status).toBe(0);
  expect(JSON.parse(blocked.stdout).decision).toBe("block");
  expect(JSON.parse(blocked.stdout).reason).toContain("error TS2322: nope");
}

describe("the hook", () => {
  it("hands a failure back to Claude rather than refusing the edit", () => {
    const result = runHook("turn", editOf("a.ts"), { GAUNTLET_BIN: stubGauntlet(1, "--- typecheck ---\nerror TS2322: nope\n") });

    expect(result.status).toBe(0);
    const out = JSON.parse(result.stdout);
    expect(out.decision).toBe("block");
    expect(out.reason).toContain("error TS2322: nope");
  });

  it("says nothing on a green run, and nothing about a file it has nothing to say about", () => {
    expect(runHook("turn", editOf("a.ts"), { GAUNTLET_BIN: stubGauntlet(0) }).stdout).toBe("");
    expect(runHook("turn", editOf("README.md"), { GAUNTLET_BIN: stubGauntlet(1, "never") }).stdout).toBe("");
  });

  it("says nothing inside a stage session, at the turn venue", () => {
    const gauntlet = stubGauntlet(1, "--- test ---\n1 failed\n");
    const stage = { WORKFLOW_STAGE: "1", GAUNTLET_BIN: gauntlet };

    expect(runHook("turn", editOf("a.ts"), stage).stdout).toBe("");
    expect(JSON.parse(runHook("turn", editOf("a.ts"), { GAUNTLET_BIN: gauntlet }).stdout).decision).toBe("block");
  });

  it("stays quiet on a payload it cannot parse", () => {
    const result = runHook("turn", "not json at all", { GAUNTLET_BIN: stubGauntlet(1, "never") });

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
  });

  it("stays silent when node is absent, and reports when the finder turns it up", () => {
    const absent = spawnSync(HOOK, ["turn"], {
      input: editOf("a.ts"),
      encoding: "utf8",
      cwd: REPO_ROOT,
      env: {
        PATH: "/nonexistent",
        NODE_ON_PATH_SEARCH_DIRS: "/nonexistent",
        GAUNTLET_BIN: stubGauntlet(1),
        STOP_GATE_LOG_DIR: scratchDir("gauntlet-hook-default-log"),
      },
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
        STOP_GATE_LOG_DIR: scratchDir("gauntlet-hook-default-log"),
      },
    });
    expect(found.status).toBe(0);
    expect(JSON.parse(found.stdout).reason).toContain("boom");
  });

  it("records one row per fire, quiet paths included, in the shape hook-report reads", () => {
    const dir = scratchDir("gauntlet-logs");
    const env = { GAUNTLET_BIN: stubGauntlet(1, "--- test ---\n1 failed\ngauntlet: FAILED at test\n"), STOP_GATE_LOG_DIR: dir };

    runHook("turn", editOf("a.ts"), env);
    runHook("turn", editOf("README.md"), env);

    const rows = readdirSync(dir).flatMap((name) =>
      readFileSync(join(dir, name), "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line)),
    );
    expect(rows.map((row) => row.verdict)).toEqual(["failed", "out-of-scope"]);
    expect(rows[0]).toMatchObject({ hook: "gauntlet-hook", event: "PostToolUse", venue: "turn", checks: "test" });
    expect(rows[0].seconds).toBeTypeOf("number");
  });
});

describe("the machine-global stop-gate.py is the one turn-end owner", () => {
  it("#367.2: a Stop payload gets nothing back from the shim, so a stray registration cannot run the suite a second time", () => {
    const result = runHook("stop", STOP, { GAUNTLET_BIN: stubGauntlet(1, "--- test ---\n1 failed\n") });

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
  });

  it("#367.4: the run row's ts is local time at seconds precision, the shape _hook.py writes and active_sessions() reads", () => {
    const dir = scratchDir("gauntlet-logs");
    runHook("turn", editOf(`${REPO_ROOT}/a.ts`), { GAUNTLET_BIN: stubGauntlet(0), STOP_GATE_LOG_DIR: dir, TZ: "Asia/Tokyo" });

    const [row] = readdirSync(dir).flatMap((name) =>
      readFileSync(join(dir, name), "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line)),
    );
    expect(row.ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
    expect(Math.abs(Date.parse(`${row.ts}+09:00`) - Date.now())).toBeLessThan(60_000);
  });

  it("#367.5: docs/agents/venues.md names stop-gate.py as the stop venue's owner", () => {
    const grep = spawnSync("grep", ["-q", "stop-gate.py", "docs/agents/venues.md"], { cwd: REPO_ROOT });

    expect(grep.status).toBe(0);
  });
});

const PY_HOOK = join(REPO_ROOT, ".claude/hooks/_hook.py");

const READ_BACK_WITH_HOOK_PY = `
import importlib.util, json, sys

spec = importlib.util.spec_from_file_location("_hook", sys.argv[1])
hook = importlib.util.module_from_spec(spec)
spec.loader.exec_module(hook)

hook.append_log("pin", {"project": "pin"}, path=sys.argv[3])
with open(sys.argv[3], encoding="utf-8") as fh:
    own = json.loads(fh.readline())["ts"]

print(json.dumps({"ts": own, "sessions": hook.active_sessions(sys.argv[4], log_dir=sys.argv[2])}))
`;

const digitsBlanked = (ts: string) => ts.replace(/\d/g, "d");

describe("the ts shape the shim writes agrees with the _hook.py it is a copy of", () => {
  it("hands _hook.py's active_sessions() a row it parses, in the shape _hook.py's own append_log writes", () => {
    const dir = scratchDir("gauntlet-logs");
    const payload = JSON.stringify({
      hook_event_name: "PostToolUse",
      session_id: "pin-session",
      cwd: REPO_ROOT,
      tool_input: { file_path: `${REPO_ROOT}/a.ts` },
    });
    runHook("turn", payload, { GAUNTLET_BIN: stubGauntlet(0), STOP_GATE_LOG_DIR: dir });

    const rowOfItsOwn = join(scratchDir("hook-py-row"), "row.jsonl");
    const python = spawnSync(
      "python3",
      ["-c", READ_BACK_WITH_HOOK_PY, PY_HOOK, dir, rowOfItsOwn, basename(REPO_ROOT)],
      { encoding: "utf8" },
    );

    expect(python.status, python.stderr).toBe(0);
    const readBack = JSON.parse(python.stdout);
    expect(Object.keys(readBack.sessions)).toEqual(["pin-session"]);
    expect(digitsBlanked(readBack.ts)).toBe(digitsBlanked(readBack.sessions["pin-session"]));
  });
});

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

  it("skips a slot carried as cmd: null, since a lane may shrink the gate, never grow it", () => {
    const run = runGauntlet(["push"], { GAUNTLET_CONTRACT: contractOf({ typecheck: "true", lint: null, test: "true", clones: null }) });

    expect(run.status).toBe(0);
  });

  it("runs every slot with its own TARGET_WORKSPACE and GAUNTLET_CONTRACT unset", () => {
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

function logDirRecordingGauntlet(record: string): string {
  const path = join(scratchDir("gauntlet-env-stub"), "gauntlet");
  writeFileSync(path, `#!/bin/bash\nprintf '%s' "\${STOP_GATE_LOG_DIR:-}" > ${JSON.stringify(record)}\nexit 0\n`);
  chmodSync(path, 0o755);
  return path;
}

function realLogPath(): string {
  const now = new Date();
  const stamp = [
    String(now.getFullYear()).padStart(4, "0"),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
  return join(homedir(), ".claude", "logs", `gauntlet-hook-${stamp}.jsonl`);
}

function realLogLines(path: string): number {
  return existsSync(path) ? readFileSync(path, "utf8").split("\n").filter(Boolean).length : 0;
}

describe("the suite's own rows stay out of the machine's run log", () => {
  test("#373.1: runHook sets STOP_GATE_LOG_DIR to a scratch directory by default, so no case can reach the real log without deliberately overriding it", () => {
    const record = join(scratchDir("gauntlet-env"), "log-dir");

    runHook("turn", editOf("a.ts"), { GAUNTLET_BIN: logDirRecordingGauntlet(record) });

    const seen = readFileSync(record, "utf8");
    expect(seen).not.toBe("");
    expect(resolve(seen)).not.toBe(resolve(dirname(realLogPath())));
    expect(statSync(seen).isDirectory()).toBe(true);
  });

  test("#373.2: running the gauntlet hook suite adds zero lines to today's real log file", () => {
    const realLog = realLogPath();
    const before = realLogLines(realLog);

    runHook("turn", editOf("a.ts"), { GAUNTLET_BIN: stubGauntlet(1, "--- test ---\n1 failed\ngauntlet: FAILED at test\n") });
    runHook("turn", editOf("README.md"), { GAUNTLET_BIN: stubGauntlet(1, "never") });
    runHook("turn", editOf(`${REPO_ROOT}/a.ts`), { GAUNTLET_BIN: stubGauntlet(0) });
    runHook("turn", "not json at all", { GAUNTLET_BIN: stubGauntlet(1, "never") });

    expect(realLogLines(realLog)).toBe(before);
  });

  test("#373.3: npm test passes: every hook case keeps its verdict while leaving the real log untouched", () => {
    const realLog = realLogPath();
    const before = realLogLines(realLog);

    expectTurnBlockedByTypecheck(editOf("a.ts"));

    expect(runHook("turn", editOf("a.ts"), { GAUNTLET_BIN: stubGauntlet(0) }).stdout).toBe("");
    expect(runHook("stop", STOP, { GAUNTLET_BIN: stubGauntlet(1, "--- test ---\n1 failed\n") }).stdout).toBe("");

    expect(realLogLines(realLog)).toBe(before);
  });
});

const SESSION_CAPTURE = join(REPO_ROOT, ".claude/hooks/session-capture.sh");

function rowsWithFiles(dir: string): { file: string; row: Record<string, unknown> }[] {
  return readdirSync(dir).flatMap((file) =>
    readFileSync(join(dir, file), "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => ({ file, row: JSON.parse(line) as Record<string, unknown> })),
  );
}

describe("the seeded writer owns every run row this repo's hooks write", () => {
  test("#374.2: gauntlet-hook writes its rows through lib/_hook.mjs, the same seeded writer session-capture reaches through lib/_hook.sh", () => {
    const dir = scratchDir("seeded-writer-rows");

    runHook("turn", editOf("a.ts"), { GAUNTLET_BIN: stubGauntlet(0), STOP_GATE_LOG_DIR: dir });
    spawnSync(SESSION_CAPTURE, {
      input: JSON.stringify({ hook_event_name: "SessionEnd", session_id: "seeded-writer", cwd: REPO_ROOT, reason: "clear" }),
      encoding: "utf8",
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        STOP_GATE_LOG_DIR: dir,
        SESSION_CAPTURE_LOG_PATH: join(scratchDir("seeded-writer-legacy"), "session-capture.log"),
      },
    });

    const written = rowsWithFiles(dir);
    expect(written.map(({ row }) => row.hook).sort()).toEqual(["gauntlet-hook", "session-capture"]);
    for (const { file, row } of written) {
      expect(Object.keys(row)).toEqual(expect.arrayContaining(["hook", "event", "session_id", "verdict", "ts"]));
      expect(String(row.ts)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
      expect(file.startsWith(String(row.hook))).toBe(true);
    }
  });
});

const HOOK_LIB_MJS = join(REPO_ROOT, ".claude/hooks/lib/_hook.mjs");

const RUN_ROW_PROBE = `
import { runRow } from ${JSON.stringify(HOOK_LIB_MJS)};

process.stdout.write(
  JSON.stringify(
    runRow(JSON.parse(process.env.PROBE_PAYLOAD), process.env.PROBE_VERDICT, JSON.parse(process.env.PROBE_EXTRA)),
  ),
);
`;

function runRowThroughSeededLib(
  payload: Record<string, unknown>,
  verdict: string,
  extra: Record<string, unknown>,
): Record<string, unknown> {
  const probe = join(scratchDir("gauntlet-run-row-probe"), "probe.mjs");
  writeFileSync(probe, RUN_ROW_PROBE);

  const run = spawnSync(process.execPath, [probe], {
    encoding: "utf8",
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      PROBE_PAYLOAD: JSON.stringify(payload),
      PROBE_VERDICT: verdict,
      PROBE_EXTRA: JSON.stringify(extra),
    },
  });

  expect(run.status, run.stderr).toBe(0);
  return JSON.parse(run.stdout) as Record<string, unknown>;
}

function postToolUsePayload(sessionId: string, toolUseId: string): Record<string, unknown> {
  return {
    hook_event_name: "PostToolUse",
    session_id: sessionId,
    cwd: REPO_ROOT,
    tool_use_id: toolUseId,
    tool_input: { file_path: `${REPO_ROOT}/a.ts` },
  };
}

describe("gauntlet-hook writes the row agent-skills' own writer builds", () => {
  test.fails("#382.2: gauntlet-hook writes through runRow(payload, verdict, extra) and appendLog(row), naming no hook of its own", () => {
    const dir = scratchDir("gauntlet-hook-run-row-signature");
    const payload = postToolUsePayload("run-row-signature", "toolu_signature");

    const direct = runRowThroughSeededLib(payload, "clean", { venue: "turn" });
    expect(direct).toMatchObject({
      event: "PostToolUse",
      session_id: "run-row-signature",
      verdict: "clean",
      venue: "turn",
    });

    runHook("turn", JSON.stringify(payload), { GAUNTLET_BIN: stubGauntlet(0), STOP_GATE_LOG_DIR: dir });

    const written = rowsWithFiles(dir);
    expect(written).toHaveLength(1);
    expect(written[0].row).toMatchObject({
      hook: "gauntlet-hook",
      event: "PostToolUse",
      session_id: "run-row-signature",
      verdict: "clean",
      venue: "turn",
    });
    expect(Object.keys(written[0].row)).toEqual(expect.arrayContaining(Object.keys(direct)));
    expect(written[0].file.startsWith("gauntlet-hook-")).toBe(true);
  });

  test.fails("#382.4: a gauntlet-hook row written from a PostToolUse payload carries the payload's tool_use_id", () => {
    const dir = scratchDir("gauntlet-hook-tool-use-id");
    const payload = JSON.stringify(postToolUsePayload("join-key", "toolu_01JoinKey"));

    runHook("turn", payload, {
      GAUNTLET_BIN: stubGauntlet(1, "--- test ---\n1 failed\ngauntlet: FAILED at test\n"),
      STOP_GATE_LOG_DIR: dir,
    });

    const rows = rowsWithFiles(dir).map(({ row }) => row);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      hook: "gauntlet-hook",
      event: "PostToolUse",
      verdict: "failed",
      tool_use_id: "toolu_01JoinKey",
    });
  });

  test.fails("#382.5: npm test stays green: every gauntlet-hook and session-capture verdict survives the seeded writer, and the machine's own run log gains nothing", () => {
    const realLog = realLogPath();
    const before = realLogLines(realLog);
    const dir = scratchDir("seeded-writer-green");

    expectTurnBlockedByTypecheck(JSON.stringify(postToolUsePayload("green-turn", "toolu_green")), { STOP_GATE_LOG_DIR: dir });
    expect(runHook("turn", editOf("README.md"), { GAUNTLET_BIN: stubGauntlet(1, "never"), STOP_GATE_LOG_DIR: dir }).stdout).toBe("");
    expect(runHook("stop", STOP, { GAUNTLET_BIN: stubGauntlet(1, "--- test ---\n1 failed\n"), STOP_GATE_LOG_DIR: dir }).stdout).toBe("");

    spawnSync(SESSION_CAPTURE, {
      input: JSON.stringify({ hook_event_name: "SessionEnd", session_id: "green-capture", cwd: REPO_ROOT, reason: "clear" }),
      encoding: "utf8",
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        STOP_GATE_LOG_DIR: dir,
        SESSION_CAPTURE_LOG_PATH: join(scratchDir("seeded-writer-green-legacy"), "session-capture.log"),
      },
    });

    const rows = rowsWithFiles(dir).map(({ row }) => row);
    const gauntletRows = rows.filter((row) => row.hook === "gauntlet-hook");
    const captureRows = rows.filter((row) => row.hook === "session-capture");

    expect(gauntletRows.map((row) => row.verdict)).toEqual(expect.arrayContaining(["failed", "out-of-scope"]));
    expect(gauntletRows.find((row) => row.verdict === "failed")).toMatchObject({
      event: "PostToolUse",
      session_id: "green-turn",
      tool_use_id: "toolu_green",
    });

    expect(captureRows).toHaveLength(1);
    expect(captureRows[0]).toMatchObject({
      event: "SessionEnd",
      session_id: "green-capture",
      verdict: "skipped-no-transcript-path",
    });

    expect(realLogLines(realLog)).toBe(before);
  });
});
