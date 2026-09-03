import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { closeTicketProcess, type CloseTicketResult } from "../shared/close-ticket";
import { execGh, type GhExec } from "../shared/gh";
import { runJobsPath, workflowRunsPath } from "../shared/gh-paths";
import { execGit, type GitExec } from "../shared/git";
import { findJobByName } from "../shared/job-match";
import { escalateToOwner } from "../shared/needs-human";
import { announceGraphChanged, GRAPH_CHANGED_DISPATCH_ACTION } from "../shared/ready-set";
import { reason } from "../shared/reason";
import { runGauntlet } from "../shared/run-gauntlet";

export { GRAPH_CHANGED_DISPATCH_ACTION };

export interface GauntletResult {
  exitCode: 0 | 1 | 2;
}

export type { CloseTicketResult };

export type ClosingOutcome =
  | { closed: true; ticket: number }
  | { closed: false; reason: "refused"; ticket: number }
  | { closed: false; reason: "no-ticket" };

export type IntegrateOutcome =
  | { merged: true; closing: ClosingOutcome }
  | { merged: false; reason: "red" }
  | { merged: false; reason: "no-run" }
  | { merged: false; reason: "immutable-set" }
  | { merged: false; reason: "unjudged" }
  | { merged: false; reason: "gate" }
  | { merged: false; reason: "conflict"; paths: string[] };

export interface IntegrateDeps {
  git: GitExec;
  gh: GhExec;
  pr: string;
  headSha: string;
  runGauntlet: () => GauntletResult;
  assignee?: string;
  closeTicket: (ticket: number, range: string) => CloseTicketResult;
  sleep?: (ms: number) => void;
  verifyWorkflow: string;
}

interface PullRequest {
  branch: string;
  ticket: number | undefined;
}

const CLOSING_REFERENCE_RE = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)/i;

function readPr(gh: GhExec, pr: string): PullRequest {
  const raw = gh(["pr", "view", pr, "--json", "headRefName,body"]);
  const json = JSON.parse(raw) as { headRefName?: string; body?: string };
  const match = CLOSING_REFERENCE_RE.exec(json.body ?? "");
  return {
    branch: (json.headRefName ?? "").trim(),
    ticket: match ? Number(match[1]) : undefined,
  };
}

export type JobVerdict = "passed" | "failed" | "unjudged";

interface VerifyVerdict {
  immutability: JobVerdict;
  acceptance: JobVerdict;
}

export const IMMUTABILITY_JOB = "Immutability";

export const GATE_JOB = "Verify";

const DISPATCH_EVENT = "repository_dispatch";

const VERIFY_RUN_PAGE_SIZE = 100;

const ACCEPTANCE_POLL_ATTEMPTS = 40;
const ACCEPTANCE_POLL_MS = 15_000;

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

const ApiRun = z.object({
  id: z.number(),
  head_sha: z.string(),
  event: z.string(),
  status: z.string(),
});
const ApiJob = z.object({
  id: z.number(),
  name: z.string(),
  status: z.string(),
  conclusion: z.string().nullable(),
});

function jobVerdict(jobs: Array<z.infer<typeof ApiJob>>, name: string): JobVerdict {
  const job = findJobByName(jobs, name);
  if (!job || job.status !== "completed") return "unjudged";
  if (job.conclusion === "success") return "passed";
  if (job.conclusion === "failure") return "failed";
  return "unjudged";
}

const NOT_JUDGED: VerifyVerdict = { immutability: "unjudged", acceptance: "unjudged" };

function readJobs(gh: GhExec, runId: number): Array<z.infer<typeof ApiJob>> {
  return ApiJob.array().parse(
    JSON.parse(gh(["api", runJobsPath(runId), "--jq", "[.jobs[] | {id, name, status, conclusion}]"])),
  );
}

function jobJudged(gh: GhExec, jobId: number, pr: string): boolean {
  try {
    return gh(["run", "view", "--job", String(jobId), "--log"]).includes(`judging ${pr} on `);
  } catch {
    return false;
  }
}

