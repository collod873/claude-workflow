import { pathToFileURL } from "node:url";
import { z } from "zod";
import { execGh, type GhExec } from "../shared/gh";
import { blockedByPath, matchingRefsPath } from "../shared/gh-paths";
import {
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
  alreadyNamed,
  commentBody,
  entryLine,
  FINDING_MARKER,
  signalBody,
  signalTitle,
  type UnreachableFinding,
} from "../watchdog/unreachable";

/**
 * Lane 09: the readiness reconciler (#179).
 *
 * **The ready set is recomputed, never pushed.** Nothing sent the second wave — `dispatchReadySlices`
 * answered readiness once, at publish, with the constant `dependsOn.length === 0` folded into the
 * predicate — so a 26-slice plan started however many roots it had and stopped. The repair is not a
 * new sender in lane 08. It is to unfold the constant and run the resulting predicate more than once,
 * which is what this file does: it recomputes the ready set across the tracker from durable state
 * alone and dispatches `ticket-ready` for everything in it that has not been started.
 *
 * **Why a reconciler rather than lane 08 promoting.** #178 named the
 * [ADR-0069](../../../docs/adr/0069-the-dependency-graph-is-lane-03-s-output-and-read-only-downs.md)
 * problem correctly — lane 08 asking the dependencies API is a second lane reasoning about the graph
 * — and then accepted it as the price of putting the sender at the merge. It is not a price that has
 * to be paid. Lane 08 sends a doorbell and never reads the graph; the reader is this, and it writes
 * nothing to the graph. ADR-0069 is applied, not amended.
 *
 * **Why session end is the correct floor**, and why it is a stronger case here than the one
 * [ADR-0048](../../../docs/adr/0048-the-close-gate-s-reconciler-rides-session-end-because-a-cron.md)
 * and
 * [ADR-0049](../../../docs/adr/0049-the-run-watchdog-sweeps-on-session-end-because-workflow-run.md)
 * already made. It cannot fire vacuously — a slice can only become ready if a merge happened, and
 * merges only happen during work — so no
 * [ADR-0004](../../../docs/adr/0004-a-clock-may-release-a-batch-but-may-never-originate-work.md)
 * exception is needed. And ADR-0049's real criterion, *whether the evidence a mechanism reads
 * outlives the failure*, is met here completely: the dependency graph, every blocker's close state
 * and every slice's branch are durable API objects. **There is nothing to replay and nothing to
 * reconstruct.** ADR-0048's reconciler could not say that — it had to reconstruct a verdict that
 * was never recorded, which is one of the reasons #185 retired it along with the venue that
 * needed it.
 *
 * **Recomputes, stores nothing.** No cursor, no ledger, no state file. Every run derives its whole
 * answer from the tracker, so nothing it says can go stale and it cannot feed on its own output — a
 * slice it dispatched has a branch ref by the time the next run looks, so the next run simply does
 * not see it.
 */

/**
 * The correctness floor: the capture hook's own dispatch, the same one `audit.yml` and
 * `run-watchdog.yml` ride. Spelled here and in `dispatch-reconcile.yml`'s job-level
 * `if` — no compiler sees across that boundary, so `reconcile.test.ts` asserts the two still agree,
 * and `capture/dispatch-action.test.ts` holds this to the string the emitter actually sends.
 */
export const SESSION_CAPTURED_DISPATCH_ACTION = "session-captured";

/**
 * Both actions this lane answers, in the order they matter.
 *
 * `session-captured` is the floor and `graph-changed` is a latency hint: lose the hint and this
 * still finds the same ready set at the next session end, so the cost is minutes-to-one-session
 * rather than correctness. That asymmetry is the whole reason a second dispatch is allowed here
 * when ADR-0049 refused one — its dispatch would have been load-bearing, and *"a second dispatch is
 * a second thing that can silently stop arriving (#107 is what that looks like)"* bites a mechanism,
 * not a hint.
 *
 * The honest cost of dropping the hint entirely is depth: a chain of depth *n* would need *n*
 * wake-ups. That is what the hint buys and the only thing it buys.
 */
export const RECONCILE_DISPATCH_ACTIONS = [
  SESSION_CAPTURED_DISPATCH_ACTION,
  GRAPH_CHANGED_DISPATCH_ACTION,
] as const;

/**
 * One page of open issues. This repo has never held more than a few dozen open at once and a
 * 26-slice plan is the largest fan-out lane 03 has produced; a hundred covers both several times
 * over. A page that fills is logged rather than left to look like a complete graph.
 */
export const ISSUE_PAGE_SIZE = 100;

/**
 * The most unreachable slices one run will file. A report of forty is this reconciler describing
 * its own defect rather than a real backlog, and ADR-0064's bounded touch stops being bounded. What
 * it declines to name is logged — a cap nobody is told about reads as "there was nothing else".
 */
