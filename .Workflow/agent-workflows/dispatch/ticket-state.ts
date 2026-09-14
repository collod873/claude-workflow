import { z } from "zod";
import type { GhExec } from "../shared/gh";
import { blockedByPath, comparePath, issueCommentsPath, matchingRefsPath, subIssuesPath } from "../shared/gh-paths";
import { isByHandClaim } from "../shared/immutable-set";
import { BY_HAND_LABEL, IDEA_LABEL, isLaneLabel, NEEDS_HUMAN_LABEL, PRD_LABEL, TO_BUILD_LABEL } from "../shared/labels";
import {
  implementationBranch,
  IMPLEMENTATION_BRANCH_PREFIX,
  readySlices,
  unreachableSlices,
  type Delivery,
  type SliceState,
} from "../shared/ready-set";
import { reason } from "../shared/reason";
import {
  deadRunsOf,
  fetchLaneRuns,
  recordedRunIds,
  strikesIn,
  ticketsInFlight,
  type LaneRun,
  type Strike,
} from "../shared/strikes";
import {
  assertTicketShape,
  extractCriteria,
  extractFilesClaimed,
  overWideClaim,
  parseCheckMarker,
  TicketShapeError,
} from "../shared/ticket-shape";

export const ISSUE_PAGE_SIZE = 100;

export const TO_BUILD_REFUSED_MARKER = "<!-- to-build-refused:v1 -->";

const COMPLETED = "completed";

const MERGED = "MERGED";

const CLOSING_RECORD_HEADING = "## Closing record";

const VERIFIED_COUNT = /^(\d+) of \d+ criteria verified/m;

const TRUSTED_ASSOCIATIONS = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);

const LANE_BOT = "github-actions[bot]";

const NEVER_BUILT = [PRD_LABEL, IDEA_LABEL];

const PARENT_PRD_HEADING = /^##[ \t]+Parent PRD[ \t]*$/m;

const OpenIssue = z.object({
  number: z.number(),
  title: z.string(),
  body: z.string().nullable(),
  labels: z.array(z.object({ name: z.string() })).optional(),
});
const OpenIssues = z.array(OpenIssue);
type OpenIssue = z.infer<typeof OpenIssue>;

const BlockerSchema = z.object({
  number: z.number(),
  state: z.string(),
  state_reason: z.string().nullable().optional(),
});
const Blockers = z.array(BlockerSchema);
export type Blocker = z.infer<typeof BlockerSchema>;

const ClosingPrNumbers = z.array(z.number());

const RecordComment = z.object({
  body: z.string(),
  author_association: z.string(),
  user: z.object({ login: z.string() }).nullable(),
});
const CommentPages = z.array(z.array(RecordComment));
type RecordComment = z.infer<typeof RecordComment>;

const IssueCommentSchema = z.object({ id: z.number(), body: z.string() });
const IssueComments = z.array(IssueCommentSchema);
export type IssueComment = z.infer<typeof IssueCommentSchema>;

const Refs = z.array(z.string());

const PrHeads = z.array(z.object({ headRefName: z.string() }));

export type Door =
  | { verdict: "none" }
  | { verdict: "admit" }
  | { verdict: "stand-down"; labelled: boolean }
  | { verdict: "slice"; claimed: number }
  | { verdict: "refuse"; refusal: string }
  | { verdict: "clear" };

export type Hold = "needs-human" | "by-hand";

export type Stage = "busy" | "in-review" | "needs-build" | "needs-test";

export interface TicketState extends SliceState {
  title: string;
  body: string;
  labels: string[];
  door: Door;
  hold: Hold | undefined;
  startable: boolean;
  ready: boolean;
  unreachable: boolean;
  stage: Stage;
  landedPr: number | undefined;
  isSpec: boolean;
  children: Blocker[] | undefined;
  comments: IssueComment[] | undefined;
  strikes: Strike[];
  unstruck: LaneRun[];
}

export interface TicketStateInput {
  gh: GhExec;
  log: (line: string) => void;
  dryRun: boolean;
}

export interface TicketStates {
  degraded: string | undefined;
  tickets: TicketState[];
  byNumber: Map<number, TicketState>;
  runs: LaneRun[];
}

export function labelNames(issue: { labels?: Array<{ name: string }> }): string[] {
  return (issue.labels ?? []).map((label) => label.name);
}

export function markedComment(comments: IssueComment[], ...markers: string[]): IssueComment | undefined {
  return comments.find((comment) => markers.some((marker) => comment.body.includes(marker)));
}

