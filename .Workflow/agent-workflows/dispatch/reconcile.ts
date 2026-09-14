import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { closeTicketProcess, type CloseTicketResult } from "../shared/close-ticket";
import { execGh, type GhExec } from "../shared/gh";
import { issueCommentPath } from "../shared/gh-paths";
import {
  ACCEPTING_LABEL,
  BUILDING_LABEL,
  BY_HAND_LABEL,
  ensureLabel,
  markLane,
  NEEDS_HUMAN_LABEL,
  PRD_LABEL,
  QUEUED_LABEL,
  SLICEABLE_LABEL,
  TICKET_LABEL,
  TO_BUILD_LABEL,
  unlabel,
  WAITING_LABEL,
  wearsLane,
  type StateLabel,
} from "../shared/labels";
import { escalateToOwner } from "../shared/needs-human";
import { countRollup, readRollup, rollupLine, writeRollup } from "./rollup";
import {
  dispatchAcceptanceWanted,
  dispatchMechanicWanted,
  dispatchPrdSliceable,
  dispatchTicketReady,
  GRAPH_CHANGED_DISPATCH_ACTION,
  IMPLEMENTATION_BRANCH_PREFIX,
} from "../shared/ready-set";
import { reason } from "../shared/reason";
import {
  decisionBody,
  readFailedLog,
  rungFor,
  signatureFromLog,
  strikeBody,
  type LaneRun,
  type Next,
  type Rung,
  type Strike,
} from "../shared/strikes";
import {
  CLAIM_LIMIT,
  countCriteria,
  extractCriteria,
  isRunnableSpec,
  parseCheckMarker,
} from "../shared/ticket-shape";
import {
  deliveryOf,
  ISSUE_PAGE_SIZE,
  markedComment,
  mergedCloser,
  ticketState,
  TO_BUILD_REFUSED_MARKER,
  type Blocker,
  type IssueComment,
  type TicketState,
} from "./ticket-state";
import {
  alreadyNamed,
  commentBody,
  entryLine,
  FINDING_MARKER,
  retirementBody,
  signalBody,
  signalTitle,
  type UnreachableFinding,
} from "../shared/unreachable";

export const SESSION_CAPTURED_DISPATCH_ACTION = "session-captured";

export const RUN_ENDED_ACTION = "run-ended";

export const RECONCILE_DISPATCH_ACTIONS = [
  SESSION_CAPTURED_DISPATCH_ACTION,
  GRAPH_CHANGED_DISPATCH_ACTION,
  RUN_ENDED_ACTION,
] as const;

export const MAIN_MOVED_ACTION = "main-moved";

export const RECONCILE_ENDINGS = [...RECONCILE_DISPATCH_ACTIONS, MAIN_MOVED_ACTION] as const;

const MAX_STRIKE_LOG_READS = 10;

const MAX_UNREACHABLE_REPORTED = 10;

export { TO_BUILD_LABEL };

export interface ReconcileInput {
  gh?: GhExec;
  log?: (line: string) => void;
  dryRun?: boolean;
  closeSpec?: (number: number, range: string) => CloseTicketResult;
  targetWorkspace?: string;
}

export interface ReconcileOutcome {
  action: "clear" | "dispatched" | "degraded";
  checked: number;
  dispatched: number[];
  unreachable: number[];
  note: string;
}

interface Stamps {
  lane: Map<number, StateLabel>;
  relabelled: Set<number>;
}

function stamp(stamps: Stamps, issueNumber: number, label?: StateLabel): void {
  stamps.relabelled.add(issueNumber);
  if (label !== undefined) stamps.lane.set(issueNumber, label);
}

function toBuildRefusalBody(refusal: string): string {
  return [
    `This is labelled \`${TO_BUILD_LABEL}\` and lane 06 will not start against it: ${refusal}.`,
    "",
    "Refused here rather than three stages later: verify's Immutability job reads the same",
    "`## Files claimed` section, so a run started against this body would spend an implementer and a",
    "pull request to arrive at the same answer.",
    "",
    `Add what is missing and the next session end starts it. The \`${TO_BUILD_LABEL}\` label stays`,
    "where it is; nothing here has to be re-applied.",
    "",
    TO_BUILD_REFUSED_MARKER,
  ].join("\n");
}

