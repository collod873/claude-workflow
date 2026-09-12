import { z } from "zod";
import { ADR_DIR, INDEX_RELATIVE_PATH } from "./adr-index";
import { changedPaths } from "./changed-paths";
import { judgeFailsEdits } from "./fails-rule";
import type { GhExec } from "./gh";
import type { GitExec } from "./git";
import { CLAIM_TIMEOUT_MINUTES, releaseClaim } from "./claim";
export { CLAIM_TIMEOUT_MINUTES, claimImplementationBranch, releaseDeadClaim, releaseFailedClaim } from "./claim";
import { touchesImmutableSet } from "./immutable-set";
import { escalateToOwner } from "./needs-human";
import { dispatchMechanicWanted } from "./ready-set";
import { reason } from "./reason";
import { gateOutputTail, type GateVerdict } from "./run-gauntlet";
import { extractCriteria, type TicketRead } from "./ticket-shape";
import { dispatchVerify } from "./verify-dispatch";

const DeclaredEdit = z.object({ path: z.string().min(1), reason: z.string().min(1) });
export type DeclaredEdit = z.infer<typeof DeclaredEdit>;

export const ImplementerReply = z.object({
  summary: z.string().min(1),
  outOfBriefReads: z.array(z.string().min(1)).default([]),
  declaredEdits: z.array(DeclaredEdit).default([]),
});
export type ImplementerReply = z.infer<typeof ImplementerReply>;

export const ImplementerAnswer = z.object({
  files: z.array(z.object({ path: z.string().min(1), content: z.string() })),
  deleted: z.array(z.string().min(1)).default([]),
  summary: z.string().min(1),
  outOfBriefReads: z.array(z.string().min(1)).default([]),
  declaredEdits: z.array(DeclaredEdit).default([]),
});
export type ImplementerAnswer = z.infer<typeof ImplementerAnswer>;

export function deriveAnswer(
  git: GitExec,
  readFile: (path: string) => string,
  fileExists: (path: string) => boolean,
  reply: ImplementerReply,
): ImplementerAnswer {
  const files: { path: string; content: string }[] = [];
  const deleted: string[] = [];

  for (const path of [...changedPaths(git)].sort()) {
    if (fileExists(path)) {
      files.push({ path, content: readFile(path) });
    } else {
      deleted.push(path);
    }
  }

  return {
    files,
    deleted,
    summary: reply.summary,
    outOfBriefReads: reply.outOfBriefReads,
    declaredEdits: reply.declaredEdits,
  };
}