function readVerifyVerdict(gh: GhExec, headSha: string, pr: string, verifyWorkflow: string): VerifyVerdict {
  const runsPath = workflowRunsPath(verifyWorkflow, VERIFY_RUN_PAGE_SIZE);
  const runs = ApiRun.array().parse(
    JSON.parse(gh(["api", runsPath, "--jq", "[.workflow_runs[] | {id, head_sha, event, status}]"])),
  );
  const candidates = runs
    .filter((run) => run.head_sha === headSha && run.event === DISPATCH_EVENT)
    .sort((a, b) => b.id - a.id);
  for (const run of candidates) {
    const jobs = readJobs(gh, run.id);
    const immutability = findJobByName(jobs, IMMUTABILITY_JOB);
    if (immutability === undefined || immutability.status !== "completed") {
      if (run.status !== "completed") return NOT_JUDGED;
      continue;
    }
    if (!jobJudged(gh, immutability.id, pr)) continue;
    return {
      immutability: jobVerdict(jobs, IMMUTABILITY_JOB),
      acceptance: jobVerdict(jobs, GATE_JOB),
    };
  }
  return NOT_JUDGED;
}

function awaitVerifyVerdict(
  gh: GhExec,
  headSha: string,
  pr: string,
  verifyWorkflow: string,
  sleep: (ms: number) => void,
): VerifyVerdict {
  let verdict = readVerifyVerdict(gh, headSha, pr, verifyWorkflow);
  for (let attempt = 0; verdict.acceptance === "unjudged" && attempt < ACCEPTANCE_POLL_ATTEMPTS; attempt++) {
    sleep(ACCEPTANCE_POLL_MS);
    verdict = readVerifyVerdict(gh, headSha, pr, verifyWorkflow);
  }
  return verdict;
}

function noteAcceptanceRefusal(gh: GhExec, pr: string, verdict: JobVerdict): void {
  const body = [
    `Lane 06's \`${GATE_JOB}\` job is **${verdict}** for this head commit, so lane 08 did not merge.`,
    "",
    verdict === "failed"
      ? "`npm run check` is red against this diff — the ticket's own acceptance tests, or another check, do not pass. The ticket is not built."
      : "The job never reached a verdict within the window this lane waits, and an absent verdict is a refusal, never a pass (ADR-0054).",
    "",
    "Re-dispatch the pull request once the cause is dealt with; nothing retries this on its own.",
  ].join("\n");
  try {
    gh(["pr", "comment", pr, "--body", body]);
  } catch (err) {
    console.error(`could not note lane 06's acceptance verdict on ${pr}: ${reason(err)}`);
  }
}

function prCommitRange(git: GitExec): string {
  const base = git(["rev-parse", "origin/main"]).trim();
  const head = git(["rev-parse", "HEAD"]).trim();
  return `${base}..${head}`;
}

type RebaseOutcome = { conflicted: false } | { conflicted: true; paths: string[] };