const MAX_UNREACHABLE_REPORTED = 10;

/**
 * The trace that says lane 03 published this issue as a slice: `shared/render-body.ts` writes the
 * `## Parent PRD` heading onto every ticket it renders and onto nothing else.
 *
 * **This is the scope rule, and it is a safety rule.** Being in the graph is what makes an issue
 * *ready*; being a published slice is what makes it something an implementer may be started
 * against. Without this, a hand-written issue that happens to carry a blocked-by edge — or any
 * unblocked issue at all — would have a Sonnet implementer pointed at it and a pull request opened.
 * The graph is read wide, so transitive unreachability is computed correctly across every open
 * issue; only what lane 03 published is ever acted on.
 */
const PARENT_PRD_HEADING = /^##[ \t]+Parent PRD[ \t]*$/m;

/** The `state_reason` GitHub reports for a delivery claim, as the REST dependencies API spells it. */
const COMPLETED = "completed";

/** A pull request state, as `gh issue view --json closedByPullRequestsReferences` spells a merge. */
const MERGED = "MERGED";

const OpenIssue = z.object({
  number: z.number(),
  title: z.string(),
  body: z.string().nullable(),
});
const OpenIssues = z.array(OpenIssue);
type OpenIssue = z.infer<typeof OpenIssue>;

/** One edge as the dependencies API returns it: the blocker, with enough of its own state to judge it. */
const Blocker = z.object({
  number: z.number(),
  state: z.string(),
  state_reason: z.string().nullable().optional(),
});
const Blockers = z.array(Blocker);
type Blocker = z.infer<typeof Blocker>;

const ClosingPrStates = z.array(z.string());
const Refs = z.array(z.string());

export interface ReconcileInput {
  gh?: GhExec;
  log?: (line: string) => void;
  /**
   * Read and report, dispatch nothing and file nothing. Not a safety valve — the workflow never
   * sets it — but the way this answer stays checkable: "it dispatches nothing when every wave has
   * already started" needs a command a reader can run again next year against live state, and the
   * only honest one is this reconciler itself.
   */
  dryRun?: boolean;
}

export interface ReconcileOutcome {
  /**
   * `degraded` is the only red run: it means this could not read its own inputs. A reconciler that
   * fails silently is the second sender nobody watches, which is the defect it exists to repair.
   */
  action: "clear" | "dispatched" | "degraded";
  /** Published slices considered. */
  checked: number;
  dispatched: number[];
  unreachable: number[];
  note: string;
}

/** Every open issue in the window — the whole graph, not only the published slices in it. */
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
      "number,title,body",
    ]);
    const parsed = OpenIssues.safeParse(JSON.parse(raw));
    if (!parsed.success) return null;
    if (parsed.data.length >= ISSUE_PAGE_SIZE) {
      log(
        `one page of open issues is full at ${ISSUE_PAGE_SIZE} — a blocker past the page boundary ` +
          "reads as unseen, which leaves its dependents blocked rather than dispatched.",
      );
    }
    return parsed.data;
  } catch {
    return null;
  }
}

