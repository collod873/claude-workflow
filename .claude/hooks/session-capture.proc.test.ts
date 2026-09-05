import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { describe, expect, it, test } from "vitest";
import { scratchDir } from "../../.Workflow/agent-workflows/shared/scratch.fixture";
import { makeBareRepo } from "../../.Workflow/agent-workflows/shared/temp-repo.fixture";
import {
  captureFiles,
  expectCaptured,
  flushForSessionElsewhere,
  gitAlwaysRejectingMainPush,
  gitRacingNotesPushOnce,
  killRemote,
  makeKbCheckout,
  makeRepoUnderCapture,
  minimalBinDir,
  oneHumanPrompt,
  publishTranscriptFor,
  readKbHeadSubject,
  readLog,
  readSessionNote,
  runHook,
  sessionEnd,
  sessionWorktree,
  settle,
  trackerOnPath,
  waitForCaptureFile,
  waitForKbHeadSubjectToContain,
  waitForLogLine,
  waitForLogToContain,
  writeTranscript,
  type RunResult,
} from "./session-capture.fixture";

function fixtureSession(reason: string): RunResult {
  return runHook({
    session_id: "abcdef1234567890",
    transcript_path: writeTranscript([
      {
        type: "user",
        uuid: "u1",
        origin: { kind: "human" },
        promptSource: "typed",
        message: { content: "Please help me ship this.\n<system-reminder>Do not mention the secret plan.</system-reminder>" },
      },
      { type: "assistant", uuid: "a1", message: { content: [{ type: "text", text: "Sure, I will get started on shipping this." }] } },
      { type: "user", uuid: "i1", message: { content: [{ type: "text", text: "[Request interrupted by user for tool use]" }] } },
      { type: "user", uuid: "u2", origin: { kind: "human" }, promptSource: "typed", message: { content: "<bash-input>ls -la</bash-input>" } },
      { type: "user", uuid: "u3", origin: { kind: "agent" }, promptSource: "typed", message: { content: "NONHUMAN CONTENT SHOULD NOT APPEAR" } },
    ]),
    cwd: "test-project",
    hook_event_name: "SessionEnd",
    reason,
  });
}

function runWithScrubbedPath(nodeOnPath: boolean): RunResult {
  return runHook(sessionEnd("x", oneHumanPrompt(), "y"), {
    PATH: "/nonexistent",
    HOME: "/nonexistent",
    NODE_ON_PATH_SEARCH_DIRS: minimalBinDir(nodeOnPath),
  });
}

function inScopeSession(sessionId: string, env: Record<string, string> = {}, tracker = trackerOnPath()) {
  const repo = makeRepoUnderCapture();
  const session = sessionWorktree(repo.bareDir);
  const result = runHook(sessionEnd(sessionId, publishTranscriptFor(session), session.dir), {
    SESSION_CAPTURE_REPO_DIR: repo.repoDir,
    ...env,
    PATH: `${env.PATH ?? ""}${tracker.binDir}:${process.env.PATH}`,
  });
  return { ...repo, session, tracker, result };
}

describe("session-capture.sh: the fixture transcript", () => {
  it.each(["clear", "logout", "other"])("captures exactly one file for matcher reason %s", (reason) => {
    const result = fixtureSession(reason);

    const capture = expectCaptured(result);

    expect(capture.content).toContain("session_id: abcdef1234567890");
    expect(capture.content).toContain("project: test-project");
    expect(capture.content).toMatch(/^date: /m);
    expect(capture.content).toContain(`source: ${reason}`);
    expect(capture.content).toContain("format: 2");
    expect(capture.content).toContain("## User Prompts");
    expect(capture.content).toContain("## Exchange");

    expect(capture.content).toContain("Please help me ship this.");
    expect(capture.content).toContain("Sure, I will get started on shipping this.");
    expect(capture.content).toContain("**Interrupted**, during a tool call");

    expect(capture.content).not.toContain("secret plan");
    expect(capture.content).not.toContain("ls -la");
    expect(capture.content).not.toContain("NONHUMAN CONTENT SHOULD NOT APPEAR");

    expect(captureFiles(result.outputDir)).toHaveLength(1);
    expect(waitForLogLine(result.logPath)).toContain("captured abcdef1234567890");
  });

  it("keeps writing after the capture file lands, and stops once settle returns", () => {
    const result = fixtureSession("clear");

    waitForCaptureFile(result.outputDir);
    settle(result.logPath);

    const settled = readLog(result.logPath);
    expect(settled).toContain("captured abcdef1234567890");
    expect(settled.trimEnd().split("\n").at(-1)).not.toContain("captured ");

    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
    expect(readLog(result.logPath)).toBe(settled);
  });
});