const SENT_TO_SLICING_MARKER = "<!-- sent-to-slicing:v1 -->";

function sentToSlicingBody(count: number): string {
  return [
    `Its \`## Files claimed\` names ${count} paths, past the ${CLAIM_LIMIT} lane 04 can author against inside`,
    "one lane budget, so this is not one ticket and no amount of waiting makes it one.",
    "",
    `Rather than hold it for the owner, this door relabelled it \`${PRD_LABEL}\` and rang lane 03, which`,
    "slices it into tickets of one subject each and publishes them here as sub-issues. Each of those is",
    "held to the same ceiling as it is written, so the split cannot hand the same problem back.",
    "",
    `Nobody needs to act on this, and it is not a \`${NEEDS_HUMAN_LABEL}\` hold. If lane 03 refuses — this`,
    "issue already has sub-issues, or is itself a sub-issue — it says so here and wears `slice-failed`.",
    "",
    SENT_TO_SLICING_MARKER,
  ].join("\n");
}

function sendToSlicing(
  gh: GhExec,
  ticket: TicketState,
  count: number,
  log: (line: string) => void,
  stamps: Stamps,
): void {
  if (ticket.comments === undefined) {
    log(`could not read #${ticket.number}'s comments, so leaving it be rather than ringing lane 03 twice.`);
    return;
  }
  if (!postOnce(gh, ticket.number, ticket.comments, SENT_TO_SLICING_MARKER, sentToSlicingBody(count))) return;

  const shed = [TICKET_LABEL, TO_BUILD_LABEL].filter((label) => ticket.labels.includes(label));
  gh([
    "issue",
    "edit",
    String(ticket.number),
    "--add-label",
    PRD_LABEL,
    ...shed.flatMap((label) => ["--remove-label", label]),
  ]);
  markLane(gh, ticket.number, SLICEABLE_LABEL, ticket.labels);
  stamp(stamps, ticket.number, SLICEABLE_LABEL);
  dispatchPrdSliceable(gh, ticket.number);
  log(
    `#${ticket.number}: claims ${count} paths, past ${CLAIM_LIMIT}; relabelled \`${PRD_LABEL}\` and rang lane 03 to slice it.`,
  );
}

const BY_HAND_STAND_DOWN_MARKER = "<!-- by-hand-stand-down:v1 -->";

function byHandStandDownBody(): string {
  return [
    "Its `## Files claimed` names a workstation or immutable-set path, which no pull request may",
    `edit, so this ticket wears \`${BY_HAND_LABEL}\` and only a human can build it. Lane 06 will not`,
    `start against it, and this stand-down is not a \`${NEEDS_HUMAN_LABEL}\` hold — nobody needs to act`,
    "on it.",
    "",
    BY_HAND_STAND_DOWN_MARKER,
  ].join("\n");
}

function recordByHandStandDown(gh: GhExec, ticket: TicketState, labelled: boolean, log: (line: string) => void): void {
  if (ticket.comments === undefined) {
    log(`could not read #${ticket.number}'s comments, so leaving whatever this door said last run standing.`);
    return;
  }
  if (!labelled) {
    ensureLabel(gh, BY_HAND_LABEL);
    gh(["issue", "edit", String(ticket.number), "--add-label", BY_HAND_LABEL]);
  }
  if (!postOnce(gh, ticket.number, ticket.comments, BY_HAND_STAND_DOWN_MARKER, byHandStandDownBody())) return;
  log(`#${ticket.number}: stood down at the ${TO_BUILD_LABEL} door: labelled \`${BY_HAND_LABEL}\`.`);
}

const TO_BUILD_CLEARED_BODY = [
  "This ticket's shape is no longer refused: it carries both headings lane 06 needs, so the",
  "recompute that read this will start it as soon as every blocker has delivered.",
].join("\n");

