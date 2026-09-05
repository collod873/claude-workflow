import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { expect, onTestFinished } from "vitest";
import { scratchDir } from "../../.Workflow/agent-workflows/shared/scratch.fixture";
import { stubGh } from "../../.Workflow/agent-workflows/shared/stub-gh.fixture";
import {
  cloneRepo,
  makeBareRepo,
  noteOnRemote,
  type TempRepo,
} from "../../.Workflow/agent-workflows/shared/temp-repo.fixture";

/**
 * @fixture Reached only from the suite, by design.
 */

const REPO_ROOT = resolve(import.meta.dirname, "../..");
const HOOK = join(REPO_ROOT, ".claude/hooks/session-capture.sh");

const SETTLE_TIMEOUT_MS = 5_000;

const POLL_TIMEOUT_MS = 15_000;

function sleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function poll<T>(probe: () => T | undefined, what: () => string, timeoutMs = POLL_TIMEOUT_MS): T {
  const start = Date.now();
  for (;;) {
    const found = probe();
    if (found !== undefined) return found;
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${what()}`);
    sleep(25);
  }
}

export function readLog(logPath: string): string {
  return existsSync(logPath) ? readFileSync(logPath, "utf8") : "";
}

function settled(logPath: string): boolean {
  if (!existsSync(logPath)) return true;
  const lines = readLog(logPath).trimEnd().split("\n");
  const last = lines[lines.length - 1] ?? "";
  const sawCaptured = lines.some((l) => /\tcaptured /.test(l));
  return sawCaptured
    ? lines.some((l) => /\t(published |skipped publish-)/.test(l))
    : last !== "" && !/\tcaptured /.test(last);
}

export function settle(logPath: string): void {
  try {
    poll(() => (settled(logPath) ? true : undefined), () => "settle", SETTLE_TIMEOUT_MS);
  } catch {
  }
}

export function writeTranscript(lines: unknown[]): string {
  const path = join(scratchDir("session-capture-transcript"), "transcript.jsonl");
  writeFileSync(path, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  return path;
}

function onPath(tool: string): string {
  for (const dir of (process.env.PATH ?? "").split(":")) {
    const candidate = join(dir, tool);
    if (dir && existsSync(candidate)) return candidate;
  }
  throw new Error(`cannot build a minimal bin dir: ${tool} is not on this machine's PATH`);
}

export function minimalBinDir(withNode: boolean): string {
  const dir = scratchDir("session-capture-min-bin");
  const tools = ["cat", "date", "mkdir", "dirname"];
  for (const tool of withNode ? [...tools, "node"] : tools) symlinkSync(onPath(tool), join(dir, tool));
  if (!withNode && existsSync(join(dir, "node"))) throw new Error("the nodeless bin dir has a node in it");
  return dir;
}

export type RunResult = { status: number | null; stdout: string; outputDir: string; logPath: string };

export function runHook(input: string | Record<string, unknown>, env: Record<string, string> = {}): RunResult {
  const outputDir = env.SESSION_CAPTURE_OUTPUT_DIR ?? scratchDir("session-capture-out");
  const logPath = join(scratchDir("session-capture-log"), "session-capture.log");
  const kbDir = join(scratchDir("session-capture-kb"), "missing");
  const kbStampPath = join(scratchDir("session-capture-kb-stamp"), "stamp");
  onTestFinished(() => settle(logPath));

  const run = spawnSync(HOOK, [], {
    input: typeof input === "string" ? input : JSON.stringify(input),
    encoding: "utf8",
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      SESSION_CAPTURE_OUTPUT_DIR: outputDir,
      SESSION_CAPTURE_LOG_PATH: logPath,
      SESSION_CAPTURE_KB_DIR: kbDir,
      SESSION_CAPTURE_KB_STAMP_PATH: kbStampPath,
      ...env,
    },
  });

  return { status: run.status, stdout: run.stdout, outputDir, logPath };
}

export function captureFiles(dir: string): string[] {
  return existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".md")) : [];
}

export function waitForCaptureFile(dir: string): { path: string; content: string } {
  return poll(
    () => {
      const [first] = captureFiles(dir);
      if (first === undefined) return undefined;
      const path = join(dir, first);
      return { path, content: readFileSync(path, "utf8") };
    },
    () => `a capture file in ${dir}`,
  );
}

