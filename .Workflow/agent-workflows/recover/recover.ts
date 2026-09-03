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
import { touchesImmutableSet } from "../shared/immutable-set";
import { escalateToOwner } from "../shared/needs-human";
import { reason } from "../shared/reason";
import { implementationBranch, TICKET_READY_DISPATCH_ACTION } from "../shared/ready-set";
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
 * loop — the cap's whole action, through the one escalation every stopping lane shares
 * (`shared/needs-human.ts`). `GITHUB_REPOSITORY_OWNER` is set on every runner without a workflow
 * naming it, which is why this lane needs no `SIGNAL_ASSIGNEE` of its own.
 *
 * Deliberately not wrapped in a swallowing try/catch the way `sayOnTicket` is in `implement.ts`:
 * this *is* the escalation, not a side note beside one, so a write that fails here should fail the
 * run loudly rather than leave a ticket capped at three attempts with nobody told.
 */
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

/** Sends the same `ticket-ready` dispatch `implement.yml` itself listens for — `client_payload[issue]`, its only field. */
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
  /** Downloads `artifactName` from `runId` and returns the local directory holding it. */
  downloadArtifact: (runId: number, artifactName: string) => string;
  log?: (line: string) => void;
}

export type RecoverOutcome =
  | { outcome: "nothing-to-recover" }
  | { outcome: "stopped"; attempts: number }
  | { outcome: "already-claimed" }
  | { outcome: "already-handled" }
  | { outcome: "immutable"; files: string[] }
  | { outcome: "redispatched"; ticket: number }
  | { outcome: "opened"; pr: string }
  | { outcome: "nothing-to-build" }
  /** `landAnswer` refused the recovered answer for editing a `test.fails(` acceptance test (#360). */
  | { outcome: "fails-rule-refused"; reason: string };

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
  // Two doors can ring for one failed run — `implement.yml`'s own `implement-failed` dispatch and
  // the `workflow_run` event, which arrived minutes late or not at all three times on 2026-08-30 —
  // and the marker comment is what makes the second arrival a no-op rather than a second attempt.
  if (priorRuns.includes(deps.runId)) {
    log(`run ${deps.runId} was already reacted to (see the marker comment on #${ticket}); nothing to do`);
    return { outcome: "already-handled" };
  }
  if (priorRuns.length >= MAX_RECOVER_ATTEMPTS) {
    stopAndEscalate(deps.gh, ticket, deps.runId, priorRuns);
    return { outcome: "stopped", attempts: priorRuns.length };
  }

  if (!hasArtifact) {
    // Let go of the dead run's claim before asking for a fresh one. `implement.ts` claims the
    // branch before it spends anything, and a run that was cancelled or timed out never reaches
    // the release in its own `catch` — so the claim outlives it, and the dispatch below lands on a
    // run that reads it as live and exits `already claimed`. That is what happened to #342 at
    // 00:16 (run 33698760072), leaving the ticket unbuildable for the claim's full 45-minute
    // timeout, which is exactly the stranding routing a timeout here was meant to end.
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

  // An answer that writes into the immutable set cannot land by any road: lane 06 refuses the
  // diff, and before that the push itself is refused — a `GITHUB_TOKEN` may not touch
  // `.github/workflows/` at all, which is how run 33326295612 lost #275 (its ticket *claimed*
  // `shape.yml` and `to-tickets.yml`). The defect is the ticket's, not the run's (#278), so
  // re-landing the same files three times would spend three runs proving one thing. Escalate now,
  // naming the files, and claim nothing.
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

  const branch = implementationBranch(ticket);
  // The same atomic claim `implement.ts` itself takes, so this run and a fresh dispatch (or a
  // human who already pushed by hand) cannot both act on the same slice.
  const claim = claimImplementationBranch(deps.gh, deps.git, branch, log);
  if (!claim.claimed) {
    log(`\`${branch}\` is already claimed or recovered — a pull request may already be open; nothing to do.`);
    return { outcome: "already-claimed" };
  }

  const ticketRead = readTicket(deps.gh, ticket);
  const commitMessage = `Recover #${ticket} from run ${deps.runId}\n\n${answer.summary}\n\nPart of #${ticket}`;
  const result: ImplementOutcome = await landAnswer(deps, branch, ticket, ticketRead, answer, commitMessage, log);

  // The ticket already carries `needs-human` and the verdict's own note (`landAnswer`); a recovered
  // answer that edited its own acceptance test is not one to re-dispatch, so this counts the
  // attempt and stops.
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

  // Which checkout the recovered answer lands in. `TARGET_WORKSPACE` is set only by the reusable
  // workflow (ADR-0055): there this process runs from the machine checkout and every path in the
  // answer is the target's. `readFile` is deliberately not bound to it — the only thing this lane
  // reads is the downloaded artifact, at an absolute path in the runner's temp directory.
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
    // A refusal that needs a human is red here, the way `implement.ts`'s own run is: the ticket
    // says which lines, and nothing was committed.
    if (outcome.outcome === "fails-rule-refused") process.exitCode = 1;
  } catch (err) {
    console.error(`recover failed: ${reason(err)}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