function expectSkippedRow(label: string, payload: string | Record<string, unknown>, env: Record<string, string> = {}) {
  const { result, rows } = fireSessionEnd(label, payload, env);

  expect(result.status).toBe(0);
  expect(result.stdout).toBe("");
  expect(captureFiles(result.outputDir)).toEqual([]);
  expect(rows).toHaveLength(1);
  return rows[0];
}

describe("session-capture.sh: failing open", () => {
  it("exits 0, writes no capture file, and records a skipped-no-transcript-path row when the payload has no transcript_path", () => {
    const row = expectSkippedRow("no-transcript-path", { session_id: "x", cwd: "y", hook_event_name: "SessionEnd", reason: "clear" });

    expect(row.verdict).toBe("skipped-no-transcript-path");
  });

  it("exits 0, writes no capture file, and records a skipped-no-node row when node isn't on PATH", () => {
    const row = expectSkippedRow("no-node", sessionEnd("x", oneHumanPrompt(), "y"), {
      PATH: "/nonexistent",
      HOME: "/nonexistent",
      NODE_ON_PATH_SEARCH_DIRS: minimalBinDir(false),
    });

    expect(row.verdict).toBe("skipped-no-node");
  });

  it("still captures when PATH is scrubbed but node is findable, so the payload survives the repair", () => {
    const result = runWithScrubbedPath(true);

    expectCaptured(result);
    const log = waitForLogToContain(result.logPath, "captured x");
    expect(log).not.toMatch(/skipped (?!publish-|push-)/);
  });

  it("exits 0, writes no capture file, and records a skipped-transcript-missing row when the transcript file doesn't exist", () => {
    const row = expectSkippedRow("transcript-missing", sessionEnd("x", "/no/such/transcript.jsonl", "y"));

    expect(row.verdict).toBe("skipped-transcript-missing");
  });

  it("stays quiet on a payload it cannot parse", () => {
    const row = expectSkippedRow("unparseable", "not json at all");

    expect(row.verdict).toBe("skipped-no-transcript-path");
  });
});

