#!/usr/bin/env node
/**
 * session-capture-hook.mjs — SessionEnd capture hook core (#44; part of #36). Invoked by
 * session-capture.sh as a fully detached, disowned child (stdio on /dev/null) — everything past
 * the handoff runs here, long after SessionEnd has already returned, so the run log
 * (`SESSION_CAPTURE_LOG_PATH`) is the only channel this has (mirrors Lumaria's #556: a missing
 * `node`, an empty transcript path and a healthy quiet session must never produce the same
 * evidence — an empty output).
 *
 * Argv: `<transcriptPath> <sessionId> <project> <source>` — session-capture.sh has already
 * confirmed `transcriptPath` is non-empty and exists before spawning this. `project` is
 * session-capture.sh's own name for the hook payload's `cwd` field (see that script's own
 * `PARSED` line) — it is reused below, unrenamed, as the session's own working directory for the
 * publish step's scope check.
 *
 * Storage: `${SESSION_CAPTURE_OUTPUT_DIR}/<YYYY-MM-DD>-<sessionId[:8]>.md`, atomically written —
 * a lockfile (exclusive create, the same primitive Lumaria's decision-capture-core.mjs uses),
 * then a tmp file next to the target, then `rename` into place. The lock's job here is narrower
 * than appendInboxEntry's: this hook never appends, it only ever creates one file per session, so
 * there is no read-decide-write race to serialize — the lock exists so two sessions that could
 * somehow race the exact same output path (a resumed/duplicated session id) don't interleave
 * their writes, and `rename` is what makes the write itself atomic regardless.
 *
 * Failure mode: FAIL OPEN throughout. Every step below is wrapped so a missing/unreadable
 * transcript, a broken extraction, or an unwritable output directory all degrade to "log a
 * `skipped <reason>` line and do nothing" — never a thrown error, since nothing is listening for
 * one (this process's stdio is /dev/null and nobody awaits it).
 *
 * A second step (spec #134 §Solution 6) also runs after the corpus write, unconditionally
 * attempted but never a condition of anything before or after it: commit and push the
 * Knowledge-Base checkout that write just landed under (`flushKnowledgeBase`), so a captured
 * session survives past this workstation instead of sitting uncommitted until someone happens to
 * push it by hand. Immediate when the session ran in this repo — the audit dispatched below reads
 * that same checkout — and otherwise throttled to once a day via a stamp file. As fail-open as
 * everything around it: every failure degrades to its own `skipped push-<reason>` log line.
 *
 * A third step (spec #63 §Solution 1–2) runs after that, unconditionally attempted but never a
 * condition of it either: derive the session's own commit range, write a `SessionRecord` git note
 * on `refs/notes/sessions`, push it, then fire the `repository_dispatch` that starts the audit. It
 * runs only when the session's own `cwd` resolves to this repo's own `origin` remote
 * (`repo-scope.ts`'s `sessionIsInThisRepo` — ADR-0018's split enforced in code) and is exactly as
 * fail-open as the corpus write above it: every one of its steps degrades to its own
 * `skipped publish-*` log line rather than a thrown error. See `repo-scope.ts` and `range.ts` for
 * why "no derivable range" means "publish nothing" here rather than a fallback.
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
// Where the corpus file lands *within the Knowledge-Base checkout*, independent of `OUTPUT_DIR`
// above (which a test freely repoints at a throwaway directory). `SessionRecord.corpusPath`
// (session-record-schema.ts) is a reader-relative path — `<corpusDir>/<record.corpusPath>` — so it
// must always name this fixed convention, never wherever this run's `OUTPUT_DIR` happens to be.
const CORPUS_SUBDIR = join("raw", "sessions");
const LOG_PATH = process.env.SESSION_CAPTURE_LOG_PATH || join(homedir(), ".claude", "session-capture.log");
// This pipeline's own checkout — what the publish step reads and writes. Defaults to the repo
// this module itself lives in (three levels up from `.claude/hooks/`), the same computation
// session-capture.sh's own `repo_root` makes; overridable so a test can point the publish step at
// a throwaway fixture repo instead of ever touching this real checkout's own `origin`.
const REPO_DIR = process.env.SESSION_CAPTURE_REPO_DIR || join(dirname(fileURLToPath(import.meta.url)), "..", "..");
// The Knowledge-Base checkout `flushKnowledgeBase` commits and pushes after every corpus write —
// a different repository on the workstation than `REPO_DIR` (this pipeline's own checkout) or
// `OUTPUT_DIR` (which a test freely repoints inside some other throwaway tree). Defaults to the
// same root `OUTPUT_DIR`'s own default sits under, since in production `OUTPUT_DIR` *is*
// `<KB_DIR>/raw/sessions`; overridable independently so a test can flush a disposable git repo
// without ever touching the real one (spec #134 §Solution 6, "Knowledge-Base pushes itself").
const KB_DIR = process.env.SESSION_CAPTURE_KB_DIR || join(homedir(), "Claude Projects", "Knowledge-Base");
// Where the timestamp of the last successful flush lives — the throttle `flushKnowledgeBase`
// checks for every session that did not run in this repo (see its own header). Shared globally
// across every repo's sessions on this workstation, deliberately: the question the throttle asks
// is "how long since the Knowledge-Base checkout was last pushed", not "how long since this
// particular project's sessions last flushed it".
const KB_STAMP_PATH = process.env.SESSION_CAPTURE_KB_STAMP_PATH || join(homedir(), ".claude", "kb-flush-stamp");
// How stale `KB_STAMP_PATH` must be before a session that did not run in this repo is allowed to
// push again.
const KB_FLUSH_THROTTLE_MS = 24 * 60 * 60 * 1000;
// The remote ref every Knowledge-Base checkout is flushed onto. Hardcoded rather than read off
// `KB_DIR`'s own checked-out branch name (unlike `REPO_DIR`, which this hook never assumes a
// branch name for) because an empty fixture repo's checked-out branch name follows the *test
// runner's* `init.defaultBranch`, not this pipeline's — every fixture and the real checkout alike
// push to `main`, the same name `session-capture.test.ts`'s own `commitAndPush` already hardcodes.
// The push itself sources from `HEAD` rather than `refs/heads/main`, so this holds regardless of
// what the local branch happens to be named.
const KB_FLUSH_REMOTE_REF = "refs/heads/main";
// The `repository_dispatch` event type this fires. This is the name on the wire, and it is the
// one every consumer scopes on: `audit.yml`/`run-audit.ts` and `close-gate-reconcile.yml`/
// `reconcile.ts` each carry their own copy of the string, because no compiler sees from here into
// a workflow's `if`. `dispatch-action.test.ts` reads this line and asserts all four agree with it
// — the guard #107 was missing, when the audit side spent 14 runs waiting on a name nothing sent.
// Consumers move to this spelling; this one does not move to theirs.
const DISPATCH_EVENT_TYPE = "session-captured";

// A lock older than this is presumed abandoned (its holder crashed) rather than held — the same
// threshold and reasoning as Lumaria's decision-capture-core.mjs `withLock`.
const LOCK_STALE_MS = 30_000;
const LOCK_TIMEOUT_MS = 10_000;
const LOCK_POLL_MS = 25;

/** Same one-line-per-run shape as session-capture.sh's `log_outcome` — see that file's header. */
function log(outcome) {
  try {
    mkdirSync(dirname(LOG_PATH), { recursive: true });
    const ts = new Date().toISOString().replace(/\.\d+Z$/, "Z");
    appendFileSync(LOG_PATH, `${ts}\t${outcome}\n`);
  } catch {
    // Observability only — never let a log-write failure change what this hook does.
  }
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Exclusive-create lockfile beside `path`, held for the duration of `fn`. Throws on failure. */
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
        // Lost the race to reclaim it, or it's already gone — loop around and retry the acquire.
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
      // Already gone — nothing left to release.
    }
  }
}