export function waitForLogLine(logPath: string): string {
  return poll(
    () => {
      const content = readLog(logPath);
      return content.trim() ? content : undefined;
    },
    () => `a log line at ${logPath}`,
  );
}

export function waitForLogToContain(logPath: string, substring: string): string {
  return poll(
    () => {
      const content = readLog(logPath);
      return content.includes(substring) ? content : undefined;
    },
    () => `"${substring}" at ${logPath}; saw:\n${readLog(logPath)}`,
  );
}

function commitAndPush(repo: TempRepo, path: string, contents: string, message: string, iso: string): string {
  repo.write(path, contents);
  const sha = repo.commit(message, { date: iso });
  repo.git("push", "-q", "origin", "HEAD:refs/heads/main");
  return sha;
}

export function readSessionNote(bareDir: string, sha: string): { sessionId: string } & Record<string, unknown> {
  const records = JSON.parse(noteOnRemote(bareDir, "sessions", sha));
  return Array.isArray(records) ? records[0] : records;
}

export function trackerOnPath(opts: { fail?: boolean } = {}): { binDir: string; calls: () => string[][] } {
  if (opts.fail) {
    const binDir = scratchDir("session-capture-failing-gh");
    writeFileSync(join(binDir, "gh"), "#!/bin/bash\nexit 1\n", { mode: 0o755 });
    return { binDir, calls: () => [] };
  }
  const stub = stubGh("");
  return { binDir: dirname(stub.path), calls: stub.calls };
}

function gitWrapperBinDir(opts: { isTargetPush: string; race: string; once: boolean }): string {
  const dir = scratchDir("session-capture-git-wrapper");
  const stateFile = opts.once ? join(dir, "raced") : null;
  const script = `#!/usr/bin/env node
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
const realGit = ${JSON.stringify(onPath("git"))};
const stateFile = ${JSON.stringify(stateFile)};
function git(...a) { spawnSync(realGit, a, { stdio: "ignore" }); }
function isTargetPush(a) { return ${opts.isTargetPush}; }
function race() { ${opts.race} }

if (isTargetPush(args)) {
  let raced = false;
  if (stateFile) { try { raced = fs.readFileSync(stateFile, "utf8").trim() === "1"; } catch {} }
  if (!raced) {
    if (stateFile) fs.writeFileSync(stateFile, "1");
    race();
  }
}

const result = spawnSync(realGit, args, { stdio: "inherit" });
process.exit(result.status === null ? 1 : result.status);
`;
  writeFileSync(join(dir, "git"), script, { mode: 0o755 });
  return dir;
}

export function gitRacingNotesPushOnce(racer: TempRepo, racerSha: string): string {
  const racerDir = JSON.stringify(racer.dir);
  return gitWrapperBinDir({
    isTargetPush: 'a.includes("push") && a.includes("refs/notes/sessions:refs/notes/sessions")',
    race:
      `git("-C", ${racerDir}, "notes", "--ref=sessions", "add", "-f", "-m", "racer", ${JSON.stringify(racerSha)});` +
      ` git("-C", ${racerDir}, "push", "-q", "origin", "refs/notes/sessions:refs/notes/sessions");`,
    once: true,
  });
}

export function gitAlwaysRejectingMainPush(racer: TempRepo): string {
  const racerDir = JSON.stringify(racer.dir);
  return gitWrapperBinDir({
    isTargetPush: 'a.includes("push") && a.some((v) => v.endsWith(":refs/heads/main")) && a.includes("origin")',
    race:
      `fs.writeFileSync(path.join(${racerDir}, "racer.txt"), String(Date.now()) + Math.random());` +
      ` git("-C", ${racerDir}, "add", "-A"); git("-C", ${racerDir}, "commit", "-q", "-m", "racer");` +
      ` git("-C", ${racerDir}, "push", "-q", "origin", "HEAD:refs/heads/main");`,
    once: false,
  });
}

export function readKbHeadSubject(bareDir: string): string | undefined {
  const verify = cloneRepo(bareDir, "session-capture-kb-verify");
  try {
    return verify.git("log", "-1", "--format=%s", "origin/main");
  } catch {
    return undefined;
  }
}

