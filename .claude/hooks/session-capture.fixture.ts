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
 * Everything `session-capture.proc.test.ts` needs to drive `session-capture.sh` as a process: the
 * spawn, the scratch directories it is pointed at, the pollers that wait on its *detached* child,
 * and the git/gh doubles the publish and flush halves talk to.
 *
 * The one thing this file owns that the shared fixtures do not is the wait. The hook hands off to
 * a detached child that keeps writing after `spawnSync` returns, so a scratch directory removed
 * the moment a test finishes races a live writer and loses whenever the write lands inside
 * `rmSync`'s readdir-then-rmdir window — the `ENOTEMPTY` #129 reported. `runHook` therefore
 * registers a settle step with `onTestFinished`, which vitest runs in reverse registration order:
 * the settle fires before any directory created ahead of the spawn is removed.
 *
 * @fixture Reached only from the suite, by design.
 */

const REPO_ROOT = resolve(import.meta.dirname, "../..");
const HOOK = join(REPO_ROOT, ".claude/hooks/session-capture.sh");

/**
 * How long to wait for a detached run to finish before giving up on it. Only ever *reached* by a
 * run that has already gone wrong — a healthy one settles in milliseconds — and giving up is not a
 * failure: a temp directory that survives is the OS's problem, never a red test.
 */
const SETTLE_TIMEOUT_MS = 5_000;

// Sized under vitest's 30s testTimeout so these trip first and say what was being waited on —
// and well above the runner's spawn latency, which is ~12× the workstation's (ADR-0015).
const POLL_TIMEOUT_MS = 15_000;

function sleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Busy-polls `probe` until it returns something, or throws naming `what` after `timeoutMs`. */
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

/**
 * Whether the detached child behind `logPath` has stopped writing.
 *
 * The publish half's own outcome line (`published …` or a `skipped publish-*` variant) is always
 * the very last thing `main()` writes once a run has reached the corpus write (`captured …`),
 * whatever the flush step between them logged. A run that never captured ends on its first line,
 * and none of those lines is `captured`-prefixed either.
 */
function settled(logPath: string): boolean {
  const lines = readLog(logPath).trimEnd().split("\n");
  const last = lines[lines.length - 1] ?? "";
  const sawCaptured = lines.some((l) => /\tcaptured /.test(l));
  return sawCaptured
    ? lines.some((l) => /\t(published |skipped publish-)/.test(l))
    : last !== "" && !/\tcaptured /.test(last);
}

/** Waits until the run behind `logPath` has settled, or gives up after `SETTLE_TIMEOUT_MS`. */
export function settle(logPath: string): void {
  try {
    poll(() => (settled(logPath) ? true : undefined), () => "settle", SETTLE_TIMEOUT_MS);
  } catch {
    // Giving up is not a failure — see SETTLE_TIMEOUT_MS.
  }
}

