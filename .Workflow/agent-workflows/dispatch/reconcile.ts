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
  countCriteria,
  extractCriteria,
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
 * **This is half the scope rule, and it is a safety rule.** Being in the graph is what makes an
 * issue *ready*; being something the owner meant to be built is what makes it something an
 * implementer may be started against. Without a rule of that shape, a hand-written issue that
 * happens to carry a blocked-by edge — or any unblocked issue at all — would have a Sonnet
 * implementer pointed at it and a pull request opened. The graph is read wide, so transitive
 * unreachability is computed correctly across every open issue; only what this rule admits is ever
 * acted on.
 *
 * The other half is `TO_BUILD_LABEL`.
 */
const PARENT_PRD_HEADING = /^##[ \t]+Parent PRD[ \t]*$/m;

/**
 * The second door into lane 06 (#184): the owner's own hand, on an issue written in full already.
 *
 * **The heading above is a proxy, and this is the term it was standing in for.** Nothing downstream
 * reads `## Parent PRD` — `implement.ts` exports `parentPrdNumber` and never calls it, and
 * `acceptance.ts` treats it as optional context — so it never bought the pipeline anything
 * operationally. It bought exactly one thing: *an agent wrote this deliberately as a slice*. That is
 * a constant folded into a predicate, the same shape of defect #179 unfolded, and the cost of
 * leaving it folded is that the smallest unit of work pays for the largest door — shaper, spec
 * author, critic and slicer, four model stages, to produce a ticket the owner could already write
 * in full.
 *
 * **Shape alone could not be the missing term.** #182, #181, #179 and #150 are all ticket-shaped —
 * criteria and a file claim — and none of them wanted an implementer at filing time. What is
 * absent is *intent to build now*, which nothing can infer from a body: it has to be asserted. So
 * it is a label, applied by hand, and `dispatch-reconcile.yml` gates the event it fires on the
 * sender being the repository owner for the reason `spec.yml` and `shape.yml` do — a label is
 * human-forgeable on a public repository where a `repository_dispatch` is not.
 *
 * **The saving is entirely on the authoring side and none of it on the checking side.** Everything
 * downstream is unchanged: the same branch claim, the same Immutability check against
 * `## Files claimed`, the same acceptance run, the same review and the same close gate. A door that
 * trimmed the tail would be a bypass rather than a small door.
 *
 * **Nothing removes the label and nothing needs to.** The `implement/issue-N` ref is already the
 * started-ness claim, so a labelled ticket that is running will not re-dispatch. The label stays as
 * the record of the decision, with no second piece of state to keep in sync.
 *
 * Spelled here and in `dispatch-reconcile.yml`'s job-level `if` — no compiler sees across that
 * boundary, so `reconcile.test.ts` asserts the two still agree, exactly as it does for
 * `RECONCILE_DISPATCH_ACTIONS`.
 */
export const TO_BUILD_LABEL = "to-build";

/**
 * Stands on the one comment this door wrote refusing a `to-build` issue's shape.
 *
 * The reconciler re-runs on every session end, so a refusal that filed per run would be the
 * unbounded touch ADR-0064 rules against; keyed on this marker it is one comment that gets
 * rewritten when the reason changes and left alone when it has not. Cleared without the marker
 * (see `toBuildClearedBody`), so a body that validates again stops this door writing to the issue
 * at all rather than rewriting the same bytes forever.
 */
const TO_BUILD_REFUSED_MARKER = "<!-- to-build-refused:v1 -->";

/** The `state_reason` GitHub reports for a delivery claim, as the REST dependencies API spells it. */
const COMPLETED = "completed";

/** A pull request state, as `gh pr view --json state` spells a merge. */
const MERGED = "MERGED";