function fetchOpenIssues(gh: GhExec, log: (line: string) => void): OpenIssue[] | null {
  try {
    const raw = gh([
      "issue",
      "list",
      "--state",
      "open",
      "--limit",
      String(ISSUE_PAGE_SIZE),
      "--json",
      "number,title,body,labels",
    ]);
    const parsed = OpenIssues.safeParse(JSON.parse(raw));
    if (!parsed.success) return null;
    if (parsed.data.length >= ISSUE_PAGE_SIZE) {
      log(
        `one page of open issues is full at ${ISSUE_PAGE_SIZE}, and a blocker past the page boundary ` +
          "reads as unseen, which leaves its dependents blocked rather than dispatched.",
      );
    }
    return parsed.data;
  } catch {
    return null;
  }
}

function fetchBlockers(gh: GhExec, number: number): Blocker[] | null {
  try {
    const raw = gh(["api", blockedByPath(number), "--jq", "[.[] | {number, state, state_reason}]"]);
    const parsed = Blockers.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function fetchChildren(gh: GhExec, number: number): Blocker[] | null {
  try {
    const raw = gh(["api", subIssuesPath(number), "--jq", "[.[] | {number, state, state_reason}]"]);
    const parsed = Blockers.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function fetchComments(gh: GhExec, number: number): IssueComment[] | null {
  try {
    const raw = gh(["api", issueCommentsPath(number)]);
    const parsed = IssueComments.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function closedByMergedPr(gh: GhExec, number: number): boolean {
  return mergedCloser(gh, number) !== undefined;
}

export function mergedCloser(gh: GhExec, number: number): number | undefined {
  let closers: number[];
  try {
    const raw = gh([
      "issue",
      "view",
      String(number),
      "--json",
      "closedByPullRequestsReferences",
      "--jq",
      "[.closedByPullRequestsReferences[].number]",
    ]);
    const parsed = ClosingPrNumbers.safeParse(JSON.parse(raw));
    if (!parsed.success) return undefined;
    closers = parsed.data;
  } catch {
    return undefined;
  }
  return closers.find((pr) => prIsMerged(gh, pr));
}

export function carriesVerifiedClosingRecord(comments: RecordComment[]): boolean {
  return comments.some(
    (comment) =>
      (TRUSTED_ASSOCIATIONS.has(comment.author_association) || comment.user?.login === LANE_BOT) &&
      comment.body.startsWith(CLOSING_RECORD_HEADING) &&
      Number(VERIFIED_COUNT.exec(comment.body)?.[1] ?? 0) > 0,
  );
}

function closedByVerifiedRecord(gh: GhExec, number: number): boolean {
  try {
    const parsed = CommentPages.safeParse(JSON.parse(gh(["api", issueCommentsPath(number), "--paginate", "--slurp"])));
    return parsed.success && carriesVerifiedClosingRecord(parsed.data.flat());
  } catch {
    return false;
  }
}

function prIsMerged(gh: GhExec, pr: number): boolean {
  try {
    return gh(["pr", "view", String(pr), "--json", "state", "--jq", ".state"]).trim() === MERGED;
  } catch {
    return false;
  }
}

function fetchClaimedBranches(gh: GhExec): Set<string> | null {
  try {
    const raw = gh(["api", matchingRefsPath(IMPLEMENTATION_BRANCH_PREFIX), "--jq", "[.[].ref]"]);
    const parsed = Refs.safeParse(JSON.parse(raw));
    if (!parsed.success) return null;
    return new Set(parsed.data.map((ref) => ref.replace(/^refs\/heads\//, "")));
  } catch {
    return null;
  }
}

function commitsAhead(gh: GhExec, branch: string, base: string): number {
  const ahead = (JSON.parse(gh(["api", comparePath(base, branch)])) as { ahead_by?: unknown }).ahead_by;
  return typeof ahead === "number" ? ahead : 1;
}

function fetchOpenPrBranches(gh: GhExec): Set<string> | null {
  try {
    const raw = gh(["pr", "list", "--state", "open", "--limit", String(ISSUE_PAGE_SIZE), "--json", "headRefName"]);
    const parsed = PrHeads.safeParse(JSON.parse(raw));
    if (!parsed.success) return null;
    return new Set(parsed.data.map((pr) => pr.headRefName));
  } catch {
    return null;
  }
}

export function deliveryOf(blocker: Blocker, shipped: () => boolean): Delivery {
  if (blocker.state.toLowerCase() === "open") return "open";
  if ((blocker.state_reason ?? "").toLowerCase() !== COMPLETED) return "undelivered";
  return shipped() ? "delivered" : "undelivered";
}

interface Progress {
  inFlight: Set<number>;
  claimed: Set<string>;
  openPrBranches: Set<string>;
}

function stageOf(gh: GhExec, number: number, progress: Progress, log: (line: string) => void): Stage {
  if (progress.inFlight.has(number)) return "busy";
  const branch = implementationBranch(number);
  if (!progress.claimed.has(branch)) return "needs-test";
  if (progress.openPrBranches.has(branch)) return "in-review";
  try {
    if (commitsAhead(gh, branch, "main") > 0) return "needs-build";
  } catch (err) {
    log(`#${number}: could not read what \`${branch}\` carries, so it is left alone this pass: ${reason(err)}`);
    return "busy";
  }
  log(`#${number}: \`${branch}\` stands with nothing on it, so it is a bare claim and the ticket still wants a test.`);
  return "needs-test";
}

function startedTicket(stage: Stage): boolean {
  return stage === "busy" || stage === "in-review";
}

function buildGraph(
  gh: GhExec,
  issues: OpenIssue[],
  stages: Map<number, Stage>,
  log: (line: string) => void,
): SliceState[] | null {
  const states = new Map<number, SliceState>();
  const deliveryCache = new Map<number, Delivery>();

  for (const issue of issues) {
    const blockers = fetchBlockers(gh, issue.number);
    if (blockers === null) {
      log(`could not read the blocked-by edges of #${issue.number}.`);
      return null;
    }
    states.set(issue.number, {
      number: issue.number,
      blockedBy: blockers.map((blocker) => blocker.number),
      delivery: "open",
      started: startedTicket(stages.get(issue.number) ?? "needs-test"),
    });
    for (const blocker of blockers) {
      if (deliveryCache.has(blocker.number)) continue;
      deliveryCache.set(
        blocker.number,
        deliveryOf(blocker, () => closedByMergedPr(gh, blocker.number) || closedByVerifiedRecord(gh, blocker.number)),
      );
    }
  }

  for (const [number, delivery] of deliveryCache) {
    if (states.has(number)) continue;
    states.set(number, { number, blockedBy: [], delivery, started: false });
  }

  return [...states.values()];
}

export function toBuildRefusal(body: string): string | undefined {
  try {
    assertTicketShape(body);
  } catch (err) {
    if (err instanceof TicketShapeError) return err.message;
    throw err;
  }

  if (!extractCriteria(body).some((criterion) => parseCheckMarker(criterion) !== undefined)) {
    return (
      "none of its acceptance criteria carry a `check:` marker, the same line " +
      "`bin/close-ticket` refuses at close: add `- check: `<command>`` to at least one criterion"
    );
  }
  return undefined;
}

function admittedByLaneLabel(labels: string[], body: string): boolean {
  if (!labels.some(isLaneLabel) || labels.some((label) => NEVER_BUILT.includes(label))) return false;
  if (isByHandClaim(extractFilesClaimed(body))) return false;
  return toBuildRefusal(body) === undefined;
}

export function doorOf(labels: string[], body: string, started: boolean): Door {
  if (started) return { verdict: "none" };
  if (!labels.includes(TO_BUILD_LABEL)) {
    return admittedByLaneLabel(labels, body) ? { verdict: "admit" } : { verdict: "none" };
  }

  const labelled = labels.includes(BY_HAND_LABEL);
  if (labelled || isByHandClaim(extractFilesClaimed(body))) return { verdict: "stand-down", labelled };

  const claimed = overWideClaim(body);
  if (claimed !== undefined) return { verdict: "slice", claimed };

  const refusal = toBuildRefusal(body);
  if (refusal !== undefined) return { verdict: "refuse", refusal };

  return labels.includes(NEEDS_HUMAN_LABEL) ? { verdict: "clear" } : { verdict: "admit" };
}

const DOOR_SPEAKS: ReadonlySet<Door["verdict"]> = new Set(["stand-down", "slice", "refuse", "clear"]);

function heldBeforeTheDoorSpoke(ticket: TicketState): boolean {
  if (ticket.labels.includes(NEEDS_HUMAN_LABEL) && ticket.door.verdict !== "clear") return true;
  return ticket.labels.includes(BY_HAND_LABEL);
}

function wantsComments(ticket: TicketState, dryRun: boolean): boolean {
  if (dryRun) return false;
  if (ticket.isSpec && (ticket.children?.length ?? 0) >= 1) return true;
  if (DOOR_SPEAKS.has(ticket.door.verdict)) return true;
  return ticket.ready && ticket.startable && ticket.landedPr === undefined && !heldBeforeTheDoorSpoke(ticket);
}

function holdOf(ticket: TicketState): Hold | undefined {
  const lifted =
    ticket.door.verdict === "clear" &&
    ticket.comments !== undefined &&
    markedComment(ticket.comments, TO_BUILD_REFUSED_MARKER) !== undefined;
  if (ticket.labels.includes(NEEDS_HUMAN_LABEL) && !lifted) return "needs-human";
  if (ticket.labels.includes(BY_HAND_LABEL) || ticket.door.verdict === "stand-down") return "by-hand";
  return undefined;
}

function unreadable(note: string): TicketStates {
  return { degraded: note, tickets: [], byNumber: new Map(), runs: [] };
}

export function ticketState(input: TicketStateInput): TicketStates {
  const { gh, log, dryRun } = input;

  const issues = fetchOpenIssues(gh, log);
  if (issues === null) return unreadable("the tracker did not return a readable list of open issues.");

  const claimed = fetchClaimedBranches(gh);
  if (claimed === null) {
    return unreadable(
      `the refs API did not return a readable list under \`${IMPLEMENTATION_BRANCH_PREFIX}\`, and ` +
        "without it every slice reads as unstarted.",
    );
  }

  const openPrBranches = fetchOpenPrBranches(gh);
  if (openPrBranches === null) {
    return unreadable(
      "the pull request list could not be read, and without it a ticket already in review reads as one " +
        "waiting to be built.",
    );
  }

  const fetchedRuns = fetchLaneRuns(gh);
  if (fetchedRuns === null) {
    log("the runs API did not return a readable list, so every ticket in flight reads as unstarted this pass.");
  }
  const runs = fetchedRuns ?? [];

  const progress: Progress = { inFlight: ticketsInFlight(runs), claimed, openPrBranches };
  const stages = new Map(issues.map((issue) => [issue.number, stageOf(gh, issue.number, progress, log)]));

  const graph = buildGraph(gh, issues, stages, log);
  if (graph === null) return unreadable("the dependency graph could not be read for every open issue.");

  const slices = new Map(graph.map((slice) => [slice.number, slice]));
  const ready = new Set(readySlices(graph).map((slice) => slice.number));
  const unreached = new Set(unreachableSlices(graph).map((slice) => slice.number));

  const tickets = issues.map((issue): TicketState => {
    const labels = labelNames(issue);
    const body = issue.body ?? "";
    const slice = slices.get(issue.number) as SliceState;
    const stage = stages.get(issue.number) ?? "needs-test";
    const door = doorOf(labels, body, startedTicket(stage));
    const admitted = door.verdict === "admit" || door.verdict === "clear";
    return {
      ...slice,
      title: issue.title,
      body,
      labels,
      door,
      hold: undefined,
      startable: PARENT_PRD_HEADING.test(body) || admitted,
      ready: ready.has(issue.number),
      unreachable: unreached.has(issue.number),
      stage,
      landedPr: undefined,
      isSpec: labels.includes(PRD_LABEL),
      children: undefined,
      comments: undefined,
      strikes: [],
      unstruck: [],
    };
  });

  for (const ticket of tickets) {
    if (ticket.isSpec) ticket.children = fetchChildren(gh, ticket.number) ?? undefined;
    if (ticket.ready && ticket.startable && !heldBeforeTheDoorSpoke(ticket)) {
      ticket.landedPr = mergedCloser(gh, ticket.number);
    }
    if (wantsComments(ticket, dryRun)) ticket.comments = fetchComments(gh, ticket.number) ?? undefined;
    ticket.hold = holdOf(ticket);
    if (ticket.comments === undefined) continue;
    const bodies = ticket.comments.map((comment) => comment.body);
    const recorded = recordedRunIds(bodies);
    ticket.strikes = strikesIn(bodies);
    ticket.unstruck = deadRunsOf(runs, ticket.number)
      .filter((run) => !recorded.has(run.databaseId))
      .sort((a, b) => a.databaseId - b.databaseId);
  }

  return { degraded: undefined, tickets, byNumber: new Map(tickets.map((ticket) => [ticket.number, ticket])), runs };
}
