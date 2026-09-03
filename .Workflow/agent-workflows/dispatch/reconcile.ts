import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { closeTicketProcess, type CloseTicketResult } from "../shared/close-ticket";
import { execGh, type GhExec } from "../shared/gh";
import {
  blockedByPath,
  issueCommentPath,
  issueCommentsPath,
  matchingRefsPath,
  subIssuesPath,
} from "../shared/gh-paths";
import { touchesImmutableSet } from "../shared/immutable-set";
import { testsForCriteria } from "../shared/affected-tests";
import {
  dispatchAcceptanceWanted,
  dispatchTicketReady,
  GRAPH_CHANGED_DISPATCH_ACTION,
  implementationBranch,
  IMPLEMENTATION_BRANCH_PREFIX,
  readySlices,
  unreachableSlices,
  type Delivery,
  type SliceState,
} from "../shared/ready-set";
import { reason } from "../shared/reason";
import {
  countCriteria,
  extractCriteria,
  extractFilesClaimed,
  isRunnableSpec,
  parseCheckMarker,
  TicketShapeError,
  validateTicket,
} from "../shared/ticket-shape";
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

export const RECONCILE_DISPATCH_ACTIONS = [
  SESSION_CAPTURED_DISPATCH_ACTION,
  GRAPH_CHANGED_DISPATCH_ACTION,
] as const;

export const ISSUE_PAGE_SIZE = 100;

const MAX_UNREACHABLE_REPORTED = 10;

const PARENT_PRD_HEADING = /^##[ \t]+Parent PRD[ \t]*$/m;

export const TO_BUILD_LABEL = "to-build";

const TO_BUILD_REFUSED_MARKER = "<!-- to-build-refused:v1 -->";

const COMPLETED = "completed";

const MERGED = "MERGED";

const OpenIssue = z.object({
  number: z.number(),
  title: z.string(),
  body: z.string().nullable(),
  labels: z.array(z.object({ name: z.string() })).optional(),
});
const OpenIssues = z.array(OpenIssue);
type OpenIssue = z.infer<typeof OpenIssue>;

const Blocker = z.object({
  number: z.number(),
  state: z.string(),
  state_reason: z.string().nullable().optional(),
});
const Blockers = z.array(Blocker);
type Blocker = z.infer<typeof Blocker>;

const ClosingPrNumbers = z.array(z.number());
const Refs = z.array(z.string());

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

export function closedByMergedPr(gh: GhExec, number: number): boolean {
  return mergedCloser(gh, number) !== undefined;
}

function mergedCloser(gh: GhExec, number: number): number | undefined {
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

export function deliveryOf(blocker: Blocker, byMergedPr: () => boolean): Delivery {
  if (blocker.state.toLowerCase() === "open") return "open";
  if ((blocker.state_reason ?? "").toLowerCase() !== COMPLETED) return "undelivered";
  return byMergedPr() ? "delivered" : "undelivered";
}

function buildGraph(
  gh: GhExec,
  issues: OpenIssue[],
  claimed: Set<string>,
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
      started: claimed.has(implementationBranch(issue.number)),
    });
    for (const blocker of blockers) {
      if (deliveryCache.has(blocker.number)) continue;
      deliveryCache.set(
        blocker.number,
        deliveryOf(blocker, () => closedByMergedPr(gh, blocker.number)),
      );
    }
  }

  for (const [number, delivery] of deliveryCache) {
    if (states.has(number)) continue;
    states.set(number, { number, blockedBy: [], delivery, started: false });
  }

  return [...states.values()];
}

function startableNumbers(issues: OpenIssue[], admitted: Set<number>): Set<number> {
  return new Set(
    issues
      .filter((issue) => PARENT_PRD_HEADING.test(issue.body ?? "") || admitted.has(issue.number))
      .map((issue) => issue.number),
  );
}