describe("session-capture.sh: publishing the session record and dispatching the audit", () => {
  it("publishes a session record and dispatches the audit when the session ran in this repo", () => {
    const { bareDir, head, tracker, result } = inScopeSession("session-in-scope");

    const capture = expectCaptured(result);
    expect(waitForLogToContain(result.logPath, "published")).toContain(`published session-in-scope ${head}`);

    const note = readSessionNote(bareDir, head);
    expect(note.sessionId).toBe("session-in-scope");
    expect(note.head).toBe(head);
    expect(note.touchedPaths).toEqual(["a.ts"]);
    expect(note.corpusPath).toBe(join("raw", "sessions", basename(capture.path)));
    expect(note).not.toHaveProperty("spine");
    expect(capture.content).toContain("ship the range derivation");

    const [dispatch] = tracker.calls();
    expect(dispatch).toContain("api");
    expect(dispatch.some((arg) => arg.endsWith("/dispatches"))).toBe(true);
    expect(dispatch).toContain("event_type=session-captured");
    expect(dispatch).toContain(`client_payload[head]=${head}`);
  });

  it("captures but does not publish or dispatch when the session ran in a different repo", () => {
    const { repoDir } = makeRepoUnderCapture();
    const otherRepo = sessionWorktree(makeBareRepo("session-capture-other-bare"));
    const tracker = trackerOnPath();

    const result = runHook(sessionEnd("session-out-of-scope", publishTranscriptFor(otherRepo), otherRepo.dir), {
      SESSION_CAPTURE_REPO_DIR: repoDir,
      PATH: `${tracker.binDir}:${process.env.PATH}`,
    });

    expectCaptured(result);
    expect(waitForLogToContain(result.logPath, "skipped publish-out-of-scope")).not.toContain("published");
    expect(tracker.calls()).toEqual([]);
  });

  it("retries a push rejected non-fast-forward once against a local bare remote, and succeeds", () => {
    const repo = makeRepoUnderCapture();
    const session = sessionWorktree(repo.bareDir);
    const racer = sessionWorktree(repo.bareDir);
    const tracker = trackerOnPath();

    const result = runHook(sessionEnd("session-race", publishTranscriptFor(session), session.dir), {
      SESSION_CAPTURE_REPO_DIR: repo.repoDir,
      PATH: `${gitRacingNotesPushOnce(racer, repo.head)}:${tracker.binDir}:${process.env.PATH}`,
    });

    expectCaptured(result);
    const log = waitForLogToContain(result.logPath, "published");
    expect(log).toContain(`published session-race ${repo.head}`);
    expect(log).not.toContain("publish-push-failed");
    expect(readSessionNote(repo.bareDir, repo.head).sessionId).toBe("session-race");
  });

  it("still writes the capture file and exits 0 when the push fails outright (not a race, an unreachable remote)", () => {
    const repo = makeRepoUnderCapture();
    const session = sessionWorktree(repo.bareDir);
    killRemote(repo.bareDir);
    const tracker = trackerOnPath();

    const result = runHook(sessionEnd("session-dead-remote", publishTranscriptFor(session), session.dir), {
      SESSION_CAPTURE_REPO_DIR: repo.repoDir,
      PATH: `${tracker.binDir}:${process.env.PATH}`,
    });

    expectCaptured(result);
    expect(waitForLogToContain(result.logPath, "skipped publish-push-failed")).not.toContain("published");
    expect(tracker.calls()).toEqual([]);
  });

  it("still writes the capture file and exits 0 when the dispatch fails after a successful push", () => {
    const { bareDir, head, result } = inScopeSession("session-dispatch-fails", {}, trackerOnPath({ fail: true }));

    expectCaptured(result);
    expect(waitForLogToContain(result.logPath, "skipped publish-dispatch-failed")).not.toContain("published");
    expect(readSessionNote(bareDir, head).sessionId).toBe("session-dispatch-fails");
  });
});

