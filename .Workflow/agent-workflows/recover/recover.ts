import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  claimImplementationBranch,
  IMPLEMENT_DISPATCH_EVENT_TYPE,
  ImplementerAnswer,
  landAnswer,
  type ImplementOutcome,
} from "../implement/implement";
import { execGenerator, type GeneratorExec } from "../implement/regenerate-artifacts";
import { execGh, issueComments, type GhExec } from "../shared/gh";
import { runArtifactsPath } from "../shared/gh-paths";
import { execGit, type GitExec } from "../shared/git";
import { reason } from "../shared/reason";
import { implementationBranch } from "../shared/ready-set";
import { readTicket } from "../shared/ticket-shape";

/**
 * Lane: what runs when `Implement` (lane 05) completes red *after the model already answered* —
 * a `git push` the pre-push gauntlet rejected, a `pr create` that 403'd, anything that dies once
 * `implementer-answer-<n>` is already on disk. Until this lane existed, the answer survived only
 * as an Actions artifact and a human recovered it by hand (run 33316096960: 40 minutes of Sonnet,
 * lost to a rejected push).
 *
 * Two very different repairs share this file because they share a trigger: a failed `Implement`
 * run either left an answer behind or it didn't, and which one decides everything downstream.
 * **An artifact exists** — the model did the work, so this lane finishes lane 05's own tail
 * (`landAnswer`, reused rather than restated) and hands the branch to `Verify`. **No artifact
 * exists** — the model never answered (a crash, a plan error), so there is nothing to keep, and
 * this sends the same `ticket-ready` dispatch lane 05 itself listens for.
 *
 * Never runs a model. Every write goes through `GhExec`/`GitExec` so a test can assert the
 * sequence rather than the outcome.
 */

/** ADR-0041's ceiling on the fixer, reused here for the same reason: a run this cannot land in
 * a bounded number of tries needs a human, not a fourth try. */
export const MAX_RECOVER_ATTEMPTS = 3;

/** The label this lane applies once it stops trying — copied from `shape.yml`'s own creation call. */
const NEEDS_HUMAN_LABEL = "needs-human";

/** The `implementer-answer-<n>` artifact name `implement.yml` uploads, read back for its ticket number. */
const ARTIFACT_NAME_RE = /^implementer-answer-(\d+)$/;

/** The line `implement.yml`'s "Implement the ticket" step echoes before it runs anything (ADR-0104's pattern). */
const IMPLEMENTING_LINE_RE = /implementing #(\d+)/g;

/** One HTML marker this lane's own comments carry — see `attemptCommentBody` for the rest of the shape. */
const ATTEMPT_MARKER_RE = /<!-- recover-attempt:(\d+) -->/;

interface RawArtifact {
  name?: string;
}
interface RawArtifactsList {
  artifacts?: RawArtifact[];
}

/**
 * The ticket number an `implementer-answer-<n>` artifact on `runId` names, or `undefined` when the
 * run carries none — the ordinary case for a run that died before the model answered, and the
 * signal this lane reads to choose recovery over re-dispatch.
 */
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

/**
 * The ticket number read off the `implementing #<n>` line `implement.yml` echoes early in its
 * "Implement the ticket" step — the fallback source when the run died before uploading an
 * artifact at all (no upload step ever ran, or it ran and found nothing). The last match wins,
 * the same "most recent line wins" reading `fixer.yml`'s own log grep uses.
 */
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

/** What `resolveRecoveryTarget` answers: which ticket a failed run was building, and whether its answer survived. */
export interface RecoveryTarget {
  ticket: number;
  /** True when an `implementer-answer-<n>` artifact exists — the recovery path, not the re-dispatch one. */
  hasArtifact: boolean;
}

/**
 * Resolves the ticket a failed `Implement` run was building, artifacts first and the log line
 * second — `undefined` when neither source names one, which is "nothing to recover" (a run this
 * lane was never meant to react to, or a run so early nothing was ever written).
 */
export function resolveRecoveryTarget(gh: GhExec, runId: number): RecoveryTarget | undefined {
  const fromArtifact = resolveTicketFromArtifacts(gh, runId);
  if (fromArtifact !== undefined) return { ticket: fromArtifact, hasArtifact: true };

  const fromLog = resolveTicketFromLog(gh, runId);
  if (fromLog !== undefined) return { ticket: fromLog, hasArtifact: false };

  return undefined;
}

/**
 * The comment body one reaction posts: the HTML marker naming this run, plus one human line
 * saying what happened. `priorAttemptRunIds` reads the marker back off every comment on the
 * ticket, which is what makes the attempt count durable and free — no counter file, nothing this
 * lane has to keep in sync with itself across runs.
 */
export function attemptCommentBody(runId: number, line: string): string {
  return `<!-- recover-attempt:${runId} -->\n${line}`;
}

/** Every run id this lane has already reacted to on `issueNumber`, oldest first. */
export function priorAttemptRunIds(gh: GhExec, issueNumber: number): number[] {
  const ids: number[] = [];
  for (const body of issueComments(gh, issueNumber)) {
    const match = ATTEMPT_MARKER_RE.exec(body);
    if (match) ids.push(Number(match[1]));
  }
  return ids;
}

/** The Actions run URL for `runId`, built from the same two variables every job carries by default. */
function runUrl(runId: number): string {
  const server = process.env.GITHUB_SERVER_URL ?? "https://github.com";
  const repo = process.env.GITHUB_REPOSITORY ?? "";
  return `${server}/${repo}/actions/runs/${runId}`;
}