export function writeTranscript(lines: unknown[]): string {
  const path = join(scratchDir("session-capture-transcript"), "transcript.jsonl");
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
 * A directory holding exactly the externals the hook needs before it can do anything — `cat` to
 * read the payload, `mkdir`/`dirname`/`date` to write a log line — plus node, or not.
 *
 * Setting `PATH` to a bogus value is not enough on its own to prove node is absent: `node_on_path`
 * adds `/usr/local/bin:/usr/bin:/bin` back unconditionally, so on a box where node lives in one of
 * those the no-node branch is never reached. `NODE_ON_PATH_SEARCH_DIRS` replaces the whole search
 * with this directory, so both branches are reachable on every machine.
 */
export function minimalBinDir(withNode: boolean): string {
  const dir = scratchDir("session-capture-min-bin");
  const tools = ["cat", "date", "mkdir", "dirname"];
  for (const tool of withNode ? [...tools, "node"] : tools) symlinkSync(onPath(tool), join(dir, tool));
  if (!withNode && existsSync(join(dir, "node"))) throw new Error("the nodeless bin dir has a node in it");
  return dir;
}

export type RunResult = { status: number | null; stdout: string; outputDir: string; logPath: string };

/**
 * One run of the hook over `input` — a payload object, or a raw string handed to stdin verbatim
 * for the case that is about an unparseable one.
 *
 * Every run is pointed at throwaway directories: never the real `~/.claude/session-capture.log`,
 * a real transcript, the real Knowledge-Base checkout or the real flush stamp. A caller that is
 * about the flush overrides `SESSION_CAPTURE_KB_DIR`/`SESSION_CAPTURE_KB_STAMP_PATH` through
 * `env`; every other run gets a checkout path that is never created, so `flushKnowledgeBase`'s own
 * `existsSync` fails fast without spawning `git`. An `env.SESSION_CAPTURE_OUTPUT_DIR` the caller
 * supplied wins, since a flush test needs the corpus file to land inside its own clone.
 */
export function runHook(input: string | Record<string, unknown>, env: Record<string, string> = {}): RunResult {
  const outputDir = env.SESSION_CAPTURE_OUTPUT_DIR ?? scratchDir("session-capture-out");
  const logPath = join(scratchDir("session-capture-log"), "session-capture.log");
  const kbDir = join(scratchDir("session-capture-kb"), "missing");
  const kbStampPath = join(scratchDir("session-capture-kb-stamp"), "stamp");
  // Registered after every directory above, so it runs before any of them is removed.
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

/** The `.md` files in `dir`, or none when the directory was never created. */
export function captureFiles(dir: string): string[] {
  return existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".md")) : [];
}

/** Waits for one capture file to land in `dir` — the write happens in a detached child. */
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

/** Waits for the log file to contain at least one line. */
export function waitForLogLine(logPath: string): string {
  return poll(
    () => {
      const content = readLog(logPath);
      return content.trim() ? content : undefined;
    },
    () => `a log line at ${logPath}`,
  );
}

/**
 * Waits until the log contains `substring` — what every publish-step assertion waits on, since the
 * publish half runs after the `captured` line is already written, so "any content" is not enough
 * to know it has finished one way or the other.
 */
export function waitForLogToContain(logPath: string, substring: string): string {
  return poll(
    () => {
      const content = readLog(logPath);
      return content.includes(substring) ? content : undefined;
    },
    () => `"${substring}" at ${logPath}; saw:\n${readLog(logPath)}`,
  );
}

// --- The publish half: a bare "origin" plus clones, real dated commits for `deriveRange` to find.

/** Commits one file in `repo` at an explicit timestamp and pushes it to the bare remote's `main`. */
function commitAndPush(repo: TempRepo, path: string, contents: string, message: string, iso: string): string {
  repo.write(path, contents);
  const sha = repo.commit(message, { date: iso });
  repo.git("push", "-q", "origin", "HEAD:refs/heads/main");
  return sha;
}

/**
 * The `SessionRecord` a fresh clone of `bareDir` sees on `refs/notes/sessions` for `sha` —
 * `notes-store.ts`'s `writeNoteArray` wire format is a one-element JSON array (the same shape
 * `readSessionRecord` itself unwraps), so this unwraps it too.
 */
export function readSessionNote(bareDir: string, sha: string): { sessionId: string } & Record<string, unknown> {
  const records = JSON.parse(noteOnRemote(bareDir, "sessions", sha));
  return Array.isArray(records) ? records[0] : records;
}

/**
 * A stand-in `gh` on PATH — the shared `stubGh`, whose canned answer nobody here parses (the one
 * call the hook makes is a dispatch, and GitHub answers that with no body) — together with the
 * argv log it records every call to. `fail` swaps in a `gh` that exits nonzero on every call, the
 * one lever the "a failed dispatch still leaves the capture file written" test needs.
 */
export function trackerOnPath(opts: { fail?: boolean } = {}): { binDir: string; calls: () => string[][] } {
  if (opts.fail) {
    const binDir = scratchDir("session-capture-failing-gh");
    writeFileSync(join(binDir, "gh"), "#!/bin/bash\nexit 1\n", { mode: 0o755 });
    return { binDir, calls: () => [] };
  }
  const stub = stubGh("");
  return { binDir: dirname(stub.path), calls: stub.calls };
}

