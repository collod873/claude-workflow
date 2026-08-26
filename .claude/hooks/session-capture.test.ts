import { execFileSync, spawnSync } from "node:child_process";
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

/**
 * Busy-polls until the log file contains `substring` — what every publish-step assertion below
 * waits on, since the publish half runs (synchronously, within the same detached child) *after*
 * the "captured" line is already written, so `waitForLogLine`'s "any content" is not enough to
 * know the publish half has finished one way or the other.
 */
function waitForLogToContain(logPath: string, substring: string, timeoutMs = POLL_TIMEOUT_MS): string {
  const start = Date.now();
  for (;;) {
    const content = readLog(logPath);
    if (content.includes(substring)) return content;
    if (Date.now() - start > timeoutMs) {
      throw new Error(`timed out waiting for "${substring}" at ${logPath}; saw:\n${content}`);
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
  }
}

// --- Fixtures for the publish half: a bare "origin" plus clones, the shape every publish test
// needs (mirrors notes-sync.test.ts's own makeRemoteAndClones/cloneFrom, extended with a commit
// helper since these tests need real, dated commits for `deriveRange` to find).

/** A bare git repo standing in for "origin" — no working tree, just refs. */
function makeBareRemote(): string {
  const dir = tmpDir("session-capture-bare-");
  execFileSync("git", ["init", "-q", "--bare", dir]);
  return dir;
}

/** Clones `bareDir`, with a committer identity configured so the clone can make its own commits. */
function cloneRepo(bareDir: string): string {
  const dir = tmpDir("session-capture-clone-");
  execFileSync("git", ["clone", "-q", bareDir, "."], { cwd: dir });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: dir });
  return dir;
}

/** Commits one file in `dir` at an explicit timestamp and pushes it to the bare remote's `main`. */
function commitAndPush(dir: string, path: string, contents: string, message: string, iso: string): string {
  writeFileSync(join(dir, path), contents, "utf8");
  execFileSync("git", ["add", "."], { cwd: dir });
  execFileSync("git", ["commit", "-q", "-m", message], {
    cwd: dir,
    env: { ...process.env, GIT_AUTHOR_DATE: iso, GIT_COMMITTER_DATE: iso },
  });
  const sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir, encoding: "utf8" }).trim();
  execFileSync("git", ["push", "-q", "origin", "HEAD:refs/heads/main"], { cwd: dir });
  return sha;
}

/**
 * Reads back the `SessionRecord` a fresh clone of `bareDir` sees on `refs/notes/sessions` for
 * `sha` — `notes-store.ts`'s `writeNoteArray` wire format is a one-element JSON array (the same
 * shape `readSessionRecord` itself unwraps), so this unwraps it too rather than handing back the
 * array.
 */
function readSessionNote(bareDir: string, sha: string): unknown {
  const dir = tmpDir("session-capture-verify-");
  execFileSync("git", ["clone", "-q", bareDir, "."], { cwd: dir });
  execFileSync("git", ["-C", dir, "fetch", "-q", "origin", "+refs/notes/sessions:refs/notes/sessions"]);
  const raw = execFileSync("git", ["-C", dir, "notes", "--ref=sessions", "show", sha], { encoding: "utf8" }).trim();
  const records = JSON.parse(raw);
  return Array.isArray(records) ? records[0] : records;
}

/**
 * A stand-in `gh` on PATH: every invocation is recorded (one JSON-encoded argv array per line) to
 * `logPath`, and it exits nonzero when `fail` is set — the one lever the "a failed dispatch still
 * leaves the capture file written" test needs, without ever reaching the real `gh` or a network.
 */
function fakeGhBinDir(logPath: string, opts: { fail?: boolean } = {}): string {
  const dir = tmpDir("session-capture-fake-gh-");
  const script = [
    "#!/usr/bin/env node",
    "const fs = require('node:fs');",
    `fs.appendFileSync(${JSON.stringify(logPath)}, JSON.stringify(process.argv.slice(2)) + "\\n");`,
    opts.fail ? "process.exit(1);" : "process.exit(0);",
  ].join("\n");
  writeFileSync(join(dir, "gh"), script, { mode: 0o755 });
  return dir;
}

/**
 * A transparent `git` wrapper on PATH that proxies every call straight through to the real `git`
 * (found once, in the *test's* own unmodified PATH, so the wrapper never has to re-resolve itself
 * off of whatever PATH the hook under test is given) — except the very first push of
 * `refs/notes/sessions`, ahead of which it makes `racerRepo` push its own conflicting note for
 * `racerSha` first. That is the one deterministic way to force the exact race
 * `syncNotesRef`/notes-sync.test.ts is built to survive without relying on real concurrency: the
 * hook runs as one detached child process this test cannot step into, so the interleaving has to
 * be pinned from outside it, at the one call whose argv is unambiguous. `stateFile` makes the race
 * fire once, on the first attempt only — a second, identical push (the retry) must go through
 * untouched, or the test would be asserting "rejected forever," not "rejected once."
 */
