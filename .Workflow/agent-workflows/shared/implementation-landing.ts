import { z } from "zod";
import { ADR_DIR, INDEX_RELATIVE_PATH } from "./adr-index";
import { judgeFailsEdits } from "./fails-rule";
import type { GhExec } from "./gh";
import { branchCreationPath, comparePath, GIT_REFS_PATH } from "./gh-paths";
import type { GitExec } from "./git";
import { escalateToOwner } from "./needs-human";
import { reason } from "./reason";
import { extractCriteria, type TicketRead } from "./ticket-shape";
import { dispatchVerify } from "./verify-dispatch";

export const ImplementerAnswer = z.object({
  files: z.array(z.object({ path: z.string().min(1), content: z.string().min(1) })).min(1),
  summary: z.string().min(1),
  outOfBriefReads: z.array(z.string().min(1)).default([]),
});
export type ImplementerAnswer = z.infer<typeof ImplementerAnswer>;
export const CLAIM_TIMEOUT_MINUTES = 45;

function refPath(branch: string): string {
  return `${GIT_REFS_PATH}/heads/${branch}`;
}

function createClaimRef(gh: GhExec, branch: string, sha: string, log: (line: string) => void): boolean {
  try {
    gh(["api", GIT_REFS_PATH, "-f", `ref=refs/heads/${branch}`, "-f", `sha=${sha}`]);
    return true;
  } catch (err) {
    log(`\`${branch}\` was not claimed here: ${reason(err)}`);
    return false;
  }
}

export function releaseDeadClaim(gh: GhExec, branch: string, base: string, log: (line: string) => void): boolean {
  try {
    if (hasPullRequest(gh, branch)) {
      log(`\`${branch}\` has a pull request, so its claim is somebody's finished work; left alone.`);
      return false;
    }
    if (commitsAhead(gh, branch, base) > 0) {
      log(`\`${branch}\` carries commits, so its claim is somebody's unfinished work; left alone.`);
      return false;
    }
  } catch (err) {
    log(`could not inspect \`${branch}\`, so its claim is left alone: ${reason(err)}`);
    return false;
  }
  releaseClaim(gh, branch, log);
  return true;
}

function releaseClaim(gh: GhExec, branch: string, log: (line: string) => void): void {
  try {
    gh(["api", "--method", "DELETE", refPath(branch)]);
    log(`released the claim on \`${branch}\``);
  } catch (err) {
    log(`could not release the claim on \`${branch}\`: ${reason(err)}`);
  }
}

function hasPullRequest(gh: GhExec, branch: string): boolean {
  const raw = gh(["pr", "list", "--head", branch, "--state", "all", "--json", "number"]);
  return (JSON.parse(raw) as unknown[]).length > 0;
}

function commitsAhead(gh: GhExec, branch: string, base: string): number {
  const raw = gh(["api", comparePath(base, branch)]);
  const ahead = (JSON.parse(raw) as { ahead_by?: unknown }).ahead_by;
  return typeof ahead === "number" ? ahead : 1;
}

function claimAgeMinutes(gh: GhExec, branch: string, now: Date): number | undefined {
  const raw = gh(["api", branchCreationPath(branch)]);
  const activity = (JSON.parse(raw) as Array<{ timestamp?: string }>)[0];
  if (!activity?.timestamp) return undefined;
  const created = Date.parse(activity.timestamp);
  if (Number.isNaN(created)) return undefined;
  return (now.getTime() - created) / 60_000;
}

function assessClaim(
  gh: GhExec,
  branch: string,
  base: string,
  now: Date,
  log: (line: string) => void,
): "live" | "stale" {
  try {
    if (hasPullRequest(gh, branch)) return "live";
    if (commitsAhead(gh, branch, base) > 0) return "live";
    const age = claimAgeMinutes(gh, branch, now);
    if (age === undefined) {
      log(`\`${branch}\` has no recorded creation time, so its claim is read as still held.`);
      return "live";
    }
    return age > CLAIM_TIMEOUT_MINUTES ? "stale" : "live";
  } catch (err) {
    log(`could not tell whether \`${branch}\`'s claim is still held, so it is: ${reason(err)}`);
    return "live";
  }
}