function recordRefusal(
  gh: GhExec,
  ticket: TicketState,
  refusal: string,
  log: (line: string) => void,
  stamps: Stamps,
): void {
  if (ticket.comments === undefined) {
    log(`could not read #${ticket.number}'s comments, so leaving whatever this door said last run standing.`);
    return;
  }
  if (!upsertMarked(gh, ticket.number, ticket.comments, TO_BUILD_REFUSED_MARKER, toBuildRefusalBody(refusal))) return;
  escalateToOwner(gh, ticket.number, process.env.GITHUB_REPOSITORY_OWNER, ticket.labels);
  stamp(stamps, ticket.number);
  log(`#${ticket.number}: refused at the ${TO_BUILD_LABEL} door: ${refusal}; holds ${NEEDS_HUMAN_LABEL}.`);
}

function recordCleared(gh: GhExec, ticket: TicketState, log: (line: string) => void): void {
  if (ticket.comments === undefined) {
    log(`could not read #${ticket.number}'s comments, so leaving whatever this door said last run standing.`);
    return;
  }
  const standing = markedComment(ticket.comments, TO_BUILD_REFUSED_MARKER);
  if (standing === undefined) return;
  rewriteComment(gh, standing.id, TO_BUILD_CLEARED_BODY);
  gh(["issue", "edit", String(ticket.number), "--remove-label", NEEDS_HUMAN_LABEL]);
  log(`#${ticket.number}: its shape is no longer refused at the ${TO_BUILD_LABEL} door; ${NEEDS_HUMAN_LABEL} lifted.`);
}

function recordDoor(
  gh: GhExec,
  ticket: TicketState,
  log: (line: string) => void,
  dryRun: boolean,
  stamps: Stamps,
): void {
  const door = ticket.door;
  if (door.verdict === "stand-down") {
    if (dryRun) {
      log(`would stand down #${ticket.number} at the ${TO_BUILD_LABEL} door: only a human can build what it claims.`);
      return;
    }
    try {
      recordByHandStandDown(gh, ticket, door.labelled, log);
    } catch (err) {
      log(`could not record #${ticket.number}'s by-hand stand-down: ${reason(err)}`);
    }
    return;
  }
  if (door.verdict === "slice") {
    if (dryRun) {
      log(`would ring lane 03 to slice #${ticket.number}: it claims ${door.claimed} paths, past ${CLAIM_LIMIT}.`);
      return;
    }
    try {
      sendToSlicing(gh, ticket, door.claimed, log, stamps);
    } catch (err) {
      log(`could not ring lane 03 for #${ticket.number}: ${reason(err)}`);
    }
    return;
  }
  if (door.verdict === "refuse") {
    if (dryRun) {
      log(`would refuse #${ticket.number} at the ${TO_BUILD_LABEL} door: ${door.refusal}.`);
      return;
    }
    try {
      recordRefusal(gh, ticket, door.refusal, log, stamps);
    } catch (err) {
      log(`could not record #${ticket.number}'s shape verdict: ${reason(err)}`);
    }
    return;
  }
  if (door.verdict !== "clear" || dryRun) return;
  try {
    recordCleared(gh, ticket, log);
  } catch (err) {
    log(`could not record #${ticket.number}'s shape verdict: ${reason(err)}`);
  }
}

const PRD_CHECK_MARKER = "<!-- prd-check:v1 -->";

const PRD_UNRUNNABLE_MARKER = "<!-- prd-unrunnable:v1 -->";

function rewriteComment(gh: GhExec, id: number, body: string): void {
  gh(["api", issueCommentPath(id), "-X", "PATCH", "-f", `body=${body}`]);
}

function postOnce(gh: GhExec, number: number, comments: IssueComment[], marker: string, body: string): boolean {
  if (markedComment(comments, marker) !== undefined) return false;
  gh(["issue", "comment", String(number), "--body", body]);
  return true;
}

function upsertMarked(gh: GhExec, number: number, comments: IssueComment[], marker: string, body: string): boolean {
  const standing = markedComment(comments, marker);
  if (standing === undefined) {
    gh(["issue", "comment", String(number), "--body", body]);
    return true;
  }
  if (standing.body === body) return false;
  rewriteComment(gh, standing.id, body);
  return true;
}

const PrMergeInfo = z.object({
  mergedAt: z.string().nullable(),
  mergeCommit: z.object({ oid: z.string() }).nullable(),
});