/**
 * A transparent `git` wrapper on PATH that proxies every call straight through to the real `git`
 * (found once, in the *test's* own unmodified PATH, so the wrapper never has to re-resolve itself
 * off whatever PATH the hook under test is given) — except a push `isTargetPush` recognises, ahead
 * of which it runs `race` first. That is the one deterministic way to force the exact race the
 * hook is built to survive without relying on real concurrency: the hook runs as one detached
 * child this test cannot step into, so the interleaving has to be pinned from outside it, at the
 * one call whose argv is unambiguous. With `once`, a state file makes the race fire on the first
 * attempt only — a retry must go through untouched, or the test would be asserting "rejected
 * forever," not "rejected once."
 */
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

/** A `git` whose first push of `refs/notes/sessions` is beaten by `racer` pushing its own note for `racerSha`. */
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

/**
 * A `git` whose *every* push of `refs/heads/main` is beaten by `racer` committing and pushing
 * something new first — the one deterministic way to force `flushKnowledgeBase`'s "rejected twice
 * in a row" path, since a race that only wins once is a race the retry survives.
 */
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

// --- The flush step: a bare "Knowledge-Base" remote plus the clone `SESSION_CAPTURE_KB_DIR` names,
// always started genuinely empty — `flushKnowledgeBase`'s own first-ever-flush path (no
// `origin/main` to fetch) is exactly the shape these start from.

/** The commit subject at `refs/heads/main` on a fresh clone of `bareDir`, or `undefined` if that branch doesn't exist there yet. */
export function readKbHeadSubject(bareDir: string): string | undefined {
  const verify = cloneRepo(bareDir, "session-capture-kb-verify");
  try {
    return verify.git("log", "-1", "--format=%s", "origin/main");
  } catch {
    return undefined;
  }
}

/** Waits until `readKbHeadSubject(bareDir)` contains `substring`. */
export function waitForKbHeadSubjectToContain(bareDir: string, substring: string): void {
  poll(
    () => ((readKbHeadSubject(bareDir) ?? "").includes(substring) ? true : undefined),
    () => `"${substring}" at the head of ${bareDir}'s refs/heads/main`,
  );
}

/** Writes an ISO-8601 flush stamp at `path`, `hoursAgo` hours in the past — the exact content shape `flushKnowledgeBase`'s own `writeFlushStamp` produces. */
function writeStamp(path: string, hoursAgo: number): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, new Date(Date.now() - hoursAgo * 60 * 60 * 1000).toISOString());
}

/**
 * One transcript's worth of entries for the publish tests: a human prompt plus an Edit,
 * timestamped to bracket a commit made at `iso`.
 *
 * `sessionRepo` is the worktree the session ran in, and every `file_path` below is absolute
 * beneath it — which is the only shape a real transcript ever has. It used to say `a.ts`, and that
 * relative spelling is why the note's `touchedPaths` looked right in this test for as long as it
 * was fatal on a runner (#107): the fixture was the one place the paths were already relative.
 */
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
          // A real session edits outside the repo too — this is `~/.claude/settings.json`'s stand-in.
          // The repo's history contains it at no path, so the record must not name it at all.
          { type: "tool_use", name: "Write", input: { file_path: join(tmpdir(), "outside-the-repo.json") } },
        ],
      },
      timestamp: after,
    },
  ];
}

/**
 * The payload a `SessionEnd` hook call carries, with the three fields any test varies.
 * `hook_event_name` and `reason` never differ once past the matcher's own `it.each`, and spelling
 * them out per test buried the `cwd` — the one field that decides whether the run is in scope.
 */
export function sessionEnd(sessionId: string, transcriptPath: string, cwd: string): Record<string, unknown> {
  return { session_id: sessionId, transcript_path: transcriptPath, cwd, hook_event_name: "SessionEnd", reason: "clear" };
}