export interface ClaimOutcome {
  claimed: boolean;
  tookOverStaleClaim: boolean;
}

export function claimImplementationBranch(
  gh: GhExec,
  git: GitExec,
  branch: string,
  log: (line: string) => void = (line) => console.log(line),
  now: Date = new Date(),
): ClaimOutcome {
  const sha = git(["rev-parse", "HEAD"]).trim();
  if (createClaimRef(gh, branch, sha, log)) return { claimed: true, tookOverStaleClaim: false };

  if (assessClaim(gh, branch, sha, now, log) === "live") return { claimed: false, tookOverStaleClaim: false };

  log(`\`${branch}\` is a claim no run is holding; taking it over.`);
  releaseClaim(gh, branch, log);
  if (!createClaimRef(gh, branch, sha, log)) return { claimed: false, tookOverStaleClaim: false };
  return { claimed: true, tookOverStaleClaim: true };
}

const TRUNK_REMOTE = "origin";
const TRUNK_BRANCH = "main";

export class RebaseConflictError extends Error {
  constructor(public readonly paths: string[]) {
    super(`conflicted rebasing onto ${TRUNK_REMOTE}/${TRUNK_BRANCH}: ${paths.join(", ")}`);
    this.name = "RebaseConflictError";
  }
}

function rebaseOntoTrunk(git: GitExec): void {
  git(["fetch", TRUNK_REMOTE, TRUNK_BRANCH]);
  try {
    git(["rebase", `${TRUNK_REMOTE}/${TRUNK_BRANCH}`]);
  } catch (err) {
    const paths = git(["diff", "--name-only", "--diff-filter=U"])
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "");
    git(["rebase", "--abort"]);
    throw new RebaseConflictError(paths.length > 0 ? paths : [reason(err)]);
  }
}

function commitAndPushBranch(git: GitExec, branch: string, paths: string[], commitMessage: string, rebaseFirst: boolean): void {
  git(["checkout", "-b", branch]);
  git(["add", ...paths]);
  git(["commit", "-m", commitMessage]);
  if (rebaseFirst) rebaseOntoTrunk(git);
  git(["push", "origin", `HEAD:${branch}`]);
}

export function worktreeChanges(git: GitExec, paths: string[]): string[] {
  if (paths.length === 0) return [];
  return git(["status", "--porcelain", "--", ...paths])
    .split("\n")
    .filter((line) => line.trim() !== "");
}

export function sayOnTicket(gh: GhExec, issueNumber: number, body: string, log: (line: string) => void): void {
  try {
    gh(["issue", "comment", String(issueNumber), "--body", body]);
  } catch (err) {
    log(`could not say this on #${issueNumber} (${reason(err)}): ${body}`);
  }
}

export function staleClaimTakeoverNote(branch: string): string {
  return [
    `Took over a stale claim on \`${branch}\`.`,
    "",
    `The branch was already there when this run started, with no pull request, no commits, and older`,
    `than this lane's own ${CLAIM_TIMEOUT_MINUTES}-minute timeout, so a claim left behind by a run that`,
    "died rather than one a run is still holding. This run took it over and is building the ticket now.",
  ].join("\n");
}

export function rebaseConflictNote(paths: string[]): string {
  return [
    `Could not rebase this run's branch onto trunk before pushing; conflicted in: ${paths.join(", ")}.`,
    "",
    "This is escalated rather than resolved automatically, the same reason `fixer.yml`'s own rebase",
    "step stops instead of guessing at a merge. The claim has been released; whoever resolves the",
    "conflict by hand can re-dispatch this ticket afterwards.",
  ].join("\n");
}

export function failsRuleNote(reason: string): string {
  return [
    "Refused to push this run's answer: it changed an acceptance test it is judged by.",
    "",
    reason,
    "",
    "An implementer may turn a `test.fails(` test on by deleting `.fails` from that line, and may",
    "not otherwise touch it. Nothing was committed. The claim has been released; whoever reads the",
    "answer can re-dispatch this ticket afterwards.",
  ].join("\n");
}

