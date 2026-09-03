import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { execGh, issueComments, type GhExec } from "../shared/gh";
import {
  claimImplementationBranch,
  ImplementerAnswer,
  landAnswer,
  releaseDeadClaim,
  type ImplementOutcome,
} from "../shared/implementation-landing";
import { runArtifactsPath } from "../shared/gh-paths";
import { execGit, type GitExec } from "../shared/git";
import { gateGrowth } from "../shared/gate-files";
import { touchesImmutableSet } from "../shared/immutable-set";
import { escalateToOwner } from "../shared/needs-human";
import { reason } from "../shared/reason";
import { implementationBranch, TICKET_READY_DISPATCH_ACTION } from "../shared/ready-set";
import { readTicket } from "../shared/ticket-shape";

export const MAX_RECOVER_ATTEMPTS = 3;

const ARTIFACT_NAME_RE = /^implementer-answer-(\d+)$/;

const IMPLEMENTING_LINE_RE = /implementing #(\d+)/g;

const ATTEMPT_MARKER_RE = /<!-- recover-attempt:(\d+) -->/;

interface RawArtifact {
  name?: string;
}
interface RawArtifactsList {
  artifacts?: RawArtifact[];
}

export function resolveTicketFromArtifacts(gh: GhExec, runId: number): number | undefined {
  let raw: string;
  try {
    raw = gh(["api", runArtifactsPath(runId)]);
  } catch {
    return undefined;
  }
  const parsed = JSON.parse(raw) as RawArtifactsList;
  for (const artifact of parsed.artifacts ?? []) {
    const match = ARTIFACT_NAME_RE.exec(artifact.name ?? "");
    if (match) return Number(match[1]);
  }
  return undefined;
}

export function resolveTicketFromLog(gh: GhExec, runId: number): number | undefined {
  let raw: string;
  try {
    raw = gh(["run", "view", String(runId), "--log"]);
  } catch {
    return undefined;
  }
  const matches = [...raw.matchAll(IMPLEMENTING_LINE_RE)];
  const last = matches.at(-1);
  return last ? Number(last[1]) : undefined;
}

export interface RecoveryTarget {
  ticket: number;
  hasArtifact: boolean;
}

export function resolveRecoveryTarget(gh: GhExec, runId: number): RecoveryTarget | undefined {
  const fromArtifact = resolveTicketFromArtifacts(gh, runId);
  if (fromArtifact !== undefined) return { ticket: fromArtifact, hasArtifact: true };

  const fromLog = resolveTicketFromLog(gh, runId);
  if (fromLog !== undefined) return { ticket: fromLog, hasArtifact: false };

  return undefined;
}

export function attemptCommentBody(runId: number, line: string): string {
  return `<!-- recover-attempt:${runId} -->\n${line}`;
}

export function priorAttemptRunIds(gh: GhExec, issueNumber: number): number[] {
  const ids: number[] = [];
  for (const body of issueComments(gh, issueNumber)) {
    const match = ATTEMPT_MARKER_RE.exec(body);
    if (match) ids.push(Number(match[1]));
  }
  return ids;
}

function runUrl(runId: number): string {
  const server = process.env.GITHUB_SERVER_URL ?? "https://github.com";
  const repo = process.env.GITHUB_REPOSITORY ?? "";
  return `${server}/${repo}/actions/runs/${runId}`;
}

function postAttemptComment(gh: GhExec, issueNumber: number, runId: number, line: string): void {
  gh(["issue", "comment", String(issueNumber), "--body", attemptCommentBody(runId, line)]);
}

function stopAndEscalate(gh: GhExec, ticket: number, runId: number, priorRuns: number[]): void {
  escalateToOwner(gh, ticket, process.env.GITHUB_REPOSITORY_OWNER);

  const runs = [...priorRuns, runId].map((id) => `- ${runUrl(id)}`).join("\n");
  postAttemptComment(
    gh,
    ticket,
    runId,
    `Stopped after ${MAX_RECOVER_ATTEMPTS} recovery attempts on #${ticket} — a human needs to look at it.\n\nRuns:\n${runs}`,
  );
}

export function redispatchImplement(gh: GhExec, ticket: number): void {
  gh([
    "api",
    "repos/{owner}/{repo}/dispatches",
    "-f",
    `event_type=${TICKET_READY_DISPATCH_ACTION}`,
    "-f",
    `client_payload[issue]=${ticket}`,
  ]);
}

export interface RecoverDeps {
  gh: GhExec;
  git: GitExec;
  runId: number;
  readFile: (path: string) => string;
  writeFile: (path: string, content: string) => void;
  downloadArtifact: (runId: number, artifactName: string) => string;
  log?: (line: string) => void;
}

export type RecoverOutcome =
  | { outcome: "nothing-to-recover" }
  | { outcome: "stopped"; attempts: number }
  | { outcome: "already-claimed" }
  | { outcome: "already-handled" }
  | { outcome: "immutable"; files: string[] }
  | { outcome: "gate-growth"; files: string[] }
  | { outcome: "redispatched"; ticket: number }
  | { outcome: "opened"; pr: string }
  | { outcome: "nothing-to-build" }
  | { outcome: "fails-rule-refused"; reason: string };

