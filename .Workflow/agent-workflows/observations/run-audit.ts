import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { execGh, type GhExec } from "../shared/gh";
import { execGit, type GitExec } from "../shared/git";
import { reason } from "../shared/reason";
import { syncNotesRef } from "../shared/notes-sync";
import { execClaudeIn, type StageExec } from "../shared/stage";
import { repoScoped } from "../shared/repo-scoped";
import { dispatchRatificationDue } from "../shared/ratification-dispatch";
import { computeRatificationScope } from "../shared/ratification-scope";
import { readRatifierBase } from "../shared/ratifier-base";
import { writeObservationNote } from "../shared/notes";
import { runObservations } from "./run-observations";
import { readSessionRecord, type HydratedSessionRecord } from "./session-notes";

export const AUDIT_DISPATCH_ACTION = "session-captured";

export const KNOWLEDGE_BASE_CHECKOUT_DIR = "knowledge-base";

export interface RunAuditOptions {
  git: GitExec;
  gh: GhExec;
  exec: StageExec;
  repoDir: string;
  head: string;
  standards: string;
  eventAction: string | null | undefined;
  remote?: string;
  log?: (line: string) => void;
}

export type AuditAction = "skipped" | "ran";

export interface AuditOutcome {
  action: AuditAction;
  code: string;
  releasedCount: number;
  ratificationDue: boolean;
}

function fetchNotesRef(git: GitExec, repoDir: string, ref: string, remote: string): void {
  const remoteRef = git(["-C", repoDir, "ls-remote", remote, `refs/notes/${ref}`]);
  if (!remoteRef.trim()) return;
  git(["-C", repoDir, "fetch", remote, `+refs/notes/${ref}:refs/notes/${ref}`]);
}

export async function runAudit(options: RunAuditOptions): Promise<AuditOutcome> {
  const { git, gh, exec, repoDir, head, standards, eventAction } = options;
  const remote = options.remote ?? "origin";
  const log = options.log ?? ((line: string) => console.log(line));

  if (eventAction !== AUDIT_DISPATCH_ACTION) {
    return { action: "skipped", code: "not-an-audit-dispatch", releasedCount: 0, ratificationDue: false };
  }

  fetchNotesRef(git, repoDir, "sessions", remote);
  fetchNotesRef(git, repoDir, "observations", remote);

  const corpusDir = join(repoDir, KNOWLEDGE_BASE_CHECKOUT_DIR);
  let record: HydratedSessionRecord | undefined;
  try {
    record = readSessionRecord({ git, repoDir, head, corpusDir });
  } catch (err) {
    log(`skipped: session record at ${head} has no readable corpus: ${reason(err)}`);
    return { action: "skipped", code: "corpus-missing", releasedCount: 0, ratificationDue: false };
  }
  if (!record) {
    log(`skipped: no session record at ${head}`);
    return { action: "skipped", code: "no-session-record", releasedCount: 0, ratificationDue: false };
  }
  if (record.base === record.head) {
    log(`skipped: session ${record.sessionId}'s range is empty at ${head}`);
    return { action: "skipped", code: "empty-range", releasedCount: 0, ratificationDue: false };
  }

  const touchedPaths = repoScoped(record.touchedPaths);
  if (touchedPaths.length !== record.touchedPaths.length) {
    const dropped = record.touchedPaths.length - touchedPaths.length;
    log(`note: dropped ${dropped} unusable path(s) from session ${record.sessionId}'s record`);
  }

  const observations = await runObservations({
    git,
    exec,
    repoDir,
    base: record.base,
    head: record.head,
    touchedPaths,
    spine: record.spine,
    standards,
  });

  syncNotesRef({
    git,
    repoDir,
    ref: "observations",
    remote,
    apply: () => writeObservationNote({ git, repoDir, commit: record.head, observations }),
  });

  const scope = computeRatificationScope({
    git,
    repoDir,
    base: readRatifierBase(git, repoDir),
    head: record.head,
    prdClosed: false,
  });

  if (scope.shouldRatify) dispatchRatificationDue(gh, { head: record.head, prdClosed: false });

  log(`audited: released ${scope.releasedCount}${scope.shouldRatify ? " (ratification is due)" : ""}`);
  return {
    action: "ran",
    code: "audited",
    releasedCount: scope.releasedCount,
    ratificationDue: scope.shouldRatify,
  };
}

async function main(): Promise<void> {
  try {
    const head = process.env.HEAD_SHA;
    if (!head) {
      throw new Error("HEAD_SHA must be set");
    }
    const repoDir = process.env.TARGET_WORKSPACE || process.env.GITHUB_WORKSPACE || process.cwd();
    const standards = readFileSync(join(repoDir, "CODING_STANDARDS.md"), "utf8");

    const outcome = await runAudit({
      git: execGit,
      gh: execGh,
      exec: execClaudeIn(repoDir),
      repoDir,
      head,
      standards,
      eventAction: process.env.EVENT_ACTION,
    });
    console.log(`${outcome.action} (${outcome.code}): released ${outcome.releasedCount}`);
  } catch (err) {
    console.error(`run-audit failed: ${reason(err)}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