export function waitForKbHeadSubjectToContain(bareDir: string, substring: string): void {
  poll(
    () => ((readKbHeadSubject(bareDir) ?? "").includes(substring) ? true : undefined),
    () => `"${substring}" at the head of ${bareDir}'s refs/heads/main`,
  );
}

function writeStamp(path: string, hoursAgo: number): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, new Date(Date.now() - hoursAgo * 60 * 60 * 1000).toISOString());
}

function publishTranscript(iso: string, sessionRepo: string): unknown[] {
  const before = new Date(new Date(iso).getTime() - 60 * 60 * 1000).toISOString();
  const after = new Date(new Date(iso).getTime() + 60 * 60 * 1000).toISOString();
  return [
    {
      type: "user",
      uuid: "u1",
      origin: { kind: "human" },
      promptSource: "typed",
      message: { content: "ship the range derivation" },
      timestamp: before,
    },
    {
      type: "assistant",
      uuid: "a1",
      message: {
        content: [
          { type: "text", text: "Done." },
          { type: "tool_use", name: "Edit", input: { file_path: join(sessionRepo, "a.ts") } },
          { type: "tool_use", name: "Write", input: { file_path: join(tmpdir(), "outside-the-repo.json") } },
        ],
      },
      timestamp: after,
    },
  ];
}

export function sessionEnd(sessionId: string, transcriptPath: string, cwd: string): Record<string, unknown> {
  return { session_id: sessionId, transcript_path: transcriptPath, cwd, hook_event_name: "SessionEnd", reason: "clear" };
}

export function publishTranscriptFor(sessionRepo: TempRepo): string {
  return writeTranscript(publishTranscript(COMMIT_DATE, sessionRepo.dir));
}

const COMMIT_DATE = "2026-08-10T12:00:00Z";

export function makeRepoUnderCapture(): { bareDir: string; repoDir: string; head: string } {
  const bareDir = makeBareRepo("session-capture-bare");
  const repo = cloneRepo(bareDir, "session-capture-clone");
  const head = commitAndPush(repo, "a.ts", "export const a = 1;\n", "work", COMMIT_DATE);
  return { bareDir, repoDir: repo.dir, head };
}

export function sessionWorktree(bareDir: string): TempRepo {
  return cloneRepo(bareDir, "session-capture-session");
}

export function makeKbCheckout(): { kbBareDir: string; kbCloneDir: string; kbOutputDir: string } {
  const kbBareDir = makeBareRepo("session-capture-kb-bare");
  const kbCloneDir = cloneRepo(kbBareDir, "session-capture-kb-clone").dir;
  return { kbBareDir, kbCloneDir, kbOutputDir: join(kbCloneDir, "raw", "sessions") };
}

export function oneHumanPrompt(): string {
  return writeTranscript([
    { type: "user", uuid: "u1", origin: { kind: "human" }, promptSource: "typed", message: { content: "hi" } },
  ]);
}

export function flushForSessionElsewhere(sessionId: string, hoursAgo: number): {
  result: RunResult;
  kbBareDir: string;
  kbStampPath: string;
  stampBefore: string;
} {
  const { repoDir } = makeRepoUnderCapture();
  const otherRepo = sessionWorktree(makeBareRepo("session-capture-other-bare"));

  const { kbBareDir, kbCloneDir, kbOutputDir } = makeKbCheckout();
  const kbStampPath = join(scratchDir("session-capture-kb-stamp"), "stamp");
  writeStamp(kbStampPath, hoursAgo);
  const stampBefore = readFileSync(kbStampPath, "utf8");

  const result = runHook(sessionEnd(sessionId, oneHumanPrompt(), otherRepo.dir), {
    SESSION_CAPTURE_REPO_DIR: repoDir,
    SESSION_CAPTURE_KB_DIR: kbCloneDir,
    SESSION_CAPTURE_KB_STAMP_PATH: kbStampPath,
    SESSION_CAPTURE_OUTPUT_DIR: kbOutputDir,
  });

  return { result, kbBareDir, kbStampPath, stampBefore };
}

export function killRemote(bareDir: string): void {
  rmSync(bareDir, { recursive: true, force: true });
}

export function expectCaptured(result: RunResult): { path: string; content: string } {
  expect(result.status).toBe(0);
  expect(result.stdout).toBe("");
  return waitForCaptureFile(result.outputDir);
}