const OpenIssue = z.object({
  number: z.number(),
  title: z.string(),
  body: z.string().nullable(),
  /** Absent on a `gh` response that never asked for it — every reader below treats that as "no labels". */
  labels: z.array(z.object({ name: z.string() })).optional(),
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

const ClosingPrNumbers = z.array(z.number());
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
  /**
   * Closes a spec `number` against `range` via `bin/close-ticket --spec`. Real production
   * behaviour shells to this repository's own `bin/close-ticket` (`runRealSpecClose`); a test
   * injects a canned result instead of paying for a tracker write and the spec's own check —
   * `integrate.ts`'s `IntegrateDeps.closeTicket`/`runRealCloseTicket` pattern, reused rather than
   * restated for a second `bin/close-ticket` mode.
   */
  closeSpec?: (number: number, range: string) => CloseTicketResult;
}

export interface ReconcileOutcome {
  /**
   * `degraded` is the only red run: it means this could not read its own inputs. A reconciler that
   * fails silently is the second sender nobody watches, which is the defect it exists to repair.
   */
  action: "clear" | "dispatched" | "degraded";
  /** Issues an implementer may be started against — see `startableNumbers`. */
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
      "number,title,body,labels",
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
 *
 * **Two calls, because the one-call form could only ever answer no.** This used to ask
 * `gh issue view --json closedByPullRequestsReferences --jq '[…[].state]'`, and that field does not
 * carry a `state` — GitHub serves `id`, `number`, `repository` and `url`, so the jq returned
 * `[null]`, the schema refused it, and every delivered ticket read as undelivered. #237 merged as
 * PR #244 and closed completed, and the reconciler still filed all five slices behind it as
 * unreachable (#245). The number is asked of the issue, the state is asked of the pull request, and
 * each is a field the endpoint being asked actually serves (ADR-0106).
 */
export function closedByMergedPr(gh: GhExec, number: number): boolean {
  return mergedCloser(gh, number) !== undefined;
}

/**
 * The merged pull request that closed `number`, or `undefined` when none of its closers ever
 * merged — or the lookup itself failed, same fail-closed direction `closedByMergedPr` documents
 * above. `closedByMergedPr` is this collapsed to a boolean; the spec-closing pass (#233) needs the
 * actual PR number too, to synthesize its own closing range, so the number is kept here and
 * `closedByMergedPr` is defined in terms of it rather than the two drifting into two copies of
 * the same two `gh` calls.
 */
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

/**
 * One pull request's own state. Compared as a trimmed string rather than parsed as JSON: `gh --jq`
 * prints a string result raw, the way `jq -r` does, so `.state` arrives as `MERGED` and not as
 * `"MERGED"` — and `JSON.parse` of the former throws.
 */
function prIsMerged(gh: GhExec, pr: number): boolean {
  try {
    return gh(["pr", "view", String(pr), "--json", "state", "--jq", ".state"]).trim() === MERGED;
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

/**
 * Every open issue an implementer may be started against: a slice lane 03 published, **or** one the
 * owner labelled `to-build` whose body this door did not refuse.
 *
 * One function, because this is the only enforcement point — `buildGraph` already reads every open
 * issue, so transitive unreachability is computed correctly across the whole tracker and only this
 * filter decides what may start an implementer. See `PARENT_PRD_HEADING` for why that is a safety
 * rule and `TO_BUILD_LABEL` for what the second door adds to it.
 */
function startableNumbers(issues: OpenIssue[], admitted: Set<number>): Set<number> {
  return new Set(
    issues
      .filter((issue) => PARENT_PRD_HEADING.test(issue.body ?? "") || admitted.has(issue.number))
      .map((issue) => issue.number),
  );
}

/**
 * Why lane 06 cannot be started against `body`, in `validateTicket`'s own words — or `undefined`
 * when it can.
 *
 * **One refusal, at the door.** Verify's Immutability job refuses an empty `## Files claimed`, so a
 * `to-build` label on a malformed issue would otherwise spend an implementer and a pull request to
 * fail downstream. Refusing here is W1 — refuse at the moment of the act — and it costs one comment.
 *
 * Asked of `validateTicket` rather than of a second reading of the same two headings: that function
 * *is* this repository's ticket grammar, ported from `bin/ticket_shape.py` and held to it by
 * `ticket-shape.test.ts`, so a door that spelled the check itself would be the drift that module
 * exists to prevent. Its warnings are dropped on purpose — this door refuses or admits, it does not
 * advise, and the tree its `## Files claimed` bullets would resolve against is the machine's
 * checkout rather than the target's anyway.
 */
function toBuildRefusal(body: string): string | undefined {
  try {
    validateTicket(body);
    return undefined;
  } catch (err) {
    if (err instanceof TicketShapeError) return err.message;
    throw err;
  }
}

function toBuildRefusalBody(refusal: string): string {
  return [
    `This is labelled \`${TO_BUILD_LABEL}\` and lane 06 will not start against it: ${refusal}.`,
    "",
    "Refused here rather than three stages later — verify's Immutability job reads the same",
    "`## Files claimed` section, so a run started against this body would spend an implementer and a",
    "pull request to arrive at the same answer.",
    "",
    `Add what is missing and the next session end starts it. The \`${TO_BUILD_LABEL}\` label stays`,
    "where it is; nothing here has to be re-applied.",
    "",
    TO_BUILD_REFUSED_MARKER,
  ].join("\n");
}

/**
 * What the refusal above is rewritten to once the body validates.
 *
 * Carries no marker, deliberately: the next run finds nothing of this door's standing on the issue,
 * so it stops writing rather than rewriting identical bytes on every session end forever. A body
 * that breaks again earns a fresh refusal rather than a resurrected edit, which is the more honest
 * record of what actually happened.
 */
const TO_BUILD_CLEARED_BODY = [
  "This ticket's shape is no longer refused — it carries both headings lane 06 needs, so the",
  "recompute that read this will start it as soon as every blocker has delivered.",
].join("\n");

/** Records this door's verdict on one `to-build` issue as at most one comment. See `TO_BUILD_REFUSED_MARKER`. */
function recordToBuildShape(
  gh: GhExec,
  number: number,
  refusal: string | undefined,
  log: (line: string) => void,
): void {
  const comments = fetchComments(gh, number);
  if (comments === null) {
    log(`could not read #${number}'s comments — leaving whatever this door said last run standing.`);
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
  log(`#${number}: refused at the ${TO_BUILD_LABEL} door — ${refusal}.`);
}

/**
 * The `to-build` door: every open issue carrying the label, minus the ones refused on shape.
 *
 * A refused issue is simply not in the returned set, so it is not in the ready set either and
 * nothing is dispatched against it — the same fail-closed direction every other read here takes. A
 * comment write that will not go through costs the run nothing but that comment: the issue stays
 * unadmitted, and the next recompute reads the same tracker and tries again.
 */
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

/**
 * Lane 09's spec-evaluate pass (#233, #237): every open `prd` issue that has grown at least one
 * sub-issue gets its own check run directly, and the verdict — or the refusal, when its body isn't
 * a shape a mechanical run can even attempt — lands as one upserted comment. `needs-human` is the
 * only label this pass touches, and only ever paired with its own refusal: a spec someone else
 * flagged is not this pass's to clear, and a spec this pass flagged is not something a human should
 * still be carrying once the body validates again.
 *
 * The label every published spec carries (`spec/publish.ts`'s `PRD_LABEL`) — declared again here,
 * the way `ratify/prd-close.ts` already does, rather than imported: a spec that
 * carries no sub-issue yet is still being sliced, which is a different lane's business, so this
 * pass's own scope is `prd` **and** `>=1 sub-issue`, not `prd` alone.
 */
const PRD_LABEL = "prd";

/** Shared pipeline vocabulary (`shape/shape.ts`'s `NEEDS_LIVE_SESSION_LABEL`) — declared locally for the same reason `PRD_LABEL` is. */
const NEEDS_HUMAN_LABEL = "needs-human";

/** Stands on the one comment recording a spec's own check having run and what it found. */
const PRD_CHECK_MARKER = "<!-- prd-check:v1 -->";

/** Stands on the one comment recording that this pass could not run the spec's check at all. Mutually exclusive with `PRD_CHECK_MARKER` on any one spec. */
const PRD_UNRUNNABLE_MARKER = "<!-- prd-unrunnable:v1 -->";

const IssueComment = z.object({ id: z.number(), body: z.string() });
type IssueComment = z.infer<typeof IssueComment>;
const IssueComments = z.array(IssueComment);

const SubIssueList = z.array(z.object({ number: z.number() }));

/** Rewrites one comment whole, by the REST id `issueCommentsPath` reads back — never `gh issue view`'s GraphQL node id, which this endpoint does not accept. */
function rewriteComment(gh: GhExec, id: number, body: string): void {
  gh(["api", issueCommentPath(id), "-X", "PATCH", "-f", `body=${body}`]);
}

/**
 * An issue's comments, read fresh every run — neither pass that reads them keeps a cursor or a
 * ledger of what it said last time, so "have I said this already?" is answered from what is
 * actually standing on the issue.
 */
function fetchComments(gh: GhExec, number: number): IssueComment[] | null {
  try {
    const raw = gh(["api", issueCommentsPath(number)]);
    const parsed = IssueComments.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** The one comment carrying any of `markers` — how both passes here find what they said last run. */
function markedComment(comments: IssueComment[], ...markers: string[]): IssueComment | undefined {
  return comments.find((comment) => markers.some((marker) => comment.body.includes(marker)));
}

/** How many sub-issues `number` has grown — the term that puts a `prd` issue in this pass's scope at all. */
function fetchSubIssueCount(gh: GhExec, number: number): number | null {
  try {
    const raw = gh(["api", subIssuesPath(number)]);
    const parsed = SubIssueList.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data.length : null;
  } catch {
    return null;
  }
}

/** One spec's sub-issues, with each child's own state — the shape the spec-closing pass's delivery check needs, unlike `fetchSubIssueCount`'s bare numbers. Same endpoint, same `Blocker` shape `fetchBlockers` already reads a blocker with. */
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

/**
 * When `pr` merged and the commit it landed as — or `undefined` when either is missing, which
 * only happens for a PR that never actually merged or a lookup that failed. This is the "branch
 * position" the spec-closing pass sorts by: merges into this repo's trunk are serialised by lane
 * 08's own `integrate` concurrency group, so the order they landed in *is* the order they sit on
 * the branch, and `mergedAt` is the field GitHub actually answers that with — there is no
 * ordering endpoint that answers "which commit is first" more directly than "which merged first".
 */
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

/**
 * `<first-merge>^..<last-merge>`, ordered by when each delivering pull request actually merged —
 * never by the child issue's own number, which is a filing-time artifact and no guarantee of
 * merge order. One child collapses to `<merge>^..<merge>`, the same shape `integrate.ts`'s
 * `prCommitRange` produces for a single pull request. `undefined` when any merge's own info could
 * not be read, since a closing range built from a partial set would misname the spec's own diff.
 */
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

/** What one closing attempt found, once the closer actually ran. */
interface SpecClosingAttempt {
  /** Whether `bin/close-ticket --spec` refused after this pass's own check just read green. */
  disagreement: boolean;
  result: CloseTicketResult;
}

/**
 * Attempts to close `prdNumber` through `bin/close-ticket --spec`, invoked only when both hold:
 * the pass's own check just read green (the caller's job — see its call site) and every child is
 * delivered, reusing `deliveryOf` and the same merged-closer lookup `closedByMergedPr` answers
 * with, rather than asking the delivery question a second way. Never invoked with an undelivered
 * child: the loop below returns the moment one child's delivery isn't `"delivered"`, before a
 * single closing range is built or `closeSpec` is called at all.
 *
 * `undefined` means "did not even try": an undelivered child, a sub-issues read that failed, or a
 * closing range that could not be synthesized. Only a `SpecClosingAttempt` means the closer
 * actually ran, and `disagreement` is the one fact `evaluateSpecCheck` needs back from it.
 */
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
    log(`#${prdNumber}: every child delivered but its closing range could not be synthesized — skipping the close attempt.`);
    return undefined;
  }

  const result = closeSpec(prdNumber, range);
  return { disagreement: result.exitCode !== 0, result };
}

/** Why `isRunnableSpec` refused `body` — named for the refusal comment, since "not runnable" alone tells a reader nothing to fix. */
function unrunnableReason(body: string): string {
  const count = countCriteria(body);
  if (count === null) return "its body carries no `## Acceptance criteria` heading";
  if (count === 0) return "its `## Acceptance criteria` heading has no `- [ ]` item";
  if (count > 1) return `its body carries ${count} acceptance criteria — this pass can only run one`;
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

/**
 * Names both verdicts rather than either alone — the pass's own check just read green, and
 * `bin/close-ticket --spec` still refused, so a comment carrying only one of the two would read
 * as this pass being wrong or as the closer being wrong, when the fact worth recording is that
 * they disagreed. Kept under `PRD_CHECK_MARKER`, the same comment `verdictCommentBody` writes,
 * because this is still that comment's answer for this run — not a second thing standing beside
 * it, and not `PRD_UNRUNNABLE_MARKER`'s `needs-human` pairing, which belongs to a body this pass
 * could not even attempt.
 */
function disagreementCommentBody(
  command: string,
  run: { code: number; output: string },
  closerResult: CloseTicketResult,
): string {
  const trimmed = closerResult.output.trim();
  return [
    `Ran this spec's own check: \`${command}\` — exit ${run.code}.`,
    "",
    `\`bin/close-ticket --spec\` disagreed: exit ${closerResult.exitCode}. This spec stays open.`,
    ...(trimmed.length > 0 ? ["", "```", trimmed, "```"] : []),
    "",
    PRD_CHECK_MARKER,
  ].join("\n");
}

/** Runs `command` the way `bin/close-ticket`'s `run_check` already does — a shell command, this checkout as its cwd, output captured rather than left to spray the run log. */
function runCheckCommand(command: string): { code: number; output: string } {
  const result = spawnSync(command, { shell: true, encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });
  return { code: result.status ?? 1, output: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}

/**
 * Locates the one comment already carrying either marker and rewrites it whole; creates a fresh
 * comment when neither has ever been written. One implementation for the verdict write, the
 * refusal write and the needs-human-clearing write's own comment rewrite — never three ways to say
 * "this is the current answer".
 */
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

/**
 * Evaluates one `prd` issue's own check and upserts its verdict or refusal — see this section's
 * header for the label rule — then, only once that check reads green, attempts to close the spec
 * itself through `closeSpec` (see `attemptSpecClose`). A pass/closer disagreement rewrites this
 * same verdict comment naming both exit codes and returns before the `needs-human` label is ever
 * touched: that label is `PRD_UNRUNNABLE_MARKER`'s pairing, for a body this pass could not even
 * attempt, and a disagreement is a body it could.
 */
function evaluateSpecCheck(
  gh: GhExec,
  prd: PrdCheckCandidate,
  log: (line: string) => void,
  closeSpec: (number: number, range: string) => CloseTicketResult,
): void {
  const comments = fetchComments(gh, prd.number);
  if (comments === null) {
    log(`could not read #${prd.number}'s comments — skipping its spec check this run.`);
    return;
  }

  const hasOwnRefusal = markedComment(comments, PRD_UNRUNNABLE_MARKER) !== undefined;
  const hasNeedsHuman = prd.labels.includes(NEEDS_HUMAN_LABEL);

  if (!isRunnableSpec(prd.body)) {
    upsertPrdComment(gh, prd.number, comments, refusalCommentBody(prd.body));
    if (!hasNeedsHuman) gh(["issue", "edit", String(prd.number), "--add-label", NEEDS_HUMAN_LABEL]);
    log(`#${prd.number}: refused — ${unrunnableReason(prd.body)}.`);
    return;
  }

  const command = parseCheckMarker(extractCriteria(prd.body)[0] ?? "");
  if (command === undefined) {
    // isRunnableSpec already guarantees a well-formed marker on the sole criterion; this only
    // keeps the branch below from ever calling runCheckCommand with an empty string.
    log(`#${prd.number}: isRunnableSpec accepted a body whose marker didn't parse — skipping.`);
    return;
  }

  const run = runCheckCommand(command);
  const closing = run.code === 0 ? attemptSpecClose(gh, prd.number, closeSpec, log) : undefined;

  if (closing?.disagreement) {
    upsertPrdComment(gh, prd.number, comments, disagreementCommentBody(command, run, closing.result));
    log(
      `#${prd.number}: pass/closer disagreement — ran \`${command}\` exit ${run.code}, ` +
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
 * Retires the standing report once nothing is unreachable
 * ([ADR-0099](../../../docs/adr/0099-a-recomputing-counter-closes-its-standing-issue-when-its-cou.md)).
 *
 * **This reconciler recomputes its whole set every run, so it is entitled to say zero.** Nothing is
 * stored, nothing is carried between runs, and the answer comes off the tracker each time — so an
 * empty finding list is the assertion *nothing in the tracker is unreachable*, which is the exact
 * fact the standing issue would need to keep asserting to stay open. `lost-dispatch-counter.ts`
 * shares the marker pattern and gets no equivalent, because it sees one PRD per run and could only
 * close a report about twelve others on evidence about one.
 *
 * Nothing else could close it: #216 named two slices that both delivered within the hour and stayed
 * open regardless, because the zero path returned before it ever looked at the standing issue. A
 * report nothing can clear is the park ADR-0011 forbids with an issue number attached.
 */
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
    // The rule the dispatch loop above already follows: one call that will not go through must not
    // cost the run its answer. The next recompute finds the same zero and the same open issue, so a
    // failure here is late, never lost.
    log(`could not close #${standing.number}: ${reason(err)}`);
  }
}

/**
 * Files the unreachable slices as **one** comment-or-create against one marker (ADR-0064's shape,
 * the pattern `watchdog/lost-dispatch-counter.ts` already implements) rather than as *n* silently
 * parked tickets. Returns what it actually named.
 *
 * The empty case is not a no-op: it hands off to `retireStanding` below, whose docstring is the
 * home for why zero is an assertion this reconciler is entitled to make (ADR-0099).
 */
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
 * The reconciler. Reads the tracker, recomputes the ready set, dispatches `ticket-ready` for
 * everything in it that `startableNumbers` admits and that has not been started, and files what is
 * unreachable as one counter finding.
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
  const closeSpec = input.closeSpec ?? runRealSpecClose;

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
      log(`could not read #${issue.number}'s sub-issues — skipping its spec check this run.`);
      continue;
    }
    if (subIssueCount < 1) continue;

    if (input.dryRun) {
      log(`would evaluate #${issue.number}'s spec check.`);
      continue;
    }

    try {
      evaluateSpecCheck(gh, { number: issue.number, body: issue.body ?? "", labels }, log, closeSpec);
    } catch (err) {
      // One spec's check crashing must not cost every other spec its own verdict — and the next
      // recompute reads the same tracker state and tries again.
      log(`could not evaluate #${issue.number}'s spec check: ${reason(err)}`);
    }
  }

  const startable = startableNumbers(issues, admitToBuild(gh, issues, log, input.dryRun ?? false));
  const byNumber = new Map(issues.map((issue) => [issue.number, issue]));

  const ready = readySlices(graph).filter((state) => startable.has(state.number));
  const unreachable = unreachableSlices(graph).filter((state) => startable.has(state.number));

  log(`${startable.size} startable issue(s) open; ${ready.length} ready, ${unreachable.length} unreachable.`);

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
      checked: startable.size,
      dispatched,
      unreachable: filed,
      note: `nothing became ready: ${startable.size} startable issue(s) open, none of them ready and unstarted.`,
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

/**
 * The real `closeSpec`: shells to this repository's own `bin/close-ticket --spec`, the same
 * binary `integrate.ts`'s `runRealCloseTicket` shells to for an ordinary ticket, with this
 * runner's checkout as the tree the spec's own check runs against.
 *
 * `--spec` is the whole difference between this closer and lane 08's; the spawn itself is
 * `shared/close-ticket.ts`, so the two cannot drift in how they read an exit code or fold output.
 */
export function runRealSpecClose(number: number, range: string): CloseTicketResult {
  return closeTicketProcess(["--spec", String(number), range, "."]);
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