/** A publish-shaped transcript for a session that ran in `sessionRepo`, on disk. */
export function publishTranscriptFor(sessionRepo: TempRepo): string {
  return writeTranscript(publishTranscript(COMMIT_DATE, sessionRepo.dir));
}

const COMMIT_DATE = "2026-08-10T12:00:00Z";

/**
 * The repository the hook is pointed at: a bare "origin", the checkout `SESSION_CAPTURE_REPO_DIR`
 * names, and one dated commit for `deriveRange` to find.
 *
 * The worktree the *session* ran in is a second clone the caller makes, deliberately not returned
 * here: an in-scope test clones `bareDir` again, an out-of-scope one clones a different remote
 * entirely, and that one line is the whole difference those tests exist to draw.
 */
export function makeRepoUnderCapture(): { bareDir: string; repoDir: string; head: string } {
  const bareDir = makeBareRepo("session-capture-bare");
  const repo = cloneRepo(bareDir, "session-capture-clone");
  const head = commitAndPush(repo, "a.ts", "export const a = 1;\n", "work", COMMIT_DATE);
  return { bareDir, repoDir: repo.dir, head };
}

/** A clone of `bareDir` standing in for the worktree a session ran in. */
export function sessionWorktree(bareDir: string): TempRepo {
  return cloneRepo(bareDir, "session-capture-session");
}

/**
 * A Knowledge-Base remote and the checkout `SESSION_CAPTURE_KB_DIR` names, plus the corpus
 * directory inside it that `SESSION_CAPTURE_OUTPUT_DIR` points at — the flush only has something
 * to commit when the capture file lands inside the clone it pushes.
 */
export function makeKbCheckout(): { kbBareDir: string; kbCloneDir: string; kbOutputDir: string } {
  const kbBareDir = makeBareRepo("session-capture-kb-bare");
  const kbCloneDir = cloneRepo(kbBareDir, "session-capture-kb-clone").dir;
  return { kbBareDir, kbCloneDir, kbOutputDir: join(kbCloneDir, "raw", "sessions") };
}

/** One human prompt and nothing else — the transcript a test that isn't about transcript shape needs. */
export function oneHumanPrompt(): string {
  return writeTranscript([
    { type: "user", uuid: "u1", origin: { kind: "human" }, promptSource: "typed", message: { content: "hi" } },
  ]);
}

/**
 * A session that ran *somewhere else*, against a Knowledge-Base checkout with a flush stamp written
 * `hoursAgo` in the past. That number is the whole subject of the two tests that call this: it is
 * the only thing standing between an out-of-scope session and a flush. `stampBefore` is read
 * before the run, since what those assert is whether it was rewritten.
 */
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

/**
 * Breaks connectivity to `bareDir` without touching any clone's git config — `origin` still reads
 * back the same (now-dead) path, so a scope check still passes and the failure is exactly the
 * push or fetch, not a setup slip.
 */
export function killRemote(bareDir: string): void {
  rmSync(bareDir, { recursive: true, force: true });
}

/**
 * What every capture-writing test asserts before it looks at anything of its own: the hook exited
 * 0, said nothing on stdout, and the detached child landed a corpus file. Returns the capture, so
 * a test that reads its content does not poll for it a second time.
 */
export function expectCaptured(result: RunResult): { path: string; content: string } {
  expect(result.status).toBe(0);
  expect(result.stdout).toBe("");
  return waitForCaptureFile(result.outputDir);
}

/**
 * The same for a run that fails open: exit 0, nothing on stdout, a log line to read, and no capture
 * file anywhere. Returns the log, since which outcome was logged is the only thing left to check.
 */
export function expectFailedOpen(result: RunResult): string {
  expect(result.status).toBe(0);
  expect(result.stdout).toBe("");
  const log = waitForLogLine(result.logPath);
  expect(captureFiles(result.outputDir)).toEqual([]);
  return log;
}
