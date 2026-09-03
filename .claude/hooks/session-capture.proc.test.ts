import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";
import { makeBareRepo } from "../../.Workflow/agent-workflows/shared/temp-repo.fixture";
import {
  captureFiles,
  expectCaptured,
  expectFailedOpen,
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

describe("session-capture.sh — the fixture transcript", () => {
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
    expect(capture.content).toContain("**Interrupted** — during a tool call");

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

describe("session-capture.sh — failing open", () => {
  it("exits 0, writes no capture file, and logs skipped no-transcript-path when the payload has no transcript_path", () => {
    const log = expectFailedOpen(runHook({ session_id: "x", cwd: "y", hook_event_name: "SessionEnd", reason: "clear" }));

    expect(log.trim().split("\n")).toHaveLength(1);
    expect(log).toContain("skipped no-transcript-path");
  });

  it("exits 0, writes no capture file, and logs skipped no-node when node isn't on PATH", () => {
    const log = expectFailedOpen(runWithScrubbedPath(false));

    expect(log.trim().split("\n")).toHaveLength(1);
    expect(log).toContain("skipped no-node");
  });

  it("still captures when PATH is scrubbed but node is findable — the payload survives the repair", () => {
    const result = runWithScrubbedPath(true);

    expectCaptured(result);
    const log = waitForLogToContain(result.logPath, "captured x");
    expect(log).not.toMatch(/skipped (?!publish-|push-)/);
  });

  it("exits 0, writes no capture file, and logs skipped transcript-missing when the transcript file doesn't exist", () => {
    expect(expectFailedOpen(runHook(sessionEnd("x", "/no/such/transcript.jsonl", "y")))).toContain(
      "skipped transcript-missing",
    );
  });

  it("stays quiet on a payload it cannot parse", () => {
    expect(expectFailedOpen(runHook("not json at all"))).toContain("skipped no-transcript-path");
  });
});

describe("session-capture.sh — publishing the session record and dispatching the audit", () => {
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

describe("session-capture.sh — flushing the Knowledge-Base checkout", () => {
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