export function nothingToBuildNote(issueNumber: number): string {
  return [
    `Found nothing to build for #${issueNumber}.`,
    "",
    "The implementer returned this ticket's files exactly as they already are on trunk, so there was",
    "no commit to make and no pull request to open. That is an outcome, not a failure: the ticket may",
    "already be true. The claim has been released, so a later dispatch is free to try again.",
  ].join("\n");
}

export interface PrDispatch {
  branch: string;
  title: string;
  body: string;
  changedFiles: string[];
  criteria: string[];
}

export function openPrAndDispatch(gh: GhExec, dispatch: PrDispatch): string {
  const prUrl = gh([
    "pr",
    "create",
    "--title",
    dispatch.title,
    "--body",
    dispatch.body,
    "--head",
    dispatch.branch,
  ]).trim();

  dispatchVerify(gh, { prUrl, changedFiles: dispatch.changedFiles, criteria: dispatch.criteria });
  return prUrl;
}
export type ImplementOutcome =
  | { outcome: "opened"; pr: string }
  | { outcome: "already-claimed" }
  | { outcome: "nothing-to-build" }
  | { outcome: "ticket-closed" }
  | { outcome: "rebase-conflict"; paths: string[] }
  | { outcome: "fails-rule-refused"; reason: string };

export function releaseFailedClaim(gh: GhExec, branch: string, log: (line: string) => void): void {
  try {
    if (hasPullRequest(gh, branch)) {
      log(`\`${branch}\` already carries a pull request; leaving its claim in place.`);
      return;
    }
  } catch (err) {
    log(`could not tell whether \`${branch}\` carries a pull request, so its claim stands: ${reason(err)}`);
    return;
  }
  releaseClaim(gh, branch, log);
}
export interface LandDeps {
  gh: GhExec;
  git: GitExec;
  writeFile: (path: string, content: string) => void;
  regenerateIndex: () => boolean;
}

export async function landAnswer(
  deps: LandDeps,
  branch: string,
  issueNumber: number,
  ticket: TicketRead,
  answer: ImplementerAnswer,
  commitMessage: string,
  log: (line: string) => void,
  options: { rebaseOntoTrunk?: boolean } = {},
): Promise<ImplementOutcome> {
  for (const file of answer.files) {
    deps.writeFile(file.path, file.content);
  }

  const changing = worktreeChanges(deps.git, answer.files.map((file) => file.path));

  if (changing.length === 0) {
    releaseClaim(deps.gh, branch, log);
    sayOnTicket(deps.gh, issueNumber, nothingToBuildNote(issueNumber), log);
    return { outcome: "nothing-to-build" };
  }

  const paths = answer.files.map((file) => file.path);
  if (paths.some((path) => path.startsWith(`${ADR_DIR}/`)) && deps.regenerateIndex()) {
    paths.push(INDEX_RELATIVE_PATH);
  }

  const verdict = judgeFailsEdits(deps.git(["diff", "--", ...paths]));
  if (!verdict.ok) {
    releaseClaim(deps.gh, branch, log);
    escalateToOwner(deps.gh, issueNumber, process.env.GITHUB_REPOSITORY_OWNER);
    sayOnTicket(deps.gh, issueNumber, failsRuleNote(verdict.reason), log);
    return { outcome: "fails-rule-refused", reason: verdict.reason };
  }

  try {
    commitAndPushBranch(deps.git, branch, paths, commitMessage, options.rebaseOntoTrunk ?? false);
  } catch (err) {
    if (!(err instanceof RebaseConflictError)) throw err;
    releaseClaim(deps.gh, branch, log);
    escalateToOwner(deps.gh, issueNumber, process.env.GITHUB_REPOSITORY_OWNER);
    sayOnTicket(deps.gh, issueNumber, rebaseConflictNote(err.paths), log);
    return { outcome: "rebase-conflict", paths: err.paths };
  }

  const pr = openPrAndDispatch(deps.gh, {
    branch,
    title: ticket.title,
    body: `${answer.summary}\n\nCloses #${issueNumber}`,
    changedFiles: paths,
    criteria: extractCriteria(ticket.body),
  });
  return { outcome: "opened", pr };
}