/** tmp file + lock + rename — see the module header for why the lock is narrow here. */
function atomicWrite(targetPath, content) {
  withLock(targetPath, () => {
    const tmpPath = `${targetPath}.tmp-${process.pid}`;
    writeFileSync(tmpPath, content);
    renameSync(tmpPath, targetPath);
  });
}

/**
 * The transcript's own `[since, until]` window `deriveRange` wants: the first and last valid
 * `timestamp` field found across the transcript's lines, in transcript order — the same field
 * `backfill.ts`'s `lastTimestamp` reads, kept here rather than imported since that helper only
 * ever needed the last one. A line that fails to parse, or carries no usable timestamp, is
 * skipped rather than treated as a defect, matching `parseTranscript`'s own tolerance.
 */
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

/**
 * Milliseconds since `KB_STAMP_PATH` was last rewritten by `writeFlushStamp` as an ISO timestamp —
 * `Infinity` when the file is missing, unreadable, or holds something `Date.parse` can't use, so a
 * first-ever run (or a corrupted stamp) always reads as "due".
 */
function flushStampAgeMs() {
  try {
    const ms = Date.parse(readFileSync(KB_STAMP_PATH, "utf8").trim());
    return Number.isNaN(ms) ? Infinity : Date.now() - ms;
  } catch {
    return Infinity;
  }
}

