#!/usr/bin/env node
/**
 * @shell session-capture.sh spawns this by path as a detached child; nothing imports it, so that
 * spawn is the only edge reaching it and no static analysis sees it.
 */
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync, writeSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildCaptureMarkdown, parseTranscript } from "../../.Workflow/agent-workflows/shared/spine.ts";
import { reason } from "../../.Workflow/agent-workflows/shared/reason.ts";
import { execGit } from "../../.Workflow/agent-workflows/shared/git.ts";
import { execGh } from "../../.Workflow/agent-workflows/shared/gh.ts";
import { deriveRange } from "../../.Workflow/agent-workflows/capture/range.ts";
import { ownerAndRepoFromOrigin, sessionIsInThisRepo } from "../../.Workflow/agent-workflows/capture/repo-scope.ts";
import { toRepoRelative, worktreeRoot } from "../../.Workflow/agent-workflows/capture/touched-paths.ts";
import { writeSessionRecord } from "../../.Workflow/agent-workflows/observations/session-notes.ts";
import { syncNotesRef } from "../../.Workflow/agent-workflows/shared/notes-sync.ts";

const OUTPUT_DIR = process.env.SESSION_CAPTURE_OUTPUT_DIR || join(homedir(), "Claude Projects", "Knowledge-Base", "raw", "sessions");
const CORPUS_SUBDIR = join("raw", "sessions");
const LOG_PATH = process.env.SESSION_CAPTURE_LOG_PATH || join(homedir(), ".claude", "session-capture.log");
const REPO_DIR = process.env.SESSION_CAPTURE_REPO_DIR || join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const KB_DIR = process.env.SESSION_CAPTURE_KB_DIR || join(homedir(), "Claude Projects", "Knowledge-Base");
const KB_STAMP_PATH = process.env.SESSION_CAPTURE_KB_STAMP_PATH || join(homedir(), ".claude", "kb-flush-stamp");
const KB_FLUSH_THROTTLE_MS = 24 * 60 * 60 * 1000;
const KB_FLUSH_REMOTE_REF = "refs/heads/main";
const DISPATCH_EVENT_TYPE = "session-captured";

const LOCK_STALE_MS = 30_000;
const LOCK_TIMEOUT_MS = 10_000;
const LOCK_POLL_MS = 25;