function conflictingPaths(git: GitExec): string[] {
  return git(["diff", "--name-only", "--diff-filter=U"])
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

function rebaseOntoTrunk(git: GitExec, branch: string): RebaseOutcome {
  git(["fetch", "origin", "main", branch]);
  git(["checkout", branch]);
  try {
    git(["rebase", "origin/main"]);
  } catch (err) {
    const paths = conflictingPaths(git);
    if (paths.length === 0) throw err;
    git(["rebase", "--abort"]);
    return { conflicted: true, paths };
  }
  git(["push", "--force-with-lease", "origin", `HEAD:${branch}`]);
  return { conflicted: false };
}

function blockOnConflict(gh: GhExec, pr: string, paths: string[], ticket: number | undefined, assignee: string | undefined): void {
  const body = [
    "**Blocked — rebase conflict.** Lane 08 could not replay this branch onto current trunk, so it",
    "aborted the rebase and merged nothing. No model ran and nothing here judged the diff.",
    "",
    "Conflicting paths:",
    "",
    ...paths.map((path) => `- \`${path}\``),
    "",
    "Rebase it by hand and re-dispatch the pull request; nothing retries this on its own.",
  ].join("\n");
  if (ticket !== undefined) escalateToOwner(gh, ticket, assignee);
  gh(["pr", "comment", pr, "--body", body]);
}

function mergePr(gh: GhExec, pr: string): void {
  gh(["pr", "merge", pr, "--merge", "--delete-branch"]);
}

const REFUSAL_TAIL = 4000;

function noteRefusal(gh: GhExec, ticket: number, pr: string, result: CloseTicketResult): void {
  const detail = result.output.trim().slice(-REFUSAL_TAIL);
  const body = [
    `Lane 08 merged ${pr} and could not close this ticket: \`bin/close-ticket\` exited ${result.exitCode}, so no \`## Closing record\` was posted and this stays open.`,
    "",
    "The merge stands — a criterion that did not check out does not un-land it. Re-run the same",
    "`bin/close-ticket` invocation once the criterion is satisfied; that is the whole recovery path.",
    "",
    "```",
    detail,
    "```",
  ].join("\n");
  gh(["issue", "comment", String(ticket), "--body", body]);
}

function closeMergedTicket(deps: IntegrateDeps, ticket: number | undefined, range: string): ClosingOutcome {
  if (ticket === undefined) return { closed: false, reason: "no-ticket" };
  try {
    const result = deps.closeTicket(ticket, range);
    if (result.exitCode === 0) return { closed: true, ticket };
    noteRefusal(deps.gh, ticket, deps.pr, result);
  } catch (err) {
    console.error(`could not close #${ticket}: ${reason(err)}`);
  }
  return { closed: false, reason: "refused", ticket };
}

export function runIntegrate(deps: IntegrateDeps): IntegrateOutcome {
  const pullRequest = readPr(deps.gh, deps.pr);
  const rebase = rebaseOntoTrunk(deps.git, pullRequest.branch);
  if (rebase.conflicted) {
    blockOnConflict(deps.gh, deps.pr, rebase.paths, pullRequest.ticket, deps.assignee);
    return { merged: false, reason: "conflict", paths: rebase.paths };
  }
  const range = prCommitRange(deps.git);

  const result = deps.runGauntlet();
  if (result.exitCode === 1) return { merged: false, reason: "red" };
  if (result.exitCode !== 0) return { merged: false, reason: "no-run" };

  const verdict = awaitVerifyVerdict(deps.gh, deps.headSha, deps.pr, deps.verifyWorkflow, deps.sleep ?? sleepSync);
  if (verdict.immutability === "failed") return { merged: false, reason: "immutable-set" };
  if (verdict.immutability !== "passed") return { merged: false, reason: "unjudged" };
  if (verdict.acceptance === "failed") {
    noteAcceptanceRefusal(deps.gh, deps.pr, verdict.acceptance);
    return { merged: false, reason: "gate" };
  }
  if (verdict.acceptance !== "passed") {
    noteAcceptanceRefusal(deps.gh, deps.pr, verdict.acceptance);
    return { merged: false, reason: "unjudged" };
  }

  mergePr(deps.gh, deps.pr);
  const closing = closeMergedTicket(deps, pullRequest.ticket, range);
  announceGraphChanged(deps.gh, deps.pr);
  return { merged: true, closing };
}

export function runRealGauntlet(repoDir: string = process.cwd()): GauntletResult {
  try {
    runGauntlet("push", repoDir);
    return { exitCode: 0 };
  } catch (err) {
    const failure = err as { status?: number | null; stdout?: string; stderr?: string };
    const output = `${failure.stdout ?? ""}${failure.stderr ?? ""}`.trim();
    if (output) console.error(output);
    return { exitCode: failure.status === 1 ? 1 : 2 };
  }
}

export function runRealCloseTicket(ticket: number, range: string, repoDir: string = process.cwd()): CloseTicketResult {
  return closeTicketProcess([String(ticket), range, repoDir]);
}

function describeClosing(closing: ClosingOutcome, pr: string): string {
  if (closing.closed) return `closed #${closing.ticket}`;
  if (closing.reason === "refused") return `#${closing.ticket} stays open: bin/close-ticket refused, noted on the ticket`;
  return `nothing to close: ${pr} names no ticket`;
}

async function main(): Promise<void> {
  const pr = process.argv[2];
  const headSha = process.argv[3];
  if (!pr || !headSha) {
    console.error("usage: integrate.ts <pr> <head-sha>");
    process.exitCode = 1;
    return;
  }

  try {
    const repoDir = process.env.TARGET_WORKSPACE || process.cwd();
    const git: GitExec = (args) => execGit(["-C", repoDir, ...args]);

    const verifyWorkflow = process.env.VERIFY_WORKFLOW;
    if (!verifyWorkflow) {
      throw new Error("VERIFY_WORKFLOW must be set — reading a workflow that does not exist reads as unjudged forever");
    }

    const outcome = runIntegrate({
      git,
      gh: execGh,
      pr,
      headSha,
      runGauntlet: () => runRealGauntlet(repoDir),
      closeTicket: (ticket, range) => runRealCloseTicket(ticket, range, repoDir),
      assignee: process.env.SIGNAL_ASSIGNEE,
      verifyWorkflow,
    });

    if (!outcome.merged) {
      console.error(`not merged (${outcome.reason}): ${pr}`);
      if (outcome.reason !== "conflict") process.exitCode = 1;
      return;
    }
    console.log(`merged ${pr} — ${describeClosing(outcome.closing, pr)}`);
  } catch (err) {
    console.error(`integrate failed: ${reason(err)}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
