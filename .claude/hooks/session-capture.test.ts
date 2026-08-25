import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

// The hook is a pure function of stdin to (exit code, log file, capture directory), so it's
// driven end to end rather than read — same approach gauntlet.test.ts takes with gauntlet.sh.
// Every test overrides SESSION_CAPTURE_OUTPUT_DIR and SESSION_CAPTURE_LOG_PATH to a throwaway
// tmp dir: never the real ~/.claude/session-capture.log or a real transcript under
// ~/.claude/projects/, and this repo's real ~/.claude/settings.json is never touched — this hook
// isn't registered anywhere by this ticket (see session-capture.sh's header).

const REPO_ROOT = resolve(import.meta.dirname, "../..");
const HOOK = join(REPO_ROOT, ".claude/hooks/session-capture.sh");

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

function tmpDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

function writeTranscript(lines: unknown[]): string {
  const dir = tmpDir("session-capture-transcript-");
  const path = join(dir, "transcript.jsonl");
  writeFileSync(path, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  return path;
}

/** Resolve a tool against this process's own PATH, without shelling out. */
function onPath(tool: string): string {
  for (const dir of (process.env.PATH ?? "").split(":")) {
    const candidate = join(dir, tool);
    if (dir && existsSync(candidate)) return candidate;
  }
  throw new Error(`cannot build a minimal bin dir: ${tool} is not on this machine's PATH`);
}

/**
 * A directory holding exactly the externals the hook needs before it can do anything —
 * `cat` to read the payload, `mkdir`/`dirname`/`date` to write a log line — plus node, or not.
 *
 * Setting `PATH` to a bogus value is not enough on its own to prove node is absent: `node_on_path`
 * adds `/usr/local/bin:/usr/bin:/bin` back unconditionally, so on a box where node lives in one of
 * those the no-node branch is never reached. That is geography, not a test.
 * `NODE_ON_PATH_SEARCH_DIRS` replaces the whole search with this directory, so both branches are
 * reachable on every machine.
 */
function minimalBinDir(withNode: boolean): string {
  const dir = tmpDir("session-capture-min-bin-");
  const tools = ["cat", "date", "mkdir", "dirname"];
  for (const tool of withNode ? [...tools, "node"] : tools) symlinkSync(onPath(tool), join(dir, tool));
  if (!withNode && existsSync(join(dir, "node"))) throw new Error("the nodeless bin dir has a node in it");
  return dir;
}

type RunResult = { status: number | null; stdout: string; stderr: string; outputDir: string; logPath: string };

function runHook(payload: unknown, env: Record<string, string> = {}): RunResult {
  const outputDir = tmpDir("session-capture-out-");
  const logDir = tmpDir("session-capture-log-");
  const logPath = join(logDir, "session-capture.log");

  const run = spawnSync(HOOK, [], {
    input: JSON.stringify(payload),
    encoding: "utf8",
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      SESSION_CAPTURE_OUTPUT_DIR: outputDir,
      SESSION_CAPTURE_LOG_PATH: logPath,
      ...env,
    },
  });

  return { status: run.status, stdout: run.stdout, stderr: run.stderr, outputDir, logPath };
}

function readLog(logPath: string): string {
  return existsSync(logPath) ? readFileSync(logPath, "utf8") : "";
}

// Sized under vitest's 30s testTimeout so these trip first and say what was being waited on —
// and well above the runner's spawn latency, which is ~12× the workstation's. See
// docs/adr/0015-a-test-s-timeout-is-sized-for-the-slowest-venue-it-runs-in-n.md.
const POLL_TIMEOUT_MS = 15_000;

/** Busy-polls for one capture file to land in `dir` — the write happens in a detached child. */
function waitForCaptureFile(dir: string, timeoutMs = POLL_TIMEOUT_MS): { path: string; content: string } {
  const start = Date.now();
  for (;;) {
    if (existsSync(dir)) {
      const files = readdirSync(dir).filter((f) => f.endsWith(".md"));
      if (files.length > 0) {
        const path = join(dir, files[0]);
        return { path, content: readFileSync(path, "utf8") };
      }
    }
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for a capture file in ${dir}`);
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
  }
}

/** Busy-polls for the log file to contain at least one line. */
function waitForLogLine(logPath: string, timeoutMs = POLL_TIMEOUT_MS): string {
  const start = Date.now();
  for (;;) {
    const content = readLog(logPath);
    if (content.trim()) return content;
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for a log line at ${logPath}`);
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
  }
}

