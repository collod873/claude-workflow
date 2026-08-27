import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
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

/**
 * Log paths of hook runs this test started, waited on below before anything is deleted (#129).
 *
 * The hook hands off to a **detached** child, so the run outlives the `spawnSync` that started it
 * and keeps writing into the very directories the teardown removes. `waitForCaptureFile` returns
 * the moment the corpus file lands, and the child's publish half — and its second log line — comes
 * *after* that: measured at 43 of 60 runs on an idle workstation, more under load. The teardown
 * then races a live writer, and loses whenever the write falls inside `rmSync`'s own
 * readdir-then-rmdir window, which is the `ENOTEMPTY` #129 reported.
 *
 * `mkdtempSync` was never the problem — it already gives every process its own directory, so two
 * concurrent suites cannot see each other's trees. Concurrency is not the cause here; it is what
 * widens the window by descheduling the child mid-handoff.
 */
const pendingLogs: string[] = [];

/**
 * How long to wait for a detached run to finish. Generous because it is only ever *reached* by a
 * run that has already gone wrong — a healthy one settles in milliseconds — and because giving up
 * is not a failure: the retrying delete below still cleans up, and a temp directory is not worth
 * failing a test over.
 */
const SETTLE_TIMEOUT_MS = 5_000;

/**
 * Waits until the detached child behind `logPath` has stopped writing.
 *
 * `captured …` used to be the one log line the hook writes that is not its last — every other
 * outcome ended the run, so "the last line is not a `captured`" was the whole settled condition.
 * The flush step (session-capture-hook.mjs's `flushKnowledgeBase`) now runs between `captured` and
 * the publish half, logging its own `flushed <n>`/`skipped push-*` line or none at all — a
 * variable-length middle a position-only check can no longer see past. The publish half's own
 * outcome line (`published …` or one of its `skipped publish-*` variants) is still always the very
 * last thing `main()` writes regardless of what the flush step did or didn't log, so its
 * appearance is "done" for a run that ever reached the corpus write; a run that never did (an
 * early `skipped no-transcript-path`-style exit, one line and nothing more) still settles on the
 * old "any line, and it isn't `captured`" reading, since none of those lines are ever `captured`
 * -prefixed either.
 */
function settle(logPath: string): void {
  const start = Date.now();
  for (;;) {
    const lines = (existsSync(logPath) ? readFileSync(logPath, "utf8") : "").trimEnd().split("\n");
    const last = lines[lines.length - 1] ?? "";
    const sawCaptured = lines.some((l) => /\tcaptured /.test(l));
    const done = sawCaptured
      ? lines.some((l) => /\t(published |skipped publish-)/.test(l))
      : last !== "" && !/\tcaptured /.test(last);
    if (done) return;
    if (Date.now() - start > SETTLE_TIMEOUT_MS) return;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
  }
}