function fetchMergeInfo(gh: GhExec, pr: number): { mergedAt: string; sha: string } | undefined {
  try {
    const raw = gh(["pr", "view", String(pr), "--json", "mergedAt,mergeCommit"]);
    const parsed = PrMergeInfo.safeParse(JSON.parse(raw));
    if (!parsed.success || parsed.data.mergedAt === null || parsed.data.mergeCommit === null) return undefined;
    return { mergedAt: parsed.data.mergedAt, sha: parsed.data.mergeCommit.oid };
  } catch {
    return undefined;
  }
}

function synthesizeRange(gh: GhExec, mergedPrs: number[]): string | undefined {
  const infos = mergedPrs.map((pr) => fetchMergeInfo(gh, pr));
  if (infos.some((info) => info === undefined)) return undefined;
  const sorted = (infos as Array<{ mergedAt: string; sha: string }>)
    .slice()
    .sort((a, b) => a.mergedAt.localeCompare(b.mergedAt));
  const first = sorted[0].sha;
  const last = sorted[sorted.length - 1].sha;
  return `${first}^..${last}`;
}

interface SpecClosingAttempt {
  disagreement: boolean;
  result: CloseTicketResult;
}

function attemptSpecClose(
  gh: GhExec,
  prdNumber: number,
  children: Blocker[],
  closeSpec: (number: number, range: string) => CloseTicketResult,
  log: (line: string) => void,
): SpecClosingAttempt | undefined {
  const mergedPrs: number[] = [];
  for (const child of children) {
    const pr = mergedCloser(gh, child.number);
    if (deliveryOf(child, () => pr !== undefined) !== "delivered") return undefined;
    mergedPrs.push(pr as number);
  }

  const range = synthesizeRange(gh, mergedPrs);
  if (range === undefined) {
    log(`#${prdNumber}: every child delivered but its closing range could not be synthesized, so skipping the close attempt.`);
    return undefined;
  }

  const result = closeSpec(prdNumber, range);
  return { disagreement: result.exitCode !== 0, result };
}

function unrunnableReason(body: string): string {
  const count = countCriteria(body);
  if (count === null) return "its body carries no `## Acceptance criteria` heading";
  if (count === 0) return "its `## Acceptance criteria` heading has no `- [ ]` item";
  if (count > 1) return `its body carries ${count} acceptance criteria, and this pass can only run one`;
  return "its one acceptance criterion carries no well-formed `check:` marker";
}

function refusalCommentBody(body: string): string {
  return [`Could not run this spec's check: ${unrunnableReason(body)}.`, "", PRD_UNRUNNABLE_MARKER].join("\n");
}

function verdictCommentBody(command: string, run: { code: number; output: string }): string {
  const trimmed = run.output.trim();
  return [
    `Ran this spec's own check: \`${command}\``,
    "",
    `Exit ${run.code}.`,
    ...(trimmed.length > 0 ? ["", "```", trimmed, "```"] : []),
    "",
    PRD_CHECK_MARKER,
  ].join("\n");
}

function disagreementCommentBody(
  command: string,
  run: { code: number; output: string },
  closerResult: CloseTicketResult,
): string {
  const trimmed = closerResult.output.trim();
  return [
    `Ran this spec's own check: \`${command}\`, exit ${run.code}.`,
    "",
    `\`bin/close-ticket --spec\` disagreed: exit ${closerResult.exitCode}. This spec stays open.`,
    ...(trimmed.length > 0 ? ["", "```", trimmed, "```"] : []),
    "",
    PRD_CHECK_MARKER,
  ].join("\n");
}