describe("session-capture.sh: flushing the Knowledge-Base checkout", () => {
  it("flushes before the dispatch fires, for a session that ran in this repo", () => {
    const { kbBareDir, kbCloneDir, kbOutputDir } = makeKbCheckout();
    const { head, result } = inScopeSession("session-flush", {
      SESSION_CAPTURE_KB_DIR: kbCloneDir,
      SESSION_CAPTURE_OUTPUT_DIR: kbOutputDir,
    });

    expectCaptured(result);
    const log = waitForLogToContain(result.logPath, "published");
    expect(log).toContain(`published session-flush ${head}`);
    expect(log).toContain("flushed 1");
    expect(log.indexOf("flushed 1")).toBeLessThan(log.indexOf("published"));

    waitForKbHeadSubjectToContain(kbBareDir, "flush: 1 session capture");
    expect(readKbHeadSubject(kbBareDir)).toBe("flush: 1 session capture");
  });

  it("makes no Knowledge-Base push when the session ran elsewhere and the flush stamp is fresh", () => {
    const { result, kbBareDir, kbStampPath, stampBefore } = flushForSessionElsewhere("session-elsewhere-fresh", 1);

    expectCaptured(result);
    const log = waitForLogToContain(result.logPath, "skipped publish-out-of-scope");
    expect(log).not.toContain("flushed");
    expect(log).not.toContain("skipped push-");
    expect(readKbHeadSubject(kbBareDir)).toBeUndefined();
    expect(readLog(kbStampPath)).toBe(stampBefore);
  });

  it("pushes and rewrites the stamp when the session ran elsewhere and the flush stamp is more than 24 hours old", () => {
    const { result, kbBareDir, kbStampPath, stampBefore } = flushForSessionElsewhere("session-elsewhere-stale", 25);

    expectCaptured(result);
    expect(waitForLogToContain(result.logPath, "skipped publish-out-of-scope")).toContain("flushed 1");
    waitForKbHeadSubjectToContain(kbBareDir, "flush: 1 session capture");

    const rewrittenStamp = readLog(kbStampPath);
    expect(rewrittenStamp).not.toBe(stampBefore);
    expect(Date.now() - Date.parse(rewrittenStamp)).toBeLessThan(60_000);
  });

  it("logs its own skipped push-* line and still writes the capture file when the Knowledge-Base checkout is missing", () => {
    const { head, result } = inScopeSession("session-kb-missing", {
      SESSION_CAPTURE_KB_DIR: join(makeBareRepo("session-capture-kb-parent"), "does-not-exist"),
    });

    expectCaptured(result);
    const log = waitForLogToContain(result.logPath, "published");
    expect(log).toContain("skipped push-");
    expect(log).toContain("no Knowledge-Base checkout");
    expect(log).toContain(`published session-kb-missing ${head}`);
  });

  it("logs its own skipped push-* line when the push is rejected twice in a row", () => {
    const { kbBareDir, kbCloneDir, kbOutputDir } = makeKbCheckout();
    const racer = sessionWorktree(kbBareDir);
    const { head, result } = inScopeSession("session-kb-rejected", {
      SESSION_CAPTURE_KB_DIR: kbCloneDir,
      SESSION_CAPTURE_OUTPUT_DIR: kbOutputDir,
      PATH: `${gitAlwaysRejectingMainPush(racer)}:`,
    });

    expectCaptured(result);
    const log = waitForLogToContain(result.logPath, "published");
    expect(log).toContain("skipped push-");
    expect(log).toContain("rejected twice in a row");
    expect(log).not.toContain("flushed");
    expect(readKbHeadSubject(kbBareDir)).toBe("racer");
    expect(log).toContain(`published session-kb-rejected ${head}`);
  });

  it("logs its own skipped push-* line when the Knowledge-Base remote is unreachable", () => {
    const { kbBareDir, kbCloneDir, kbOutputDir } = makeKbCheckout();
    killRemote(kbBareDir);
    const { head, result } = inScopeSession("session-kb-unreachable", {
      SESSION_CAPTURE_KB_DIR: kbCloneDir,
      SESSION_CAPTURE_OUTPUT_DIR: kbOutputDir,
    });

    expectCaptured(result);
    const log = waitForLogToContain(result.logPath, "published");
    expect(log).toContain("skipped push-");
    expect(log).not.toContain("flushed");
    expect(log).toContain(`published session-kb-unreachable ${head}`);
  });
});

function runRows(dir: string): Record<string, string>[] {
  return existsSync(dir)
    ? readdirSync(dir).flatMap((name) =>
        readFileSync(join(dir, name), "utf8")
          .split("\n")
          .filter(Boolean)
          .map((line) => JSON.parse(line) as Record<string, string>),
      )
    : [];
}

function fireSessionEnd(label: string, payload: Parameters<typeof runHook>[0], env: Record<string, string> = {}) {
  const logDir = scratchDir(`session-capture-run-row-${label}`);
  const result = runHook(payload, { ...env, STOP_GATE_LOG_DIR: logDir });
  return {
    result,
    rows: runRows(logDir),
    legacyLog: existsSync(result.logPath) ? readFileSync(result.logPath, "utf8") : "",
  };
}

function realRunLogLines(): number {
  const dir = join(homedir(), ".claude", "logs");
  const mine = existsSync(dir) ? readdirSync(dir).filter((name) => name.startsWith("session-capture-")) : [];
  return mine.reduce((lines, name) => lines + readFileSync(join(dir, name), "utf8").split("\n").filter(Boolean).length, 0);
}