export function declaredEditsNote(edits: DeclaredEdit[]): string {
  return ["## Edits outside the ticket's fence", ...edits.map((edit) => `- ${edit.path}: ${edit.reason}`)].join("\n");
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

function commitPushAndDiff(
  git: GitExec,
  branch: string,
  paths: string[],
  commitMessage: string,
  rebaseFirst: boolean,
  skipPushHook: boolean,
): string {
  git(["checkout", "-b", branch]);
  git(["add", ...paths]);
  git(["commit", "-m", commitMessage]);
  if (rebaseFirst) rebaseOntoTrunk(git);
  git(skipPushHook ? ["push", "--no-verify", "origin", `HEAD:${branch}`] : ["push", "origin", `HEAD:${branch}`]);
  git(["reset", "HEAD~1"]);
  return git(["diff", "--", ...paths]);
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
    "The branch was already there when this run started, with no pull request, no commits, and older",
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
    "This run's pushed answer changed an acceptance test it is judged by.",
    "",
    reason,
    "",
    "An implementer may turn a `test.fails(` test on by deleting `.fails` from that line, and may",
    "not otherwise touch it. The answer is already on this ticket's branch, so nothing is lost; the",
    "mechanic has been sent to decide whether the gate or the tree is wrong, and land it.",
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

export function immutableSetNote(paths: string[]): string {
  return [
    `Refused to push this run's answer: it touches the immutable set: ${paths.join(", ")}.`,
    "",
    "No pull request may change `vitest.config.ts` or `.github/`. Nothing was committed, the claim has",
    "been released, and the ticket itself needs fixing before this can be re-dispatched.",
  ].join("\n");
}

export function gateRedNote(output: string): string {
  return [
    "This run's own gate stayed red after one repair round.",
    "",
    "Pushed anyway so the work is not lost; the verify lane will show it red too.",
    "",
    "```",
    output,
    "```",
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
  | { outcome: "fails-rule-refused"; reason: string }
  | { outcome: "immutable-refused"; paths: string[] };

export interface LandDeps {
  gh: GhExec;
  git: GitExec;
  writeFile: (path: string, content: string) => void;
  removeFile: (path: string) => void;
  regenerateIndex: () => boolean;
}

function removeIfPresent(removeFile: (path: string) => void, path: string): void {
  try {
    removeFile(path);
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code !== "ENOENT") throw err;
  }
}

export async function landAnswer(
  deps: LandDeps,
  branch: string,
  issueNumber: number,
  ticket: TicketRead,
  answer: ImplementerAnswer,
  commitMessage: string,
  log: (line: string) => void,
  options: { rebaseOntoTrunk?: boolean; skipPushHook?: boolean } = {},
): Promise<ImplementOutcome> {
  for (const file of answer.files) {
    deps.writeFile(file.path, file.content);
  }
  for (const path of answer.deleted) {
    removeIfPresent(deps.removeFile, path);
  }

  const answeredPaths = [...answer.files.map((file) => file.path), ...answer.deleted];
  const changing = worktreeChanges(deps.git, answeredPaths);

  if (changing.length === 0) {
    releaseClaim(deps.gh, branch, log);
    sayOnTicket(deps.gh, issueNumber, nothingToBuildNote(issueNumber), log);
    return { outcome: "nothing-to-build" };
  }

  const paths = [...answeredPaths];
  if (paths.some((path) => path.startsWith(`${ADR_DIR}/`)) && deps.regenerateIndex()) {
    paths.push(INDEX_RELATIVE_PATH);
  }

  if (touchesImmutableSet(paths)) {
    releaseClaim(deps.gh, branch, log);
    escalateToOwner(deps.gh, issueNumber, process.env.GITHUB_REPOSITORY_OWNER);
    sayOnTicket(deps.gh, issueNumber, immutableSetNote(paths), log);
    return { outcome: "immutable-refused", paths };
  }

  let diff: string;
  try {
    diff = commitPushAndDiff(deps.git, branch, paths, commitMessage, options.rebaseOntoTrunk ?? false, options.skipPushHook ?? false);
  } catch (err) {
    if (!(err instanceof RebaseConflictError)) throw err;
    releaseClaim(deps.gh, branch, log);
    escalateToOwner(deps.gh, issueNumber, process.env.GITHUB_REPOSITORY_OWNER);
    sayOnTicket(deps.gh, issueNumber, rebaseConflictNote(err.paths), log);
    return { outcome: "rebase-conflict", paths: err.paths };
  }

  const declaredPaths = new Set(answer.declaredEdits.map((edit) => edit.path));
  const verdict = judgeFailsEdits(diff, declaredPaths);
  if (!verdict.ok) {
    dispatchMechanicWanted(deps.gh, issueNumber);
    sayOnTicket(deps.gh, issueNumber, failsRuleNote(verdict.reason), log);
    return { outcome: "fails-rule-refused", reason: verdict.reason };
  }

  const bodySections = [answer.summary];
  if (answer.declaredEdits.length > 0) bodySections.push(declaredEditsNote(answer.declaredEdits));
  bodySections.push(`Ticket: #${issueNumber}`);

  const pr = openPrAndDispatch(deps.gh, {
    branch,
    title: ticket.title,
    body: bodySections.join("\n\n"),
    changedFiles: paths,
    criteria: extractCriteria(ticket.body),
  });

  if (answer.declaredEdits.length > 0) {
    sayOnTicket(deps.gh, issueNumber, declaredEditsNote(answer.declaredEdits), log);
  }

  return { outcome: "opened", pr };
}
export async function landUnderGate(
  deps: LandDeps,
  branch: string,
  issueNumber: number,
  ticket: TicketRead,
  answer: ImplementerAnswer,
  subject: string,
  gate: GateVerdict,
  log: (line: string) => void,
): Promise<ImplementOutcome> {
  const outcome = await landAnswer(
    deps,
    branch,
    issueNumber,
    ticket,
    answer,
    `${subject} #${issueNumber}\n\n${answer.summary}\n\nPart of #${issueNumber}`,
    log,
    { rebaseOntoTrunk: true, skipPushHook: true },
  );
  if (!gate.ok && outcome.outcome === "opened") {
    escalateToOwner(deps.gh, issueNumber, process.env.GITHUB_REPOSITORY_OWNER);
    sayOnTicket(deps.gh, issueNumber, gateRedNote(gateOutputTail(gate.output)), log);
  }
  return outcome;
}