function fakeGitRaceBinDir(realGit: string, opts: { racerRepo: string; racerSha: string; stateFile: string }): string {
  const dir = tmpDir("session-capture-fake-git-");
  const script = `#!/usr/bin/env node
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const args = process.argv.slice(2);
const realGit = ${JSON.stringify(realGit)};
const racerRepo = ${JSON.stringify(opts.racerRepo)};
const racerSha = ${JSON.stringify(opts.racerSha)};
const stateFile = ${JSON.stringify(opts.stateFile)};

function isTargetPush(a) {
  return a.includes("push") && a.includes("refs/notes/sessions:refs/notes/sessions");
}

if (isTargetPush(args)) {
  let raced = false;
  try { raced = fs.readFileSync(stateFile, "utf8").trim() === "1"; } catch {}
  if (!raced) {
    fs.writeFileSync(stateFile, "1");
    spawnSync(realGit, ["-C", racerRepo, "notes", "--ref=sessions", "add", "-f", "-m", "racer", racerSha], { stdio: "ignore" });
    spawnSync(realGit, ["-C", racerRepo, "push", "-q", "origin", "refs/notes/sessions:refs/notes/sessions"], { stdio: "ignore" });
  }
}

const result = spawnSync(realGit, args, { stdio: "inherit" });
process.exit(result.status === null ? 1 : result.status);
`;
  writeFileSync(join(dir, "git"), script, { mode: 0o755 });
  return dir;
}