describe("session-capture.sh: the shared run row every SessionEnd fire leaves behind", () => {
  test("#374.3: one run row per SessionEnd fire naming session-capture's outcome, and no session-capture.log of the shell's own", () => {
    const noTranscript = fireSessionEnd("no-transcript-path", {
      session_id: "row-no-transcript",
      cwd: "y",
      hook_event_name: "SessionEnd",
      reason: "clear",
    });
    const missing = fireSessionEnd("transcript-missing", sessionEnd("row-missing", "/no/such/transcript.jsonl", "y"));
    const noNode = fireSessionEnd("no-node", sessionEnd("row-no-node", oneHumanPrompt(), "y"), {
      PATH: "/nonexistent",
      HOME: "/nonexistent",
      NODE_ON_PATH_SEARCH_DIRS: minimalBinDir(false),
    });
    const dispatched = fireSessionEnd("dispatched", sessionEnd("row-dispatched", oneHumanPrompt(), "y"));

    for (const fire of [noTranscript, missing, noNode, dispatched]) {
      expect(fire.rows).toHaveLength(1);
      expect(fire.rows[0]).toMatchObject({ hook: "session-capture", event: "SessionEnd" });
    }
    for (const fire of [noTranscript, missing, noNode]) {
      expect(fire.legacyLog).not.toContain("skipped");
    }

    expect([noTranscript, missing, noNode, dispatched].map((fire) => fire.rows[0].verdict)).toEqual([
      "skipped-no-transcript-path",
      "skipped-transcript-missing",
      "skipped-no-node",
      "dispatched",
    ]);
  });

  test("#374.4: a SessionEnd payload driven through the shell entry with STOP_GATE_LOG_DIR sandboxed leaves a row carrying its hook, event, session_id and verdict", () => {
    const { rows } = fireSessionEnd("session-end-payload", sessionEnd("row-session-end", oneHumanPrompt(), "y"));

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      hook: "session-capture",
      event: "SessionEnd",
      session_id: "row-session-end",
      verdict: "dispatched",
    });
  });

  test("#374.5: an ended session leaves the session-capture | SessionEnd line hook-report reads inside its --days 1 window", () => {
    const { rows } = fireSessionEnd("hook-report-line", sessionEnd("row-report", oneHumanPrompt(), "y"));

    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(`${row.hook} | ${row.event}`).toBe("session-capture | SessionEnd");
    expect(row.ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
    expect(Math.abs(Date.now() - Date.parse(row.ts))).toBeLessThan(24 * 60 * 60 * 1000);
  });

  test("#374.6: npm run check passes: every sandboxed fire keeps its verdict and adds nothing to the machine's own run log", () => {
    const before = realRunLogLines();

    const missing = fireSessionEnd("check-missing", sessionEnd("row-check-missing", "/no/such/transcript.jsonl", "y"));
    const captured = fireSessionEnd("check-dispatched", sessionEnd("row-check-dispatched", oneHumanPrompt(), "y"));

    expect(missing.rows.map((row) => row.verdict)).toEqual(["skipped-transcript-missing"]);
    expect(captureFiles(missing.result.outputDir)).toHaveLength(0);

    expect(captured.rows.map((row) => row.verdict)).toEqual(["dispatched"]);
    expectCaptured(captured.result);

    expect(realRunLogLines()).toBe(before);
  });
});

const REPO_ROOT = resolve(import.meta.dirname, "../..");
const HOOK_LIB_SH = join(REPO_ROOT, ".claude/hooks/lib/_hook.sh");

function sourcedHookLib(script: string, payload: string, logDir: string): string {
  const run = spawnSync("bash", ["-c", `. ${JSON.stringify(HOOK_LIB_SH)}\n${script}`], {
    input: payload,
    encoding: "utf8",
    cwd: REPO_ROOT,
    env: { ...process.env, STOP_GATE_LOG_DIR: logDir },
  });
  return run.stdout;
}

describe("session-capture.sh: the seeded bash shim owns the run row", () => {
  test.fails("#382.3: session-capture.sh writes through hook_run_row, and no hook_lib_* call is left for anything under .claude/hooks/ to make", () => {
    const payload = JSON.stringify({
      hook_event_name: "SessionEnd",
      session_id: "shim-payload",
      cwd: REPO_ROOT,
      reason: "clear",
    });

    const probe = sourcedHookLib(
      [
        "declare -F hook_run_row > /dev/null && echo defined || echo missing",
        'printf "%s\\n" "${HOOK_PAYLOAD:-}"',
        'declare -F | sed "s/^declare -f //" | grep -c "^hook_lib_" || true',
      ].join("\n"),
      payload,
      scratchDir("session-capture-shim-probe"),
    );

    const [defined, seenPayload, hookLibFunctions] = probe.split("\n");
    expect(defined).toBe("defined");
    expect(JSON.parse(seenPayload || "{}").session_id).toBe("shim-payload");
    expect(hookLibFunctions).toBe("0");

    const { rows } = fireSessionEnd("hook-run-row", sessionEnd("row-shim", oneHumanPrompt(), "y"));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      hook: "session-capture",
      event: "SessionEnd",
      session_id: "row-shim",
      verdict: "dispatched",
    });
  });
});