/** Rewrites `KB_STAMP_PATH` to now — called only after `flushKnowledgeBase` actually pushes. */
function writeFlushStamp() {
  mkdirSync(dirname(KB_STAMP_PATH), { recursive: true });
  writeFileSync(KB_STAMP_PATH, new Date().toISOString());
}

/**
 * Commits and pushes whatever the corpus write above just landed on disk under `KB_DIR` — until
 * this runs, a captured session lives only on this workstation (spec #134 §Solution 6:
 * "Knowledge-Base pushes itself"). `immediate` is the same `sessionIsInThisRepo` fact the publish
 * half below gates on: a session worked in *this* repo flushes unconditionally and before
 * `dispatchAudit` ever fires (`main`'s own call order enforces that, not this function), because
 * the audit `publishSessionRecord` is about to dispatch reads the very checkout being flushed
 * here. Every other session flushes too, just throttled to once a day via `KB_STAMP_PATH` — a
 * session ends far more often than an audit needs a fresh corpus, and pushing on every single one
 * across every project on the machine would be needless churn for a corpus nothing is about to
 * read.
 *
 * The git plumbing mirrors `syncNotesRef`'s fetch/apply/push-with-retry shape
 * (`.Workflow/agent-workflows/shared/notes-sync.ts`): fetch, apply, push; on a non-fast-forward
 * rejection, do it again exactly once before throwing. It cannot reuse that function outright —
 * its `apply` always *overwrites* one notes ref wholesale, where a flush *adds* working-tree files
 * on top of whatever base commit fetch just resolved to. So "apply" here is `reset --mixed` onto
 * the freshly fetched tip (folding the previous, now-orphaned local commit's changes back into the
 * working tree, unstaged, exactly what a retry needs to rebuild against the latest known remote
 * state) followed by `add -A` and a fresh commit.
 *
 * Logs its own `flushed <count>` line on a successful push. Every failure — no checkout at
 * `KB_DIR`, no `git` on `PATH`, an unreachable `origin`, a push rejected twice in a row — is left
 * for the caller to turn into its own `skipped push-<reason>` line (module header): this only ever
 * throws on failure, and returns quietly (no log line) when there is nothing due to flush or
 * nothing pending to commit.
 */