afterEach(() => {
  while (pendingLogs.length) settle(pendingLogs.pop()!);
  while (dirs.length) {
    // `maxRetries` for the residue of the race above: a run that never logged a terminal line is
    // one `settle` gave up on, and it may still be mid-write. A temp directory that survives is
    // the OS's problem, never a red test — this is cleanup, and cleanup that can fail a test is a
    // second way to be wrong about the code under it.
    try {
      rmSync(dirs.pop()!, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    } catch {
      /* ignore */
    }
  }
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
  // A flush test needs the corpus file to land inside its own Knowledge-Base clone (so there is
  // something for the flush to commit), not the throwaway directory this would otherwise
  // generate — so an `env.SESSION_CAPTURE_OUTPUT_DIR` the caller already supplied wins, and this
  // returns exactly that path rather than one nothing was ever written to.
  const outputDir = env.SESSION_CAPTURE_OUTPUT_DIR ?? tmpDir("session-capture-out-");
  const logDir = tmpDir("session-capture-log-");
  const logPath = join(logDir, "session-capture.log");
  pendingLogs.push(logPath);

  // Defaults for the two new flush-only env vars: a checkout path that is never created (so
  // `flushKnowledgeBase`'s own `existsSync` check fails fast, without ever spawning `git`) and a
  // stamp path under a throwaway dir. Every test that isn't itself exercising the flush step gets
  // a fast, harmless `skipped push-*` line instead of ever reading or writing the real
  // Knowledge-Base checkout or the real `~/.claude/kb-flush-stamp` — a test that does care about
  // the flush overrides both via its own `env` argument.
  const kbDir = join(tmpDir("session-capture-kb-"), "missing");
  const kbStampPath = join(tmpDir("session-capture-kb-stamp-"), "stamp");

  const run = spawnSync(HOOK, [], {
    input: JSON.stringify(payload),
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

// --- Fixtures for the flush step: a bare "Knowledge-Base" remote plus one clone that stands in
// for `SESSION_CAPTURE_KB_DIR`, always started genuinely empty — `flushKnowledgeBase`'s own
// first-ever-flush path (no `origin/main` to fetch) is exactly the shape these start from, and
// `makeBareRemote`/`cloneRepo` above already produce it without a seed commit.

/** Reads the commit subject currently at `refs/heads/main` on a fresh clone of `bareDir`, or `undefined` if that branch doesn't exist there yet. */
function readKbHeadSubject(bareDir: string): string | undefined {
  const dir = tmpDir("session-capture-kb-verify-");
  execFileSync("git", ["clone", "-q", bareDir, "."], { cwd: dir });
  try {
    return execFileSync("git", ["-C", dir, "log", "-1", "--format=%s", "origin/main"], { encoding: "utf8" }).trim();
  } catch {
    return undefined;
  }
}

/** Busy-polls until `readKbHeadSubject(bareDir)` matches `substring`, or times out. */
function waitForKbHeadSubjectToContain(bareDir: string, substring: string, timeoutMs = POLL_TIMEOUT_MS): void {
  const start = Date.now();
  for (;;) {
    if ((readKbHeadSubject(bareDir) ?? "").includes(substring)) return;
    if (Date.now() - start > timeoutMs) {
      throw new Error(`timed out waiting for "${substring}" at the head of ${bareDir}'s refs/heads/main`);
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
  }
}

/** Writes an ISO-8601 flush stamp at `path`, `hoursAgo` hours in the past — the exact content shape `flushKnowledgeBase`'s own `writeFlushStamp` produces. */
function writeStamp(path: string, hoursAgo: number): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, new Date(Date.now() - hoursAgo * 60 * 60 * 1000).toISOString());
}

/**
 * A `git` wrapper on PATH that proxies every call straight through to the real `git` — except
 * every single push of `refs/heads/main` to the Knowledge-Base remote, ahead of which it makes
 * `racerRepo` commit and push something new first. Unlike `fakeGitRaceBinDir` above (which fires
 * once, so the retry it forces can succeed), this fires on *every* attempt: the one deterministic
 * way to force `flushKnowledgeBase`'s "rejected twice in a row" path without relying on real
 * concurrency, since a race that only wins once is a race the retry survives, not the one this
 * exercises.
 */
function fakeGitAlwaysRejectKbPushBinDir(realGit: string, racerRepo: string): string {
  const dir = tmpDir("session-capture-fake-git-reject-");
  const script = `#!/usr/bin/env node
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
const realGit = ${JSON.stringify(realGit)};
const racerRepo = ${JSON.stringify(racerRepo)};

function isTargetPush(a) {
  return a.includes("push") && a.some((v) => v.endsWith(":refs/heads/main")) && a.includes("origin");
}

if (isTargetPush(args)) {
  fs.writeFileSync(path.join(racerRepo, "racer.txt"), String(Date.now()) + Math.random());
  spawnSync(realGit, ["-C", racerRepo, "add", "-A"], { stdio: "ignore" });
  spawnSync(realGit, ["-C", racerRepo, "commit", "-q", "-m", "racer"], { stdio: "ignore" });
  spawnSync(realGit, ["-C", racerRepo, "push", "-q", "origin", "HEAD:refs/heads/main"], { stdio: "ignore" });
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

  /**
   * #129. The suite used to delete its scratch directories while the hook's detached child was
   * still writing into them, and `rmSync` threw `ENOTEMPTY` whenever a write landed inside its
   * readdir-then-rmdir window — a red gate that reads, at a glance, as the merge that happened to
   * be in flight.
   *
   * This pins the rule the teardown now relies on: `captured` is not the end of a run, and the
   * line after it is. It goes red if a later log line is ever appended past the publish half,
   * which would make the teardown start racing again with nothing else to notice.
   */
  it("keeps writing after the capture file lands, and stops once settle returns", () => {
    const result = runHook({
      session_id: "abcdef1234567890",
      transcript_path: writeTranscript([
        { type: "user", uuid: "u1", origin: { kind: "human" }, promptSource: "typed", message: { content: "Ship it." } },
        { type: "assistant", uuid: "a1", message: { content: [{ type: "text", text: "On it." }] } },
      ]),
      cwd: "test-project",
      hook_event_name: "SessionEnd",
      reason: "clear",
    });

    waitForCaptureFile(result.outputDir);
    settle(result.logPath);

    const settled = readLog(result.logPath);
    expect(settled).toContain("captured abcdef1234567890");
    expect(settled.trimEnd().split("\n").at(-1)).not.toContain("captured ");

    // Nothing more arrives — so a delete issued here cannot race a writer.
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
    expect(readLog(result.logPath)).toBe(settled);
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
    // builds carries no `git`, so both the flush step (`skipped push-*`) and the publish half's
    // own scope check (`skipped publish-*`) fail closed; those are later halves with a different
    // failure posture (module header), not evidence the repair above it regressed.
    const log = waitForLogToContain(result.logPath, "captured x");
    expect(log).not.toMatch(/skipped (?!publish-|push-)/);
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
    pendingLogs.push(logPath);

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
    const capture = waitForCaptureFile(result.outputDir);

    const log = waitForLogToContain(result.logPath, "published");
    expect(log).toContain(`published session-in-scope ${head}`);

    const note = readSessionNote(bareDir, head) as {
      sessionId: string;
      base: string;
      head: string;
      touchedPaths: string[];
      corpusPath: string;
    };
    expect(note.sessionId).toBe("session-in-scope");
    expect(note.head).toBe(head);
    // Relative to the session's own worktree, and the out-of-repo edit is gone: this is the whole
    // pathspec a runner's `git diff` will be handed, in a checkout at a different absolute path.
    expect(note.touchedPaths).toEqual(["a.ts"]);
    // The spine itself never rides the note (spec #134) — `corpusPath` is the pointer a reader
    // hydrates it back from, joined against its own Knowledge-Base checkout. Here that checkout is
    // stood in by `result.outputDir/..` (`SESSION_CAPTURE_OUTPUT_DIR` is `<corpusDir>/raw/sessions`),
    // so this asserts the same "corpus write and note agree" fact the old `note.spine` assertion did.
    expect(note.corpusPath).toBe(join("raw", "sessions", basename(capture.path)));
    expect(note).not.toHaveProperty("spine");
    expect(capture.content).toContain("ship the range derivation");

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

describe("session-capture.sh — flushing the Knowledge-Base checkout", () => {
  it("flushes before the dispatch fires, for a session that ran in this repo", () => {
    const bareDir = makeBareRemote();
    const repoDir = cloneRepo(bareDir);
    const head = commitAndPush(repoDir, "a.ts", "export const a = 1;\n", "work", "2026-08-10T12:00:00Z");
    const sessionRepo = cloneRepo(bareDir);

    const kbBareDir = makeBareRemote();
    const kbCloneDir = cloneRepo(kbBareDir);
    const kbOutputDir = join(kbCloneDir, "raw", "sessions");

    const ghLogPath = join(tmpDir("session-capture-gh-log-"), "gh.log");
    const ghBinDir = fakeGhBinDir(ghLogPath);

    const transcript = writeTranscript(publishTranscript("2026-08-10T12:00:00Z", sessionRepo));

    const result = runHook(
      { session_id: "session-flush", transcript_path: transcript, cwd: sessionRepo, hook_event_name: "SessionEnd", reason: "clear" },
      {
        SESSION_CAPTURE_REPO_DIR: repoDir,
        SESSION_CAPTURE_KB_DIR: kbCloneDir,
        SESSION_CAPTURE_OUTPUT_DIR: kbOutputDir,
        PATH: `${ghBinDir}:${process.env.PATH}`,
      },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
    waitForCaptureFile(result.outputDir);

    const log = waitForLogToContain(result.logPath, "published");
    expect(log).toContain(`published session-flush ${head}`);
    expect(log).toContain("flushed 1");
    // Order, not just presence: `flushKnowledgeBase` runs and returns before `dispatchAudit` is
    // ever reached (module header, main()'s own call order) — a log that is append-only and
    // written by one synchronous process makes that order directly readable.
    expect(log.indexOf("flushed 1")).toBeLessThan(log.indexOf("published"));

    waitForKbHeadSubjectToContain(kbBareDir, "flush: 1 session capture");
    // The commit message names the flush and the count, never the session — this is the only
    // place either could leak into it, and it must not.
    expect(readKbHeadSubject(kbBareDir)).toBe("flush: 1 session capture");
  });

  it("makes no Knowledge-Base push when the session ran elsewhere and the flush stamp is fresh", () => {
    const bareDir = makeBareRemote();
    const repoDir = cloneRepo(bareDir);
    commitAndPush(repoDir, "a.ts", "export const a = 1;\n", "work", "2026-08-10T12:00:00Z");

    const otherBareDir = makeBareRemote();
    const otherRepo = cloneRepo(otherBareDir);

    const kbBareDir = makeBareRemote();
    const kbCloneDir = cloneRepo(kbBareDir);
    const kbOutputDir = join(kbCloneDir, "raw", "sessions");
    const kbStampPath = join(tmpDir("session-capture-kb-stamp-fresh-"), "stamp");
    writeStamp(kbStampPath, 1); // one hour ago — well inside the 24-hour throttle window
    const freshStamp = readFileSync(kbStampPath, "utf8");

    const transcript = writeTranscript([
      { type: "user", uuid: "u1", origin: { kind: "human" }, promptSource: "typed", message: { content: "hi" } },
    ]);

    const result = runHook(
      { session_id: "session-elsewhere-fresh", transcript_path: transcript, cwd: otherRepo, hook_event_name: "SessionEnd", reason: "clear" },
      {
        SESSION_CAPTURE_REPO_DIR: repoDir,
        SESSION_CAPTURE_KB_DIR: kbCloneDir,
        SESSION_CAPTURE_KB_STAMP_PATH: kbStampPath,
        SESSION_CAPTURE_OUTPUT_DIR: kbOutputDir,
      },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
    waitForCaptureFile(result.outputDir);

    const log = waitForLogToContain(result.logPath, "skipped publish-out-of-scope");
    expect(log).not.toContain("flushed");
    expect(log).not.toContain("skipped push-");
    // Nothing ever reached `origin` — the bare remote is still exactly what `makeBareRemote` left it.
    expect(readKbHeadSubject(kbBareDir)).toBeUndefined();
    expect(readFileSync(kbStampPath, "utf8")).toBe(freshStamp);
  });

  it("pushes and rewrites the stamp when the session ran elsewhere and the flush stamp is more than 24 hours old", () => {
    const bareDir = makeBareRemote();
    const repoDir = cloneRepo(bareDir);
    commitAndPush(repoDir, "a.ts", "export const a = 1;\n", "work", "2026-08-10T12:00:00Z");

    const otherBareDir = makeBareRemote();
    const otherRepo = cloneRepo(otherBareDir);

    const kbBareDir = makeBareRemote();
    const kbCloneDir = cloneRepo(kbBareDir);
    const kbOutputDir = join(kbCloneDir, "raw", "sessions");
    const kbStampPath = join(tmpDir("session-capture-kb-stamp-stale-"), "stamp");
    writeStamp(kbStampPath, 25); // just past the 24-hour throttle window
    const staleStamp = readFileSync(kbStampPath, "utf8");

    const transcript = writeTranscript([
      { type: "user", uuid: "u1", origin: { kind: "human" }, promptSource: "typed", message: { content: "hi" } },
    ]);

    const result = runHook(
      { session_id: "session-elsewhere-stale", transcript_path: transcript, cwd: otherRepo, hook_event_name: "SessionEnd", reason: "clear" },
      {
        SESSION_CAPTURE_REPO_DIR: repoDir,
        SESSION_CAPTURE_KB_DIR: kbCloneDir,
        SESSION_CAPTURE_KB_STAMP_PATH: kbStampPath,
        SESSION_CAPTURE_OUTPUT_DIR: kbOutputDir,
      },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
    waitForCaptureFile(result.outputDir);

    // Waits for the publish half's own terminal line, not `flushed 1` — the latter is written
    // first, and reading right after it would race the still-running publish half (#129).
    const log = waitForLogToContain(result.logPath, "skipped publish-out-of-scope");
    expect(log).toContain("flushed 1");

    waitForKbHeadSubjectToContain(kbBareDir, "flush: 1 session capture");

    const rewrittenStamp = readFileSync(kbStampPath, "utf8");
    expect(rewrittenStamp).not.toBe(staleStamp);
    expect(Date.now() - Date.parse(rewrittenStamp)).toBeLessThan(60_000);
  });

  it("logs its own skipped push-* line and still writes the capture file when the Knowledge-Base checkout is missing", () => {
    const bareDir = makeBareRemote();
    const repoDir = cloneRepo(bareDir);
    const head = commitAndPush(repoDir, "a.ts", "export const a = 1;\n", "work", "2026-08-10T12:00:00Z");
    const sessionRepo = cloneRepo(bareDir);

    const missingKbDir = join(tmpDir("session-capture-kb-missing-"), "does-not-exist");

    const ghLogPath = join(tmpDir("session-capture-gh-log-"), "gh.log");
    const ghBinDir = fakeGhBinDir(ghLogPath);

    const transcript = writeTranscript(publishTranscript("2026-08-10T12:00:00Z", sessionRepo));

    const result = runHook(
      { session_id: "session-kb-missing", transcript_path: transcript, cwd: sessionRepo, hook_event_name: "SessionEnd", reason: "clear" },
      { SESSION_CAPTURE_REPO_DIR: repoDir, SESSION_CAPTURE_KB_DIR: missingKbDir, PATH: `${ghBinDir}:${process.env.PATH}` },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
    waitForCaptureFile(result.outputDir);

    // Waits for `published`, not merely `skipped push-`: the latter appears well before `main()`
    // is done, and reading at that point would race the publish half exactly as #129 did.
    const log = waitForLogToContain(result.logPath, "published");
    expect(log).toContain("skipped push-");
    expect(log).toContain("no Knowledge-Base checkout");
    // The note push and the dispatch are unconditionally attempted regardless of the flush's own
    // outcome (module header) — the failure above must not have taken them down with it.
    expect(log).toContain(`published session-kb-missing ${head}`);
  });

  it("logs its own skipped push-* line when the push is rejected twice in a row", () => {
    const bareDir = makeBareRemote();
    const repoDir = cloneRepo(bareDir);
    const head = commitAndPush(repoDir, "a.ts", "export const a = 1;\n", "work", "2026-08-10T12:00:00Z");
    const sessionRepo = cloneRepo(bareDir);

    const kbBareDir = makeBareRemote();
    const kbCloneDir = cloneRepo(kbBareDir);
    const kbOutputDir = join(kbCloneDir, "raw", "sessions");
    const racerRepo = cloneRepo(kbBareDir);

    const gitBinDir = fakeGitAlwaysRejectKbPushBinDir(onPath("git"), racerRepo);
    const ghLogPath = join(tmpDir("session-capture-gh-log-"), "gh.log");
    const ghBinDir = fakeGhBinDir(ghLogPath);

    const transcript = writeTranscript(publishTranscript("2026-08-10T12:00:00Z", sessionRepo));

    const result = runHook(
      { session_id: "session-kb-rejected", transcript_path: transcript, cwd: sessionRepo, hook_event_name: "SessionEnd", reason: "clear" },
      {
        SESSION_CAPTURE_REPO_DIR: repoDir,
        SESSION_CAPTURE_KB_DIR: kbCloneDir,
        SESSION_CAPTURE_OUTPUT_DIR: kbOutputDir,
        PATH: `${gitBinDir}:${ghBinDir}:${process.env.PATH}`,
      },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
    waitForCaptureFile(result.outputDir);

    // Waits for `published`, not merely `skipped push-` — see the "missing checkout" test above.
    const log = waitForLogToContain(result.logPath, "published");
    expect(log).toContain("skipped push-");
    expect(log).toContain("rejected twice in a row");
    expect(log).not.toContain("flushed");
    // The racer owns `refs/heads/main` on the Knowledge-Base remote, not us.
    expect(readKbHeadSubject(kbBareDir)).toBe("racer");
    // A KB push loses its race on every attempt — the notes-ref push (a different remote,
    // `repoDir`'s own bare) is untouched by it and still succeeds.
    expect(log).toContain(`published session-kb-rejected ${head}`);
  });

  it("logs its own skipped push-* line when the Knowledge-Base remote is unreachable", () => {
    const bareDir = makeBareRemote();
    const repoDir = cloneRepo(bareDir);
    const head = commitAndPush(repoDir, "a.ts", "export const a = 1;\n", "work", "2026-08-10T12:00:00Z");
    const sessionRepo = cloneRepo(bareDir);

    const kbBareDir = makeBareRemote();
    const kbCloneDir = cloneRepo(kbBareDir);
    const kbOutputDir = join(kbCloneDir, "raw", "sessions");

    // Breaks connectivity without touching the clone's own git config — `origin` still reads back
    // the same (now-dead) path, so the failure is exactly the flush's own fetch, not a setup slip.
    rmSync(kbBareDir, { recursive: true, force: true });

    const ghLogPath = join(tmpDir("session-capture-gh-log-"), "gh.log");
    const ghBinDir = fakeGhBinDir(ghLogPath);

    const transcript = writeTranscript(publishTranscript("2026-08-10T12:00:00Z", sessionRepo));

    const result = runHook(
      { session_id: "session-kb-unreachable", transcript_path: transcript, cwd: sessionRepo, hook_event_name: "SessionEnd", reason: "clear" },
      {
        SESSION_CAPTURE_REPO_DIR: repoDir,
        SESSION_CAPTURE_KB_DIR: kbCloneDir,
        SESSION_CAPTURE_OUTPUT_DIR: kbOutputDir,
        PATH: `${ghBinDir}:${process.env.PATH}`,
      },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
    waitForCaptureFile(result.outputDir);

    // Waits for `published`, not merely `skipped push-` — see the "missing checkout" test above.
    const log = waitForLogToContain(result.logPath, "published");
    expect(log).toContain("skipped push-");
    expect(log).not.toContain("flushed");
    expect(log).toContain(`published session-kb-unreachable ${head}`);
  });
});