function log(outcome) {
  try {
    mkdirSync(dirname(LOG_PATH), { recursive: true });
    const ts = new Date().toISOString().replace(/\.\d+Z$/, "Z");
    appendFileSync(LOG_PATH, `${ts}\t${outcome}\n`);
  } catch {
  }
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function withLock(path, fn) {
  const lockPath = `${path}.lock`;
  const start = Date.now();
  for (;;) {
    try {
      const fd = openSync(lockPath, "wx");
      writeSync(fd, String(process.pid));
      closeSync(fd);
      break;
    } catch (err) {
      if (err.code !== "EEXIST") throw err;
      try {
        if (Date.now() - statSync(lockPath).mtimeMs > LOCK_STALE_MS) unlinkSync(lockPath);
      } catch {
      }
      if (Date.now() - start > LOCK_TIMEOUT_MS) throw new Error("lock-timeout");
      sleepSync(LOCK_POLL_MS);
    }
  }
  try {
    fn();
  } finally {
    try {
      unlinkSync(lockPath);
    } catch {
    }
  }
}

function atomicWrite(targetPath, content) {
  withLock(targetPath, () => {
    const tmpPath = `${targetPath}.tmp-${process.pid}`;
    writeFileSync(tmpPath, content);
    renameSync(tmpPath, targetPath);
  });
}

function transcriptWindow(jsonl) {
  let since;
  let until;
  for (const line of jsonl.split("\n")) {
    if (!line.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const ts = entry?.timestamp;
    if (typeof ts !== "string" || Number.isNaN(Date.parse(ts))) continue;
    if (since === undefined) since = ts;
    until = ts;
  }
  return { since, until };
}

function flushStampAgeMs() {
  try {
    const ms = Date.parse(readFileSync(KB_STAMP_PATH, "utf8").trim());
    return Number.isNaN(ms) ? Infinity : Date.now() - ms;
  } catch {
    return Infinity;
  }
}

function writeFlushStamp() {
  mkdirSync(dirname(KB_STAMP_PATH), { recursive: true });
  writeFileSync(KB_STAMP_PATH, new Date().toISOString());
}

function flushKnowledgeBase(git, immediate) {
  if (!immediate && flushStampAgeMs() < KB_FLUSH_THROTTLE_MS) return;

  if (!existsSync(KB_DIR)) throw new Error(`no Knowledge-Base checkout at ${KB_DIR}`);

  for (let attempt = 1; attempt <= 2; attempt++) {
    fetchAndReset();
    git(["-C", KB_DIR, "add", "-A"]);
    const status = git(["-C", KB_DIR, "status", "--porcelain"]).trim();
    if (!status) return;
    const count = status.split("\n").length;
    git(["-C", KB_DIR, "commit", "-q", "-m", `flush: ${count} session capture${count === 1 ? "" : "s"}`]);
    if (tryPush()) {
      writeFlushStamp();
      log(`flushed ${count}`);
      return;
    }
  }

  throw new Error(`push to "${KB_FLUSH_REMOTE_REF}" on "origin" rejected twice in a row`);

  function fetchAndReset() {
    const remoteRef = git(["-C", KB_DIR, "ls-remote", "origin", KB_FLUSH_REMOTE_REF]);
    if (!remoteRef.trim()) return;
    git(["-C", KB_DIR, "fetch", "origin", `+${KB_FLUSH_REMOTE_REF}:refs/remotes/origin/main`]);
    git(["-C", KB_DIR, "reset", "--mixed", "refs/remotes/origin/main"]);
  }

  function tryPush() {
    try {
      git(["-C", KB_DIR, "push", "origin", `HEAD:${KB_FLUSH_REMOTE_REF}`]);
      return true;
    } catch (err) {
      if (reason(err).includes("[rejected]")) return false;
      throw err;
    }
  }
}

function dispatchAudit(repoDir, head) {
  const origin = execGit(["-C", repoDir, "remote", "get-url", "origin"]).trim();
  const ownerRepo = ownerAndRepoFromOrigin(origin);
  if (!ownerRepo) throw new Error(`cannot parse owner/repo from origin: ${origin}`);
  execGh([
    "api",
    `repos/${ownerRepo.owner}/${ownerRepo.repo}/dispatches`,
    "-f",
    `event_type=${DISPATCH_EVENT_TYPE}`,
    "-f",
    `client_payload[head]=${head}`,
  ]);
}

function publishSessionRecord({ sessionId, sessionCwd, jsonl, corpusPath, parsed }) {
  if (!sessionIsInThisRepo({ git: execGit, sessionCwd, repoDir: REPO_DIR })) {
    log("skipped publish-out-of-scope");
    return;
  }

  const { since, until } = transcriptWindow(jsonl);
  if (!since || !until) {
    log("skipped publish-no-window");
    return;
  }

  let range;
  try {
    range = deriveRange({ git: execGit, repoDir: REPO_DIR, since, until });
  } catch (err) {
    log(`skipped publish-range-failed: ${reason(err)}`);
    return;
  }
  if (!range) {
    log("skipped publish-no-range");
    return;
  }

  const root = worktreeRoot(execGit, sessionCwd);
  const touchedPaths = root ? toRepoRelative([...parsed.filesEdited, ...parsed.filesWritten], root) : [];
  const record = { sessionId, base: range.base, head: range.head, touchedPaths, corpusPath };

  try {
    syncNotesRef({
      git: execGit,
      repoDir: REPO_DIR,
      ref: "sessions",
      apply: () => writeSessionRecord({ git: execGit, repoDir: REPO_DIR, record }),
    });
  } catch (err) {
    log(`skipped publish-push-failed: ${reason(err)}`);
    return;
  }

  try {
    dispatchAudit(REPO_DIR, range.head);
  } catch (err) {
    log(`skipped publish-dispatch-failed: ${reason(err)}`);
    return;
  }

  log(`published ${sessionId} ${range.head}`);
}

function main() {
  const [, , transcriptPath, sessionIdArg, projectArg, sourceArg] = process.argv;
  const sessionId = sessionIdArg || "unknown";
  const sessionCwd = projectArg || "unknown";

  if (!transcriptPath) {
    log("skipped no-transcript-path");
    return;
  }

  let jsonl;
  try {
    jsonl = readFileSync(transcriptPath, "utf8");
  } catch (err) {
    log(`skipped transcript-unreadable: ${reason(err)}`);
    return;
  }

  let parsed;
  let markdown;
  try {
    parsed = parseTranscript(jsonl);
    markdown = buildCaptureMarkdown(
      { sessionId, project: sessionCwd, date: new Date().toISOString(), source: sourceArg || "other" },
      parsed,
    );
  } catch (err) {
    log(`skipped extraction-failed: ${reason(err)}`);
    return;
  }

  const datePrefix = new Date().toISOString().slice(0, 10);
  const filename = `${datePrefix}-${sessionId.slice(0, 8)}.md`;
  const outPath = join(OUTPUT_DIR, filename);

  try {
    mkdirSync(OUTPUT_DIR, { recursive: true });
    atomicWrite(outPath, markdown);
  } catch (err) {
    log(`skipped write-failed: ${reason(err)}`);
    return;
  }

  log(`captured ${sessionId}`);

  try {
    flushKnowledgeBase(execGit, sessionIsInThisRepo({ git: execGit, sessionCwd, repoDir: REPO_DIR }));
  } catch (err) {
    log(`skipped push-${reason(err)}`);
  }

  try {
    publishSessionRecord({ sessionId, sessionCwd, jsonl, corpusPath: join(CORPUS_SUBDIR, filename), parsed });
  } catch (err) {
    log(`skipped publish-failed: ${reason(err)}`);
  }
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    main();
  } catch (err) {
    log(`skipped unexpected: ${reason(err)}`);
  }
}