function flushKnowledgeBase(git, immediate) {
  if (!immediate && flushStampAgeMs() < KB_FLUSH_THROTTLE_MS) return;

  if (!existsSync(KB_DIR)) throw new Error(`no Knowledge-Base checkout at ${KB_DIR}`);

  for (let attempt = 1; attempt <= 2; attempt++) {
    fetchAndReset();
    git(["-C", KB_DIR, "add", "-A"]);
    const status = git(["-C", KB_DIR, "status", "--porcelain"]).trim();
    if (!status) return; // Nothing pending — not a failure, just nothing this run needs to do.
    const count = status.split("\n").length;
    git(["-C", KB_DIR, "commit", "-q", "-m", `flush: ${count} session capture${count === 1 ? "" : "s"}`]);
    if (tryPush()) {
      writeFlushStamp();
      log(`flushed ${count}`);
      return;
    }
  }

  throw new Error(`push to "${KB_FLUSH_REMOTE_REF}" on "origin" rejected twice in a row`);

  /** Brings `KB_DIR` up to `origin`'s current tip — see the function header on why `reset --mixed`. */
  function fetchAndReset() {
    const remoteRef = git(["-C", KB_DIR, "ls-remote", "origin", KB_FLUSH_REMOTE_REF]);
    if (!remoteRef.trim()) return; // First-ever flush — origin has no such ref yet to fetch.
    git(["-C", KB_DIR, "fetch", "origin", `+${KB_FLUSH_REMOTE_REF}:refs/remotes/origin/main`]);
    git(["-C", KB_DIR, "reset", "--mixed", "refs/remotes/origin/main"]);
  }

  /** Sources from `HEAD` rather than a local branch name — see `KB_FLUSH_REMOTE_REF`'s own note. */
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

/**
 * Fires the `repository_dispatch` that starts the audit — the connector (spec #63 §Solution 2).
 * Carries no payload beyond `head`; everything else the audit needs is already in the note this
 * is called after pushing. Resolves `repos/{owner}/{repo}` itself from `repoDir`'s own `origin`
 * rather than leaning on `gh`'s cwd-resolved `{owner}/{repo}` placeholder (`GhExec`'s own note):
 * this process's actual OS cwd is whatever launched session-capture.sh, not reliably `repoDir`.
 */
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

/**
 * The hook's second half (module header, spec #63 §Solution 1–2): derive the session's own range,
 * publish its `SessionRecord`, dispatch the audit. Every step is its own `skipped publish-*` log
 * line on failure — see the module header for why this is a *different* failure posture from the
 * corpus write above it, never a thrown error either way.
 */
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

  // The transcript reports absolute workstation paths, and freely includes files outside the repo
  // (`~/.claude/settings.json`, a scratchpad under `/tmp`). This record is read on a runner whose
  // checkout is somewhere else entirely, where such a path is not just wrong but fatal to the
  // `git diff` it becomes — see `touched-paths.ts`. Relativised against the session's own worktree,
  // which is not necessarily `REPO_DIR`; when git can't name that root, the paths are dropped
  // rather than published unusable, and the lenses read the unrestricted range diff.
  const root = worktreeRoot(execGit, sessionCwd);
  const touchedPaths = root ? toRepoRelative([...parsed.filesEdited, ...parsed.filesWritten], root) : [];
  // The spine itself never rides this note (spec #134) — `corpusPath` is the pointer a reader
  // hydrates it back from, joined against its own Knowledge-Base checkout (session-notes.ts).
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

  // Neither of the two steps below is ever conditional on the corpus write's own success being
  // anything but written — see the module header. The flush runs first and unconditionally
  // (`sessionIsInThisRepo` only ever changes *when* it pushes, not *whether* it's attempted), so
  // that when the session ran in this repo it has landed before `publishSessionRecord`'s own
  // `dispatchAudit` call below ever fires — the audit reads the very checkout being flushed here.
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

// Only run as a CLI when invoked directly (`node session-capture-hook.mjs ...`, what
// session-capture.sh does) — importing this module must never trigger a live write as a side
// effect of import. `fileURLToPath` decodes this module's own URL back to a plain path rather
// than the reverse (a hand-built `file://` from argv), which is the direction that survives a
// path containing spaces — see decision-capture.mjs, the same guard this one is copied from.
if (fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    main();
  } catch (err) {
    // Fail open — see module header. Nothing above should throw uncaught, but this is the
    // backstop: a run that dies here still leaves one line of evidence behind.
    log(`skipped unexpected: ${reason(err)}`);
  }
}