function postAttemptComment(gh: GhExec, issueNumber: number, runId: number, line: string): void {
  gh(["issue", "comment", String(issueNumber), "--body", attemptCommentBody(runId, line)]);
}

/**
 * Applies `needs-human`, assigns the repository owner, and posts the marker comment that stops the
 * loop — the cap's whole action. Creates the label first (copied from `shape.yml`'s own creation
 * call) so a fresh repo can apply it on the first run that ever needs to.
 *
 * Deliberately not wrapped in a swallowing try/catch the way `sayOnTicket` is in `implement.ts`:
 * this *is* the escalation, not a side note beside one, so a write that fails here should fail the
 * run loudly rather than leave a ticket capped at three attempts with nobody told.
 */
function stopAndEscalate(gh: GhExec, ticket: number, runId: number, priorRuns: number[]): void {
  gh([
    "label",
    "create",
    NEEDS_HUMAN_LABEL,
    "--color",
    "d93f0b",
    "--description",
    "Ticket stalled; a human decision or action is required",
    "--force",
  ]);
  gh(["issue", "edit", String(ticket), "--add-label", NEEDS_HUMAN_LABEL]);

  const owner = process.env.GITHUB_REPOSITORY_OWNER;
  if (owner) {
    gh(["issue", "edit", String(ticket), "--add-assignee", owner]);
  }

  const runs = [...priorRuns, runId].map((id) => `- ${runUrl(id)}`).join("\n");
  postAttemptComment(
    gh,
    ticket,
    runId,
    `Stopped after ${MAX_RECOVER_ATTEMPTS} recovery attempts on #${ticket} — a human needs to look at it.\n\nRuns:\n${runs}`,
  );
}

/** Sends the same `ticket-ready` dispatch `implement.yml` itself listens for — `client_payload[issue]`, its only field. */
export function redispatchImplement(gh: GhExec, ticket: number): void {
  gh([
    "api",
    "repos/{owner}/{repo}/dispatches",
    "-f",
    `event_type=${IMPLEMENT_DISPATCH_EVENT_TYPE}`,
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
  /** Downloads `artifactName` from `runId` and returns the local directory holding it. */
  downloadArtifact: (runId: number, artifactName: string) => string;
  log?: (line: string) => void;
  runGenerator?: GeneratorExec;
  repoRoot?: string;
}

export type RecoverOutcome =
  | { outcome: "nothing-to-recover" }
  | { outcome: "stopped"; attempts: number }
  | { outcome: "already-claimed" }
  | { outcome: "redispatched"; ticket: number }
  | { outcome: "opened"; pr: string }
  | { outcome: "nothing-to-build" };

/**
 * The whole recover flow: resolve which ticket a failed `Implement` run was building, apply the
 * three-attempt cap (ADR-0041's ceiling), and either finish lane 05's own tail over the answer an
 * artifact carries, or re-dispatch the ticket when no answer survived.
 */
export async function runRecover(deps: RecoverDeps): Promise<RecoverOutcome> {
  const log = deps.log ?? ((line: string) => console.log(line));

  const target = resolveRecoveryTarget(deps.gh, deps.runId);
  if (!target) {
    log(`run ${deps.runId} names no ticket, by artifact or by log line — nothing to recover`);
    return { outcome: "nothing-to-recover" };
  }
  const { ticket, hasArtifact } = target;

  const priorRuns = priorAttemptRunIds(deps.gh, ticket);
  if (priorRuns.length >= MAX_RECOVER_ATTEMPTS) {
    stopAndEscalate(deps.gh, ticket, deps.runId, priorRuns);
    return { outcome: "stopped", attempts: priorRuns.length };
  }

  if (!hasArtifact) {
    redispatchImplement(deps.gh, ticket);
    postAttemptComment(
      deps.gh,
      ticket,
      deps.runId,
      `Re-dispatched #${ticket}. Run ${runUrl(deps.runId)} ended with no implementer answer to recover, so this sent a fresh \`ticket-ready\` dispatch.`,
    );
    return { outcome: "redispatched", ticket };
  }

  const branch = implementationBranch(ticket);
  // Before anything else: the same atomic claim `implement.ts` itself takes, so this run and a
  // fresh dispatch (or a human who already pushed by hand) cannot both act on the same slice.
  const claim = claimImplementationBranch(deps.gh, deps.git, branch, log);
  if (!claim.claimed) {
    log(`\`${branch}\` is already claimed or recovered — a pull request may already be open; nothing to do.`);
    return { outcome: "already-claimed" };
  }

  const artifactName = `implementer-answer-${ticket}`;
  const artifactDir = deps.downloadArtifact(deps.runId, artifactName);
  const raw = deps.readFile(join(artifactDir, "implementer-answer.json"));
  const answer = ImplementerAnswer.parse(JSON.parse(raw));

  const ticketRead = readTicket(deps.gh, ticket);
  const commitMessage = `Recover #${ticket} from run ${deps.runId}\n\n${answer.summary}\n\nPart of #${ticket}`;
  const result: ImplementOutcome = await landAnswer(deps, branch, ticket, ticketRead, answer, commitMessage, log);

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

/** The real `downloadArtifact`: `gh run download` into a fresh temp directory, one artifact at a time. */
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

  try {
    const outcome = await runRecover({
      gh: execGh,
      git: execGit,
      runId,
      readFile: (path) => readFileSync(path, "utf8"),
      writeFile: fsWriteFile,
      downloadArtifact: downloadArtifactTo,
      runGenerator: execGenerator,
    });
    console.log(`recover: ${outcome.outcome}`);
  } catch (err) {
    console.error(`recover failed: ${reason(err)}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