/** One fixture transcript's worth of entries for the publish tests: a human prompt plus an Edit, timestamped to bracket a commit made at `iso`. */
/**
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
      { type: "user", uuid: "i1", message: { content: [{ type: "text", text: "[Request interrupted by user for tool use]" }] } },
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
    expect(capture.content).toContain("format: 2");
    expect(capture.content).toContain("## User Prompts");
    expect(capture.content).toContain("## Exchange");

    // The human turn, the assistant text, and the Esc interrupt survive the live path.
    expect(capture.content).toContain("Please help me ship this.");
    expect(capture.content).toContain("Sure, I will get started on shipping this.");
    expect(capture.content).toContain("**Interrupted** — during a tool call");

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
    // The capture half succeeds outright — no capture-side skip. The minimal bin dir this test
    // builds carries no `git`, so the publish half's own scope check fails closed and logs its
    // own, entirely expected `skipped publish-*` line; that is a different half with a different
    // failure posture (module header), not evidence the repair above it regressed.
    const log = waitForLogToContain(result.logPath, "captured x");
    expect(log).not.toMatch(/skipped (?!publish-)/);
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

describe("session-capture.sh — publishing the session record and dispatching the audit", () => {
  it("publishes a session record and dispatches the audit when the session ran in this repo", () => {
    const bareDir = makeBareRemote();
    const repoDir = cloneRepo(bareDir);
    const head = commitAndPush(repoDir, "a.ts", "export const a = 1;\n", "work", "2026-08-10T12:00:00Z");
    const sessionRepo = cloneRepo(bareDir);

    const ghLogPath = join(tmpDir("session-capture-gh-log-"), "gh.log");
    const ghBinDir = fakeGhBinDir(ghLogPath);

    const transcript = writeTranscript(publishTranscript("2026-08-10T12:00:00Z", sessionRepo));

    const result = runHook(
      { session_id: "session-in-scope", transcript_path: transcript, cwd: sessionRepo, hook_event_name: "SessionEnd", reason: "clear" },
      { SESSION_CAPTURE_REPO_DIR: repoDir, PATH: `${ghBinDir}:${process.env.PATH}` },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
    waitForCaptureFile(result.outputDir);

    const log = waitForLogToContain(result.logPath, "published");
    expect(log).toContain(`published session-in-scope ${head}`);

    const note = readSessionNote(bareDir, head) as {
      sessionId: string;
      base: string;
      head: string;
      touchedPaths: string[];
      spine: string;
    };
    expect(note.sessionId).toBe("session-in-scope");
    expect(note.head).toBe(head);
    // Relative to the session's own worktree, and the out-of-repo edit is gone: this is the whole
    // pathspec a runner's `git diff` will be handed, in a checkout at a different absolute path.
    expect(note.touchedPaths).toEqual(["a.ts"]);
    expect(note.spine).toContain("ship the range derivation");

    const ghLog = existsSync(ghLogPath) ? readFileSync(ghLogPath, "utf8") : "";
    expect(ghLog).toContain("dispatches");
    expect(ghLog).toContain("event_type=session-captured");
    expect(ghLog).toContain(`client_payload[head]=${head}`);
  });

  it("captures but does not publish or dispatch when the session ran in a different repo", () => {
    const bareDir = makeBareRemote();
    const repoDir = cloneRepo(bareDir);
    commitAndPush(repoDir, "a.ts", "export const a = 1;\n", "work", "2026-08-10T12:00:00Z");

    const otherBareDir = makeBareRemote();
    const otherRepo = cloneRepo(otherBareDir);

    const ghLogPath = join(tmpDir("session-capture-gh-log-"), "gh.log");
    const ghBinDir = fakeGhBinDir(ghLogPath);

    const transcript = writeTranscript(publishTranscript("2026-08-10T12:00:00Z", otherRepo));

    const result = runHook(
      { session_id: "session-out-of-scope", transcript_path: transcript, cwd: otherRepo, hook_event_name: "SessionEnd", reason: "clear" },
      { SESSION_CAPTURE_REPO_DIR: repoDir, PATH: `${ghBinDir}:${process.env.PATH}` },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
    waitForCaptureFile(result.outputDir);

    const log = waitForLogToContain(result.logPath, "skipped publish-out-of-scope");
    expect(log).not.toContain("published");

    expect(existsSync(ghLogPath)).toBe(false);
  });

  it("retries a push rejected non-fast-forward once against a local bare remote, and succeeds", () => {
    const bareDir = makeBareRemote();
    const repoDir = cloneRepo(bareDir);
    const head = commitAndPush(repoDir, "a.ts", "export const a = 1;\n", "work", "2026-08-10T12:00:00Z");
    const sessionRepo = cloneRepo(bareDir);
    const racerRepo = cloneRepo(bareDir);

    const stateFile = join(tmpDir("session-capture-race-state-"), "raced");
    const gitBinDir = fakeGitRaceBinDir(onPath("git"), { racerRepo, racerSha: head, stateFile });
    const ghLogPath = join(tmpDir("session-capture-gh-log-"), "gh.log");
    const ghBinDir = fakeGhBinDir(ghLogPath);

    const transcript = writeTranscript(publishTranscript("2026-08-10T12:00:00Z", sessionRepo));

    const result = runHook(
      { session_id: "session-race", transcript_path: transcript, cwd: sessionRepo, hook_event_name: "SessionEnd", reason: "clear" },
      { SESSION_CAPTURE_REPO_DIR: repoDir, PATH: `${gitBinDir}:${ghBinDir}:${process.env.PATH}` },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
    waitForCaptureFile(result.outputDir);

    const log = waitForLogToContain(result.logPath, "published");
    expect(log).toContain(`published session-race ${head}`);
    expect(log).not.toContain("publish-push-failed");

    // Our write won the retry — not the racer's, and not silently merged with it.
    const note = readSessionNote(bareDir, head) as { sessionId: string };
    expect(note.sessionId).toBe("session-race");
  });

  it("still writes the capture file and exits 0 when the push fails outright (not a race, an unreachable remote)", () => {
    const bareDir = makeBareRemote();
    const repoDir = cloneRepo(bareDir);
    commitAndPush(repoDir, "a.ts", "export const a = 1;\n", "work", "2026-08-10T12:00:00Z");
    const sessionRepo = cloneRepo(bareDir);

    // Breaks connectivity without touching either clone's own git config — `origin` still reads
    // back the same (now-dead) path on both sides, so the scope check still passes and the
    // failure is exactly the push, not a scope mismatch this test would otherwise be proving.
    rmSync(bareDir, { recursive: true, force: true });

    const ghLogPath = join(tmpDir("session-capture-gh-log-"), "gh.log");
    const ghBinDir = fakeGhBinDir(ghLogPath);

    const transcript = writeTranscript(publishTranscript("2026-08-10T12:00:00Z", sessionRepo));

    const result = runHook(
      { session_id: "session-dead-remote", transcript_path: transcript, cwd: sessionRepo, hook_event_name: "SessionEnd", reason: "clear" },
      { SESSION_CAPTURE_REPO_DIR: repoDir, PATH: `${ghBinDir}:${process.env.PATH}` },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
    waitForCaptureFile(result.outputDir);

    const log = waitForLogToContain(result.logPath, "skipped publish-push-failed");
    expect(log).not.toContain("published");
    expect(existsSync(ghLogPath)).toBe(false);
  });

  it("still writes the capture file and exits 0 when the dispatch fails after a successful push", () => {
    const bareDir = makeBareRemote();
    const repoDir = cloneRepo(bareDir);
    const head = commitAndPush(repoDir, "a.ts", "export const a = 1;\n", "work", "2026-08-10T12:00:00Z");
    const sessionRepo = cloneRepo(bareDir);

    const ghLogPath = join(tmpDir("session-capture-gh-log-"), "gh.log");
    const ghBinDir = fakeGhBinDir(ghLogPath, { fail: true });

    const transcript = writeTranscript(publishTranscript("2026-08-10T12:00:00Z", sessionRepo));

    const result = runHook(
      { session_id: "session-dispatch-fails", transcript_path: transcript, cwd: sessionRepo, hook_event_name: "SessionEnd", reason: "clear" },
      { SESSION_CAPTURE_REPO_DIR: repoDir, PATH: `${ghBinDir}:${process.env.PATH}` },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
    waitForCaptureFile(result.outputDir);

    const log = waitForLogToContain(result.logPath, "skipped publish-dispatch-failed");
    expect(log).not.toContain("published");

    // The push itself went through before the dispatch failed — the note is really there.
    const note = readSessionNote(bareDir, head) as { sessionId: string };
    expect(note.sessionId).toBe("session-dispatch-fails");
  });
});