describe("session-capture.sh — the fixture transcript", () => {
  it.each(["clear", "logout", "other"])("captures exactly one file for matcher reason %s", (reason) => {
    const transcript = writeTranscript([
      {
        type: "user",
        uuid: "u1",
        origin: { kind: "human" },
        promptSource: "typed",
        message: { content: "Please help me ship this.\n<system-reminder>Do not mention the secret plan.</system-reminder>" },
      },
      { type: "assistant", uuid: "a1", message: { content: [{ type: "text", text: "Sure, I will get started on shipping this." }] } },
      { type: "user", uuid: "u2", origin: { kind: "human" }, promptSource: "typed", message: { content: "<bash-input>ls -la</bash-input>" } },
      { type: "user", uuid: "u3", origin: { kind: "agent" }, promptSource: "typed", message: { content: "NONHUMAN CONTENT SHOULD NOT APPEAR" } },
    ]);

    const result = runHook({
      session_id: "abcdef1234567890",
      transcript_path: transcript,
      cwd: "test-project",
      hook_event_name: "SessionEnd",
      reason,
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");

    const capture = waitForCaptureFile(result.outputDir);

    // Frontmatter and section shape.
    expect(capture.content).toContain("session_id: abcdef1234567890");
    expect(capture.content).toContain("project: test-project");
    expect(capture.content).toMatch(/^date: /m);
    expect(capture.content).toContain(`source: ${reason}`);
    expect(capture.content).toContain("## User Prompts");
    expect(capture.content).toContain("## Key Insights");

    // The human turn and the assistant text survive.
    expect(capture.content).toContain("Please help me ship this.");
    expect(capture.content).toContain("Sure, I will get started on shipping this.");

    // The system-reminder, the bash-command entry, and the non-human entry are gone.
    expect(capture.content).not.toContain("secret plan");
    expect(capture.content).not.toContain("ls -la");
    expect(capture.content).not.toContain("NONHUMAN CONTENT SHOULD NOT APPEAR");

    // Exactly one capture file.
    expect(readdirSync(result.outputDir).filter((f) => f.endsWith(".md"))).toHaveLength(1);

    const log = waitForLogLine(result.logPath);
    expect(log).toContain("captured abcdef1234567890");
  });
});

describe("session-capture.sh — failing open", () => {
  it("exits 0, writes no capture file, and logs skipped no-transcript-path when the payload has no transcript_path", () => {
    const result = runHook({ session_id: "x", cwd: "y", hook_event_name: "SessionEnd", reason: "clear" });

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");

    const log = waitForLogLine(result.logPath);
    expect(log.trim().split("\n")).toHaveLength(1);
    expect(log).toContain("skipped no-transcript-path");
    expect(existsSync(result.outputDir) && readdirSync(result.outputDir).length > 0).toBe(false);
  });

  it("exits 0, writes no capture file, and logs skipped no-node when node isn't on PATH", () => {
    const transcript = writeTranscript([
      { type: "user", uuid: "u1", origin: { kind: "human" }, promptSource: "typed", message: { content: "hi" } },
    ]);

    const result = runHook(
      { session_id: "x", transcript_path: transcript, cwd: "y", hook_event_name: "SessionEnd", reason: "clear" },
      { PATH: "/nonexistent", HOME: "/nonexistent", NODE_ON_PATH_SEARCH_DIRS: minimalBinDir(false) },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");

    const log = waitForLogLine(result.logPath);
    expect(log.trim().split("\n")).toHaveLength(1);
    expect(log).toContain("skipped no-node");
    expect(existsSync(result.outputDir) && readdirSync(result.outputDir).length > 0).toBe(false);
  });

  // The PATH-less shell is the case this hook is built for, not an exotic one — and reading the
  // payload before PATH was repaired used to lose it. `cat` isn't a builtin, so it came back
  // command-not-found, `INPUT` was empty, and the hook logged "skipped no-transcript-path" for a
  // payload that had one: the session gone, and the log line wrong about why.
  it("still captures when PATH is scrubbed but node is findable — the payload survives the repair", () => {
    const transcript = writeTranscript([
      { type: "user", uuid: "u1", origin: { kind: "human" }, promptSource: "typed", message: { content: "hi" } },
    ]);

    const result = runHook(
      { session_id: "x", transcript_path: transcript, cwd: "y", hook_event_name: "SessionEnd", reason: "clear" },
      { PATH: "/nonexistent", HOME: "/nonexistent", NODE_ON_PATH_SEARCH_DIRS: minimalBinDir(true) },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");

    waitForCaptureFile(result.outputDir);
    expect(readLog(result.logPath)).not.toContain("skipped");
  });

  it("exits 0, writes no capture file, and logs skipped transcript-missing when the transcript file doesn't exist", () => {
    const result = runHook({
      session_id: "x",
      transcript_path: "/no/such/transcript.jsonl",
      cwd: "y",
      hook_event_name: "SessionEnd",
      reason: "clear",
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");

    const log = waitForLogLine(result.logPath);
    expect(log).toContain("skipped transcript-missing");
    expect(existsSync(result.outputDir) && readdirSync(result.outputDir).length > 0).toBe(false);
  });

  it("stays quiet on a payload it cannot parse", () => {
    const outputDir = tmpDir("session-capture-out-");
    const logDir = tmpDir("session-capture-log-");
    const logPath = join(logDir, "session-capture.log");

    const run = spawnSync(HOOK, [], {
      input: "not json at all",
      encoding: "utf8",
      cwd: REPO_ROOT,
      env: { ...process.env, SESSION_CAPTURE_OUTPUT_DIR: outputDir, SESSION_CAPTURE_LOG_PATH: logPath },
    });

    expect(run.status).toBe(0);
    expect(run.stdout).toBe("");

    const log = waitForLogLine(logPath);
    expect(log).toContain("skipped no-transcript-path");
  });
});