/** One issue's blocked-by edges, with each blocker's own state — one call, not one per blocker. */
function fetchBlockers(gh: GhExec, number: number): Blocker[] | null {
  try {
    const raw = gh(["api", blockedByPath(number), "--jq", "[.[] | {number, state, state_reason}]"]);
    const parsed = Blockers.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * Whether a closed issue closed **having delivered**: a merged pull request closed it.
 *
 * The narrow question, asked only of issues already known to be closed as completed. Closure alone
 * is not delivery — that is the whole ruling — and the direction this fails in when GitHub does not
 * answer is *undelivered*, which reports rather than dispatches. Reporting a false unreachable costs
 * one line on a standing issue; dispatching against a blocker that never landed costs an implementer
 * building on code that does not exist.
 */
function closedByMergedPr(gh: GhExec, number: number): boolean {
  try {
    const raw = gh([
      "issue",
      "view",
      String(number),
      "--json",
      "closedByPullRequestsReferences",
      "--jq",
      "[.closedByPullRequestsReferences[].state]",
    ]);
    const parsed = ClosingPrStates.safeParse(JSON.parse(raw));
    return parsed.success && parsed.data.includes(MERGED);
  } catch {
    return false;
  }
}

/** Every implementer's claim, in one call — `refs/heads/implement/issue-<n>`. */
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

/** How one blocker's own state resolves to a `Delivery`, given whether a merged PR closed it. */
export function deliveryOf(blocker: Blocker, byMergedPr: () => boolean): Delivery {
  if (blocker.state.toLowerCase() === "open") return "open";
  if ((blocker.state_reason ?? "").toLowerCase() !== COMPLETED) return "undelivered";
  return byMergedPr() ? "delivered" : "undelivered";
}

/**
 * Builds the graph this run reasons over: every open issue as a node carrying its own edges, plus
 * every blocker those edges reach that is not itself open — resolved to a `Delivery` and carried as
 * a leaf, because a closed issue's own blockers cannot change what it already is.
 */
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

  // Open blockers are already nodes with their own edges — every open issue is. Only the closed ones
  // need adding, and they are leaves by construction.
  for (const [number, delivery] of deliveryCache) {
    if (states.has(number)) continue;
    states.set(number, { number, blockedBy: [], delivery, started: false });
  }

  return [...states.values()];
}

/** The published slices among `issues` — see `PARENT_PRD_HEADING` for why this is a safety rule. */
function publishedSliceNumbers(issues: OpenIssue[]): Set<number> {
  return new Set(
    issues.filter((issue) => PARENT_PRD_HEADING.test(issue.body ?? "")).map((issue) => issue.number),
  );
}

/** The open issue carrying `FINDING_MARKER`, if one is already standing. */
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

/**
 * Files the unreachable slices as **one** comment-or-create against one marker (ADR-0064's shape,
 * the pattern `watchdog/lost-dispatch-counter.ts` already implements) rather than as *n* silently
 * parked tickets. Returns what it actually named.
 */
function reportUnreachable(
  gh: GhExec,
  findings: UnreachableFinding[],
  log: (line: string) => void,
  dryRun: boolean,
): number[] {
  if (findings.length === 0) return [];

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
      `${fresh.length} unreachable slices found and only ${MAX_UNREACHABLE_REPORTED} will be named — ` +
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

/**
 * The reconciler. Reads the tracker, recomputes the ready set, dispatches `ticket-ready` for every
 * published slice in it that has not been started, and files what is unreachable as one counter
 * finding.
 *
 * Dispatch is **at-least-once** and deliberately dumb about what it has already sent: the
 * implementer's branch ref is the claim that makes a duplicate free
 * (`implement.ts`'s `claimImplementationBranch`), so there is no lock, no consumed label and no
 * pre-dispatch recheck to get wrong. The `¬started` term is a courtesy that keeps the run log
 * honest, not the thing correctness rests on.
 */
export function runReconcile(input: ReconcileInput = {}): ReconcileOutcome {
  const gh = input.gh ?? execGh;
  const log = input.log ?? ((line: string) => console.log(line));

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

  const slices = publishedSliceNumbers(issues);
  const byNumber = new Map(issues.map((issue) => [issue.number, issue]));

  const ready = readySlices(graph).filter((state) => slices.has(state.number));
  const unreachable = unreachableSlices(graph).filter((state) => slices.has(state.number));

  log(`${slices.size} published slice(s) open; ${ready.length} ready, ${unreachable.length} unreachable.`);

  const dispatched: number[] = [];
  for (const state of ready) {
    if (input.dryRun) {
      log(`would dispatch ticket-ready for #${state.number}.`);
      dispatched.push(state.number);
      continue;
    }
    try {
      dispatchTicketReady(gh, state.number);
      dispatched.push(state.number);
    } catch (err) {
      // One slice that will not dispatch must not cost the others theirs — and the next recompute
      // finds it still unstarted, so a failure here is late, never lost.
      log(`could not dispatch #${state.number}: ${reason(err)}`);
    }
  }

  const findings: UnreachableFinding[] = unreachable.map((state) => ({
    number: state.number,
    title: byNumber.get(state.number)?.title ?? `#${state.number}`,
    blockedBy: state.blockedBy,
  }));
  const filed = reportUnreachable(gh, findings, log, input.dryRun ?? false);

  if (dispatched.length === 0) {
    return {
      action: "clear",
      checked: slices.size,
      dispatched,
      unreachable: filed,
      note: `nothing became ready: ${slices.size} published slice(s) open, none of them ready and unstarted.`,
    };
  }
  return {
    action: "dispatched",
    checked: slices.size,
    dispatched,
    unreachable: filed,
    note: `dispatched ticket-ready for #${dispatched.join(", #")}.`,
  };
}

function main(): void {
  const eventAction = process.env.EVENT_ACTION || "";
  if (!RECONCILE_DISPATCH_ACTIONS.some((action) => action === eventAction)) {
    console.log(
      `dispatch action \`${eventAction}\` is not one of ` +
        `${RECONCILE_DISPATCH_ACTIONS.map((action) => `\`${action}\``).join(" or ")} — nothing to do.`,
    );
    return;
  }
  const outcome = runReconcile({ dryRun: process.argv.includes("--dry-run") });
  console.log(`${outcome.action}: ${outcome.note}`);
  process.exit(outcome.action === "degraded" ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