export async function runRecover(deps: RecoverDeps): Promise<RecoverOutcome> {
  const log = deps.log ?? ((line: string) => console.log(line));

  const target = resolveRecoveryTarget(deps.gh, deps.runId);
  if (!target) {
    log(`run ${deps.runId} names no ticket, by artifact or by log line — nothing to recover`);
    return { outcome: "nothing-to-recover" };
  }
  const { ticket, hasArtifact } = target;

  const priorRuns = priorAttemptRunIds(deps.gh, ticket);
  if (priorRuns.includes(deps.runId)) {
    log(`run ${deps.runId} was already reacted to (see the marker comment on #${ticket}); nothing to do`);
    return { outcome: "already-handled" };
  }
  if (priorRuns.length >= MAX_RECOVER_ATTEMPTS) {
    stopAndEscalate(deps.gh, ticket, deps.runId, priorRuns);
    return { outcome: "stopped", attempts: priorRuns.length };
  }

  if (!hasArtifact) {
    releaseDeadClaim(deps.gh, implementationBranch(ticket), "main", log);
    redispatchImplement(deps.gh, ticket);
    postAttemptComment(
      deps.gh,
      ticket,
      deps.runId,
      `Re-dispatched #${ticket}. Run ${runUrl(deps.runId)} ended with no implementer answer to recover, so this sent a fresh \`ticket-ready\` dispatch.`,
    );
    return { outcome: "redispatched", ticket };
  }

  const artifactName = `implementer-answer-${ticket}`;
  const artifactDir = deps.downloadArtifact(deps.runId, artifactName);
  const raw = deps.readFile(join(artifactDir, "implementer-answer.json"));
  const answer = ImplementerAnswer.parse(JSON.parse(raw));

  const forbidden = answer.files.map((file) => file.path).filter((path) => touchesImmutableSet([path]));
  if (forbidden.length > 0) {
    escalateToOwner(deps.gh, ticket, process.env.GITHUB_REPOSITORY_OWNER);
    postAttemptComment(
      deps.gh,
      ticket,
      deps.runId,
      `Not recovered: the implementer's answer for #${ticket} (run ${runUrl(deps.runId)}) writes into the immutable set, which no pull request may change — the ticket itself needs fixing.\n\n${forbidden.map((path) => `- \`${path}\``).join("\n")}`,
    );
    return { outcome: "immutable", files: forbidden };
  }

  const growth = gateGrowth(
    deps.git,
    answer.files.map((file) => file.path),
  );
  if (growth.length > 0) {
    escalateToOwner(deps.gh, ticket, process.env.GITHUB_REPOSITORY_OWNER);
    postAttemptComment(
      deps.gh,
      ticket,
      deps.runId,
      `Not recovered: the implementer's answer for #${ticket} (run ${runUrl(deps.runId)}) adds a file to the gate, which a lane may shrink and never grow (#360) — the ticket itself needs fixing.\n\n${growth.map((path) => `- \`${path}\``).join("\n")}`,
    );
    return { outcome: "gate-growth", files: growth };
  }

  const branch = implementationBranch(ticket);
  const claim = claimImplementationBranch(deps.gh, deps.git, branch, log);
  if (!claim.claimed) {
    log(`\`${branch}\` is already claimed or recovered — a pull request may already be open; nothing to do.`);
    return { outcome: "already-claimed" };
  }

  const ticketRead = readTicket(deps.gh, ticket);
  const commitMessage = `Recover #${ticket} from run ${deps.runId}\n\n${answer.summary}\n\nPart of #${ticket}`;
  const result: ImplementOutcome = await landAnswer(deps, branch, ticket, ticketRead, answer, commitMessage, log);

  if (result.outcome === "fails-rule-refused") {
    postAttemptComment(
      deps.gh,
      ticket,
      deps.runId,
      `Recovered #${ticket} from run ${runUrl(deps.runId)}: refused — the answer edited a test.fails( acceptance test beyond turning it on.`,
    );
    return result;
  }

  const summaryLine =
    result.outcome === "opened"
      ? `Recovered #${ticket} from run ${runUrl(deps.runId)}: opened ${result.pr}.`
      : `Recovered #${ticket} from run ${runUrl(deps.runId)}: the implementer's files matched what is already on trunk, so there was nothing to build.`;
  postAttemptComment(deps.gh, ticket, deps.runId, summaryLine);

  return result.outcome === "opened" ? { outcome: "opened", pr: result.pr } : { outcome: "nothing-to-build" };
}

function fsWriteFile(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
}

function downloadArtifactTo(runId: number, artifactName: string): string {
  const dir = mkdtempSync(join(tmpdir(), "recover-"));
  execGh(["run", "download", String(runId), "-n", artifactName, "-D", dir]);
  return dir;
}

async function main(): Promise<void> {
  const runIdArg = process.env.RUN_ID;
  if (!runIdArg) {
    console.log("no Implement run named; nothing to recover");
    return;
  }
  const runId = Number(runIdArg);
  if (!Number.isFinite(runId)) {
    console.log(`RUN_ID "${runIdArg}" is not a number; nothing to recover`);
    return;
  }

  const repoDir = process.env.TARGET_WORKSPACE || process.cwd();

  try {
    const outcome = await runRecover({
      gh: execGh,
      git: (args) => execGit(["-C", repoDir, ...args]),
      runId,
      readFile: (path) => readFileSync(path, "utf8"),
      writeFile: (path, content) => fsWriteFile(resolve(repoDir, path), content),
      downloadArtifact: downloadArtifactTo,
    });
    console.log(`recover: ${outcome.outcome}`);
    if (outcome.outcome === "fails-rule-refused") process.exitCode = 1;
  } catch (err) {
    console.error(`recover failed: ${reason(err)}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