function runCheckCommand(command: string, cwd: string): { code: number; output: string } {
  const result = spawnSync(command, { shell: true, cwd, encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });
  return { code: result.status ?? 1, output: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}

function upsertPrdComment(gh: GhExec, number: number, comments: IssueComment[], body: string): void {
  const existing = markedComment(comments, PRD_CHECK_MARKER, PRD_UNRUNNABLE_MARKER);
  if (existing) {
    rewriteComment(gh, existing.id, body);
  } else {
    gh(["issue", "comment", String(number), "--body", body]);
  }
}

function evaluateSpecCheck(
  gh: GhExec,
  prd: TicketState,
  children: Blocker[],
  log: (line: string) => void,
  closeSpec: (number: number, range: string) => CloseTicketResult,
  targetWorkspace: string,
): void {
  const comments = prd.comments;
  if (comments === undefined) {
    log(`could not read #${prd.number}'s comments, so skipping its spec check this run.`);
    return;
  }

  const hasOwnRefusal = markedComment(comments, PRD_UNRUNNABLE_MARKER) !== undefined;
  const hasNeedsHuman = prd.labels.includes(NEEDS_HUMAN_LABEL);

  if (!isRunnableSpec(prd.body)) {
    upsertPrdComment(gh, prd.number, comments, refusalCommentBody(prd.body));
    if (!hasNeedsHuman) gh(["issue", "edit", String(prd.number), "--add-label", NEEDS_HUMAN_LABEL]);
    log(`#${prd.number}: refused: ${unrunnableReason(prd.body)}.`);
    return;
  }

  const command = parseCheckMarker(extractCriteria(prd.body)[0] ?? "");
  if (command === undefined) {
    log(`#${prd.number}: isRunnableSpec accepted a body whose marker didn't parse, so skipping.`);
    return;
  }

  const run = runCheckCommand(command, targetWorkspace);
  const closing = run.code === 0 ? attemptSpecClose(gh, prd.number, children, closeSpec, log) : undefined;

  if (closing?.disagreement) {
    upsertPrdComment(gh, prd.number, comments, disagreementCommentBody(command, run, closing.result));
    log(
      `#${prd.number}: pass/closer disagreement: ran \`${command}\` exit ${run.code}, ` +
        `bin/close-ticket --spec exited ${closing.result.exitCode}.`,
    );
    return;
  }

  upsertPrdComment(gh, prd.number, comments, verdictCommentBody(command, run));
  if (hasOwnRefusal && hasNeedsHuman) {
    gh(["issue", "edit", String(prd.number), "--remove-label", NEEDS_HUMAN_LABEL]);
  }
  log(`#${prd.number}: ran \`${command}\`, exit ${run.code}.`);
}

const StandingIssue = z.object({
  number: z.number(),
  body: z.string().nullable(),
  comments: z.array(z.object({ body: z.string() })),
});

function readStandingIssue(gh: GhExec): z.infer<typeof StandingIssue> | undefined {
  const raw = gh([
    "issue",
    "list",
    "--state",
    "open",
    "--limit",
    String(ISSUE_PAGE_SIZE),
    "--json",
    "number,body,comments",
  ]);
  const issues = StandingIssue.array().parse(JSON.parse(raw));
  return issues.find((issue) => (issue.body ?? "").includes(FINDING_MARKER));
}

function retireStanding(gh: GhExec, log: (line: string) => void, dryRun: boolean): void {
  const standing = readStandingIssue(gh);
  if (!standing) return;

  if (dryRun) {
    log(`would close #${standing.number}: nothing is unreachable.`);
    return;
  }

  try {
    gh(["issue", "comment", String(standing.number), "--body", retirementBody()]);
    gh(["issue", "close", String(standing.number), "--reason", "completed"]);
    log(`closed #${standing.number}: nothing is unreachable.`);
  } catch (err) {
    log(`could not close #${standing.number}: ${reason(err)}`);
  }
}

function reportUnreachable(
  gh: GhExec,
  findings: UnreachableFinding[],
  log: (line: string) => void,
  dryRun: boolean,
): number[] {
  if (findings.length === 0) {
    retireStanding(gh, log, dryRun);
    return [];
  }

  const standing = readStandingIssue(gh);
  const said = standing
    ? [standing.body ?? "", ...standing.comments.map((comment) => comment.body)].join("\n")
    : "";
  const fresh = findings.filter((finding) => !alreadyNamed(said, finding.number));
  if (fresh.length === 0) {
    log(`every unreachable slice is already named on #${standing?.number}.`);
    return [];
  }

  if (fresh.length > MAX_UNREACHABLE_REPORTED) {
    log(
      `${fresh.length} unreachable slices found and only ${MAX_UNREACHABLE_REPORTED} will be named, and ` +
        "a backlog this size is more likely this reconciler being wrong than that many blockers " +
        "having been closed without delivering. The rest are listed above and were not filed.",
    );
  }
  const naming = fresh.slice(0, MAX_UNREACHABLE_REPORTED);

  if (dryRun) {
    for (const finding of naming) log(`would file ${entryLine(finding)}`);
    return naming.map((finding) => finding.number);
  }

  if (standing) {
    gh(["issue", "comment", String(standing.number), "--body", commentBody(naming)]);
    log(`commented on #${standing.number}: ${naming.length} unreachable slice(s).`);
  } else {
    const url = gh(["issue", "create", "--title", signalTitle(), "--body", signalBody(naming)]).trim();
    log(`opened ${url}: ${naming.length} unreachable slice(s).`);
  }
  return naming.map((finding) => finding.number);
}

export function runReconcile(input: ReconcileInput = {}): ReconcileOutcome {
  const gh = input.gh ?? execGh;
  const log = input.log ?? ((line: string) => console.log(line));
  const targetWorkspace = input.targetWorkspace ?? process.cwd();
  const closeSpec = input.closeSpec ?? ((number, range) => runRealSpecClose(number, range, targetWorkspace));
  const dryRun = input.dryRun ?? false;

  const stamps: Stamps = { lane: new Map(), relabelled: new Set() };

  const states = ticketState({ gh, log, dryRun, targetWorkspace });
  if (states.degraded !== undefined) {
    return { action: "degraded", checked: 0, dispatched: [], unreachable: [], note: states.degraded };
  }

  const { tickets, byNumber } = states;

  for (const ticket of tickets) {
    if (!ticket.isSpec) continue;
    if (ticket.children === undefined) {
      log(`could not read #${ticket.number}'s sub-issues, so skipping its spec check this run.`);
      continue;
    }
    if (ticket.children.length < 1) continue;
    if (dryRun) {
      log(`would evaluate #${ticket.number}'s spec check.`);
      continue;
    }
    try {
      evaluateSpecCheck(gh, ticket, ticket.children, log, closeSpec, targetWorkspace);
    } catch (err) {
      log(`could not evaluate #${ticket.number}'s spec check: ${reason(err)}`);
    }
  }

  for (const ticket of tickets) recordDoor(gh, ticket, log, dryRun, stamps);

  const startable = tickets.filter((ticket) => ticket.startable);
  const unreachable = startable.filter((ticket) => ticket.unreachable);

  const ready: TicketState[] = [];
  for (const ticket of startable) {
    if (!ticket.ready) continue;
    if (ticket.hold === "needs-human") {
      log(`#${ticket.number}: not dispatching; it carries \`${NEEDS_HUMAN_LABEL}\` and waits for a human.`);
      continue;
    }
    if (ticket.hold === "by-hand") {
      log(`#${ticket.number}: not dispatching; it carries \`${BY_HAND_LABEL}\` and only a human can build it.`);
      continue;
    }
    if (ticket.landedPr === undefined) {
      ready.push(ticket);
      continue;
    }
    log(
      `#${ticket.number}: not dispatching — its closing pull request #${ticket.landedPr} has already merged, ` +
        "but the ticket is still open: bin/close-ticket must have refused it. A human needs to fix the " +
        "criterion or close the ticket.",
    );
  }

  log(`${startable.length} startable issue(s) open; ${ready.length} ready, ${unreachable.length} unreachable.`);

  const dispatched: number[] = [];
  const authoring: number[] = [];
  const deciding: number[] = [];
  const logReads = { left: MAX_STRIKE_LOG_READS };
  for (const ticket of ready) {
    const wants = ticket.authored ? "ticket-ready" : "acceptance-wanted";

    if (dryRun) {
      log(`would dispatch ${wants} for #${ticket.number}.`);
      dispatched.push(ticket.number);
      continue;
    }
    try {
      const rung = climbLadder(gh, ticket, states.runs, logReads, log, stamps, ticket.authored ? undefined : authorRung);
      if (rung === "decision") {
        deciding.push(ticket.number);
        continue;
      }
      if (!ticket.authored) {
        const freshEyes = authorRung(rung) === "author-fresh-eyes";
        dispatchAcceptanceWanted(gh, ticket.number, true, false, freshEyes);
        authoring.push(ticket.number);
        markLane(gh, ticket.number, ACCEPTING_LABEL, ticket.labels);
        stamp(stamps, ticket.number, ACCEPTING_LABEL);
        dropToBuild(gh, ticket);
        log(
          `#${ticket.number} has no acceptance test naming its criteria, so asked lane 04 to author ` +
            `${freshEyes ? "again, handed every strike so far" : "first"}.`,
        );
        continue;
      }
      if (rung === "mechanic") dispatchMechanicWanted(gh, ticket.number);
      else dispatchTicketReady(gh, ticket.number, rung === "fresh-eyes");
      dispatched.push(ticket.number);
      markLane(gh, ticket.number, BUILDING_LABEL, ticket.labels);
      stamp(stamps, ticket.number, BUILDING_LABEL);
      dropToBuild(gh, ticket);
      log(`#${ticket.number}: dispatched rung ${rung}.`);
    } catch (err) {
      log(`could not dispatch #${ticket.number}: ${reason(err)}`);
    }
  }

  const touched = new Set([...dispatched, ...authoring, ...deciding]);
  const readyNumbers = new Set(ready.map((ticket) => ticket.number));
  for (const ticket of startable) {
    if (ticket.started || touched.has(ticket.number) || stamps.relabelled.has(ticket.number)) continue;
    const wanted = readyNumbers.has(ticket.number)
      ? QUEUED_LABEL
      : ticket.blockedBy.length > 0
        ? WAITING_LABEL
        : undefined;
    if (wanted === undefined || wearsLane(ticket.labels, wanted)) continue;
    if (dryRun) {
      log(`would mark #${ticket.number} ${wanted}.`);
      continue;
    }
    if (wanted === QUEUED_LABEL) markLane(gh, ticket.number, QUEUED_LABEL, ticket.labels);
    else markLane(gh, ticket.number, WAITING_LABEL, ticket.labels);
    stamp(stamps, ticket.number, wanted);
  }

  const laneOf = (number: number): readonly string[] => {
    const lane = stamps.lane.get(number);
    if (lane !== undefined) return [lane];
    return stamps.relabelled.has(number) ? [] : (byNumber.get(number)?.labels ?? []);
  };

  for (const ticket of tickets) {
    if (!ticket.isSpec || ticket.children === undefined || ticket.children.length === 0) continue;
    const line = rollupLine(
      countRollup(
        ticket.children.map((child) => ({
          open: child.state.toLowerCase() === "open",
          labels: laneOf(child.number),
        })),
      ),
    );
    if (readRollup(ticket.body) === line) continue;
    if (dryRun) {
      log(`would rewrite #${ticket.number}'s rollup: ${line}.`);
      continue;
    }
    try {
      writeRollup(gh, ticket.number, ticket.body, line);
      log(`#${ticket.number}: rewrote its rollup:v1 line: ${line}`);
    } catch (err) {
      log(`could not rewrite #${ticket.number}'s rollup:v1 line: ${reason(err)}`);
    }
  }

  const findings: UnreachableFinding[] = unreachable.map((ticket) => ({
    number: ticket.number,
    title: ticket.title,
    blockedBy: ticket.blockedBy,
  }));
  const filed = reportUnreachable(gh, findings, log, dryRun);

  if (dispatched.length === 0 && authoring.length === 0) {
    return {
      action: "clear",
      checked: startable.length,
      dispatched,
      unreachable: filed,
      note:
        deciding.length > 0
          ? `nothing dispatched: three strikes posted a decision for the owner on #${deciding.join(", #")}.`
          : `nothing became ready: ${startable.length} startable issue(s) open, none of them ready and unstarted.`,
    };
  }
  if (dispatched.length === 0) {
    return {
      action: "dispatched",
      checked: startable.length,
      dispatched,
      unreachable: filed,
      note: `asked lane 04 to author acceptance for #${authoring.join(", #")}.`,
    };
  }
  return {
    action: "dispatched",
    checked: startable.length,
    dispatched,
    unreachable: filed,
    note: `dispatched ticket-ready for #${dispatched.join(", #")}.`,
  };
}

function dropToBuild(gh: GhExec, ticket: TicketState): void {
  if (ticket.labels.includes(TO_BUILD_LABEL)) unlabel(gh, ticket.number, TO_BUILD_LABEL);
}

export function runRealSpecClose(number: number, range: string, targetWorkspace: string): CloseTicketResult {
  return closeTicketProcess(["--spec", String(number), range, targetWorkspace]);
}

function authorRung(following: Rung): Next {
  return following === "implementer" ? "author" : "author-fresh-eyes";
}

function climbLadder(
  gh: GhExec,
  ticket: TicketState,
  runs: LaneRun[],
  logReads: { left: number },
  log: (line: string) => void,
  stamps: Stamps,
  next?: (following: Rung) => Next,
): Rung {
  if (ticket.comments === undefined) {
    log(`#${ticket.number}: could not read its comments, so its strikes are unknown and rung one runs.`);
    return "implementer";
  }

  const strikes: Strike[] = [...ticket.strikes];
  for (const run of ticket.unstruck) {
    const conclusion = run.conclusion ?? "failure";
    const signature =
      logReads.left > 0 ? signatureFromLog(readFailedLog(gh, run.databaseId), conclusion) : `${conclusion} (log unread)`;
    logReads.left -= 1;
    const strike = { runId: run.databaseId, conclusion, signature };
    strikes.push(strike);
    const following = rungFor(strikes.length);
    const shown = following === "decision" ? following : (next?.(following) ?? following);
    gh(["issue", "comment", String(ticket.number), "--body", strikeBody(strike, run.url, shown)]);
    log(`#${ticket.number}: strike ${strikes.length} from run ${run.databaseId}: ${signature}`);
  }

  const rung = rungFor(strikes.length);
  if (rung === "decision") {
    const urlOf = (runId: number) => runs.find((run) => run.databaseId === runId)?.url ?? `run ${runId}`;
    gh(["issue", "comment", String(ticket.number), "--body", decisionBody(ticket.number, strikes, urlOf)]);
    escalateToOwner(gh, ticket.number, process.env.GITHUB_REPOSITORY_OWNER, ticket.labels);
    stamp(stamps, ticket.number);
    log(`#${ticket.number}: three strikes; posted the decision and stopped.`);
  }
  return rung;
}

export const WAKES_ON_LABELED: readonly string[] = [TO_BUILD_LABEL];

export const WAKES_ON_UNLABELED: readonly string[] = [NEEDS_HUMAN_LABEL, BY_HAND_LABEL];

export interface WakeEvent {
  eventName: string;
  action: string;
  label: string;
  senderIsOwner: boolean;
}

export function wakesReconciler(event: WakeEvent): boolean {
  if (event.eventName !== "issues") return true;
  if (!event.senderIsOwner) return false;
  if (event.action === "labeled") return WAKES_ON_LABELED.includes(event.label);
  if (event.action === "unlabeled") return WAKES_ON_UNLABELED.includes(event.label);
  return false;
}

function main(): void {
  const sender = process.env.EVENT_SENDER || "";
  const owner = process.env.GITHUB_REPOSITORY_OWNER || "";
  const wake: WakeEvent = {
    eventName: process.env.EVENT_NAME || "",
    action: process.env.EVENT_ISSUE_ACTION || "",
    label: process.env.EVENT_LABEL || "",
    senderIsOwner: sender !== "" && sender === owner,
  };
  if (!wakesReconciler(wake)) {
    console.log(`a ${wake.eventName} ${wake.action} of \`${wake.label}\` is not the owner's ready-set edit; nothing to do.`);
    return;
  }

  const eventAction = process.env.EVENT_ACTION || "";
  if (!RECONCILE_ENDINGS.some((action) => action === eventAction)) {
    console.log(
      `ending \`${eventAction}\` is not one of ` +
        `${RECONCILE_ENDINGS.map((action) => `\`${action}\``).join(" or ")}; nothing to do.`,
    );
    return;
  }
  const targetWorkspace = process.env.TARGET_WORKSPACE || process.cwd();
  const outcome = runReconcile({ dryRun: process.argv.includes("--dry-run"), targetWorkspace });
  console.log(`${outcome.action}: ${outcome.note}`);
  process.exit(outcome.action === "degraded" ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