function toBuildRefusal(body: string): string | undefined {
  try {
    validateTicket(body);
  } catch (err) {
    if (err instanceof TicketShapeError) return err.message;
    throw err;
  }

  const claimed = extractFilesClaimed(body).filter((path) => touchesImmutableSet([path]));
  if (claimed.length > 0) {
    return `its \`## Files claimed\` touches paths no pull request may edit: ${claimed.join(", ")}`;
  }
  return undefined;
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

const TO_BUILD_CLEARED_BODY = [
  "This ticket's shape is no longer refused: it carries both headings lane 06 needs, so the",
  "recompute that read this will start it as soon as every blocker has delivered.",
].join("\n");

function recordToBuildShape(
  gh: GhExec,
  number: number,
  refusal: string | undefined,
  log: (line: string) => void,
): void {
  const comments = fetchComments(gh, number);
  if (comments === null) {
    log(`could not read #${number}'s comments, so leaving whatever this door said last run standing.`);
    return;
  }
  const standing = markedComment(comments, TO_BUILD_REFUSED_MARKER);

  if (refusal === undefined) {
    if (standing === undefined) return;
    rewriteComment(gh, standing.id, TO_BUILD_CLEARED_BODY);
    log(`#${number}: its shape is no longer refused at the ${TO_BUILD_LABEL} door.`);
    return;
  }

  const body = toBuildRefusalBody(refusal);
  if (standing?.body === body) return;
  if (standing) rewriteComment(gh, standing.id, body);
  else gh(["issue", "comment", String(number), "--body", body]);
  log(`#${number}: refused at the ${TO_BUILD_LABEL} door: ${refusal}.`);
}

function admitToBuild(
  gh: GhExec,
  issues: OpenIssue[],
  log: (line: string) => void,
  dryRun: boolean,
): Set<number> {
  const admitted = new Set<number>();
  for (const issue of issues) {
    if (!(issue.labels ?? []).some((label) => label.name === TO_BUILD_LABEL)) continue;

    const refusal = toBuildRefusal(issue.body ?? "");
    if (refusal === undefined) admitted.add(issue.number);

    if (dryRun) {
      if (refusal !== undefined) log(`would refuse #${issue.number} at the ${TO_BUILD_LABEL} door: ${refusal}.`);
      continue;
    }
    try {
      recordToBuildShape(gh, issue.number, refusal, log);
    } catch (err) {
      log(`could not record #${issue.number}'s shape verdict: ${reason(err)}`);
    }
  }
  return admitted;
}

const PRD_LABEL = "prd";

const NEEDS_HUMAN_LABEL = "needs-human";

const PRD_CHECK_MARKER = "<!-- prd-check:v1 -->";

const PRD_UNRUNNABLE_MARKER = "<!-- prd-unrunnable:v1 -->";

const IssueComment = z.object({ id: z.number(), body: z.string() });
type IssueComment = z.infer<typeof IssueComment>;
const IssueComments = z.array(IssueComment);

const SubIssueList = z.array(z.object({ number: z.number() }));

function rewriteComment(gh: GhExec, id: number, body: string): void {
  gh(["api", issueCommentPath(id), "-X", "PATCH", "-f", `body=${body}`]);
}

function fetchComments(gh: GhExec, number: number): IssueComment[] | null {
  try {
    const raw = gh(["api", issueCommentsPath(number)]);
    const parsed = IssueComments.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function markedComment(comments: IssueComment[], ...markers: string[]): IssueComment | undefined {
  return comments.find((comment) => markers.some((marker) => comment.body.includes(marker)));
}

function fetchSubIssueCount(gh: GhExec, number: number): number | null {
  try {
    const raw = gh(["api", subIssuesPath(number)]);
    const parsed = SubIssueList.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data.length : null;
  } catch {
    return null;
  }
}

function fetchChildren(gh: GhExec, number: number): Blocker[] | null {
  try {
    const raw = gh(["api", subIssuesPath(number), "--jq", "[.[] | {number, state, state_reason}]"]);
    const parsed = Blockers.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
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
  closeSpec: (number: number, range: string) => CloseTicketResult,
  log: (line: string) => void,
): SpecClosingAttempt | undefined {
  const children = fetchChildren(gh, prdNumber);
  if (children === null) {
    log(`could not read #${prdNumber}'s sub-issues for its own closing attempt.`);
    return undefined;
  }
  if (children.length === 0) return undefined;

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
  return [`Could not run this spec's check: ${unrunnableReason(body)}.`, "", PRD_UNRUNNABLE_MARKER].join(
    "\n",
  );
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

interface PrdCheckCandidate {
  number: number;
  body: string;
  labels: string[];
}

function evaluateSpecCheck(
  gh: GhExec,
  prd: PrdCheckCandidate,
  log: (line: string) => void,
  closeSpec: (number: number, range: string) => CloseTicketResult,
  targetWorkspace: string,
): void {
  const comments = fetchComments(gh, prd.number);
  if (comments === null) {
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
  const closing = run.code === 0 ? attemptSpecClose(gh, prd.number, closeSpec, log) : undefined;

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

function criteriaOf(issue: OpenIssue | undefined): string[] {
  return issue ? extractCriteria(issue.body ?? "") : [];
}

export function runReconcile(input: ReconcileInput = {}): ReconcileOutcome {
  const gh = input.gh ?? execGh;
  const log = input.log ?? ((line: string) => console.log(line));
  const targetWorkspace = input.targetWorkspace ?? process.cwd();
  const closeSpec = input.closeSpec ?? ((number, range) => runRealSpecClose(number, range, targetWorkspace));

  const degraded = (note: string): ReconcileOutcome => ({
    action: "degraded",
    checked: 0,
    dispatched: [],
    unreachable: [],
    note,
  });

  const issues = fetchOpenIssues(gh, log);
  if (issues === null) return degraded("the tracker did not return a readable list of open issues.");

  const claimed = fetchClaimedBranches(gh);
  if (claimed === null) {
    return degraded(
      `the refs API did not return a readable list under \`${IMPLEMENTATION_BRANCH_PREFIX}\`, and ` +
        "without it every slice reads as unstarted.",
    );
  }

  const graph = buildGraph(gh, issues, claimed, log);
  if (graph === null) return degraded("the dependency graph could not be read for every open issue.");

  for (const issue of issues) {
    const labels = (issue.labels ?? []).map((each) => each.name);
    if (!labels.includes(PRD_LABEL)) continue;

    const subIssueCount = fetchSubIssueCount(gh, issue.number);
    if (subIssueCount === null) {
      log(`could not read #${issue.number}'s sub-issues, so skipping its spec check this run.`);
      continue;
    }
    if (subIssueCount < 1) continue;

    if (input.dryRun) {
      log(`would evaluate #${issue.number}'s spec check.`);
      continue;
    }

    try {
      evaluateSpecCheck(gh, { number: issue.number, body: issue.body ?? "", labels }, log, closeSpec, targetWorkspace);
    } catch (err) {
      log(`could not evaluate #${issue.number}'s spec check: ${reason(err)}`);
    }
  }

  const startable = startableNumbers(issues, admitToBuild(gh, issues, log, input.dryRun ?? false));
  const byNumber = new Map(issues.map((issue) => [issue.number, issue]));

  const ready = readySlices(graph).filter((state) => startable.has(state.number));
  const unreachable = unreachableSlices(graph).filter((state) => startable.has(state.number));

  log(`${startable.size} startable issue(s) open; ${ready.length} ready, ${unreachable.length} unreachable.`);

  const dispatched: number[] = [];
  const authoring: number[] = [];
  for (const state of ready) {
    const authored = testsForCriteria(criteriaOf(byNumber.get(state.number)), targetWorkspace);
    const wants = authored.length === 0 ? "acceptance-wanted" : "ticket-ready";

    if (input.dryRun) {
      log(`would dispatch ${wants} for #${state.number}.`);
      dispatched.push(state.number);
      continue;
    }
    try {
      if (wants === "acceptance-wanted") {
        dispatchAcceptanceWanted(gh, state.number, true);
        authoring.push(state.number);
        log(`#${state.number} has no acceptance test naming its criteria, so asked lane 04 to author first.`);
        continue;
      }
      dispatchTicketReady(gh, state.number);
      dispatched.push(state.number);
    } catch (err) {
      log(`could not dispatch #${state.number}: ${reason(err)}`);
    }
  }

  const findings: UnreachableFinding[] = unreachable.map((state) => ({
    number: state.number,
    title: byNumber.get(state.number)?.title ?? `#${state.number}`,
    blockedBy: state.blockedBy,
  }));
  const filed = reportUnreachable(gh, findings, log, input.dryRun ?? false);

  if (dispatched.length === 0 && authoring.length === 0) {
    return {
      action: "clear",
      checked: startable.size,
      dispatched,
      unreachable: filed,
      note: `nothing became ready: ${startable.size} startable issue(s) open, none of them ready and unstarted.`,
    };
  }
  if (dispatched.length === 0) {
    return {
      action: "dispatched",
      checked: startable.size,
      dispatched,
      unreachable: filed,
      note: `asked lane 04 to author acceptance for #${authoring.join(", #")}.`,
    };
  }
  return {
    action: "dispatched",
    checked: startable.size,
    dispatched,
    unreachable: filed,
    note: `dispatched ticket-ready for #${dispatched.join(", #")}.`,
  };
}

export function runRealSpecClose(number: number, range: string, targetWorkspace: string): CloseTicketResult {
  return closeTicketProcess(["--spec", String(number), range, targetWorkspace]);
}

function main(): void {
  const eventAction = process.env.EVENT_ACTION || "";
  if (!RECONCILE_DISPATCH_ACTIONS.some((action) => action === eventAction)) {
    console.log(
      `dispatch action \`${eventAction}\` is not one of ` +
        `${RECONCILE_DISPATCH_ACTIONS.map((action) => `\`${action}\``).join(" or ")}; nothing to do.`,
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
