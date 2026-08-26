import { pathToFileURL } from "node:url";
import { z } from "zod";
import { execGh, type GhExec } from "../shared/gh";
import { workflowPath, workflowRunsPath } from "../shared/gh-paths";
import { reason } from "../shared/reason";

/**
 * The close gate's reconciler: which completed closes were never judged
 * (#106).
 *
 * The gate fires on `issues.closed`, and GitHub does not replay an event a
 * workflow missed. So a close that lands while Actions is down produces no
 * run, no verdict and no `close-refused` — and is indistinguishable from a
 * close that passed. Nothing anywhere records that it wasn't judged. This
 * asks the one question that is answerable entirely from durable state
 * afterwards — *which completed closes have no gate run?* — and reopens
 * what it finds, so an unjudged close re-enters the normal repair path
 * instead of standing as a delivery nobody checked.
 *
 * **Why this is not a watchdog, and not #41.** A watchdog has to run
 * *during* the failure. The failure this exists for is Actions not running
 * workflows, so a watchdog would be down with everything else. A reconciler
 * only has to run *after*, which is what makes being asleep through the
 * outage cost it nothing.
 *
 * **Why it rides session end rather than a clock.** #106 proposed a daily
 * cron and ADR-0004 forbids one: a cadence can fire when nothing has
 * happened since it last fired. Session end cannot — a session that ended is
 * work that happened, and closes only arrive during work. The observed
 * failure also does not reward a clock: on 2026-08-26 the Actions queue was
 * throttled, not dropped, and GitHub's own scheduler is throttled by the
 * same incident, so a cron would have been late in exactly the window it
 * was supposed to cover. See ADR-0048.
 *
 * **Recomputes, stores nothing** (`DESIGN.md` §6's counter discipline).
 * Every run derives its answer from the tracker and the Actions log. There
 * is no cursor, no ledger and no state file, so nothing it says can go
 * stale and it cannot feed on its own output — a reopened issue is no
 * longer a closed one, so the next run simply does not see it.
 *
 * **Declared ceiling.** The link between a close and the run that judged it
 * is a *correlation*, not a fact: a run's payload is not in the Actions API,
 * so this matches on the run's display title (which is the issue's title)
 * and on the run having been created after the close. Two open issues
 * sharing one title, closed inside the same window, can therefore let one
 * run vouch for both — an unjudged close read as judged. The fix is for the
 * gate to stamp its verdict on the issue so this reads a fact instead;
 * that is strictly more reliable and strictly more work, and #106 named the
 * choice. Ship the correlation, and do not build anything on a claim that
 * this cannot miss.
 */

/**
 * The dispatch this rides. Spelled here and in
 * `close-gate-reconcile.yml`'s job-level `if` — no compiler sees across
 * that language boundary, so `reconcile.test.ts` asserts the two still
 * agree, the same guard `run-audit.ts`/`audit.yml` and
 * `close-gate.ts`/`close-gate.yml` carry.
 *
 * It is the capture hook's `session-captured`, deliberately reused rather
 * than given a dispatch of its own: a second dispatch would be a second
 * thing that can silently stop arriving, and this one already fires on the
 * event that makes the question non-vacuous.
 */
export const RECONCILE_DISPATCH_ACTION = "session-captured";

/** The gate whose runs answer "was this close judged?". */
export const GATE_WORKFLOW_FILE = "close-gate.yml";

/**
 * How far back a run looks. Long enough to cover an outage nobody noticed
 * over a weekend, short enough that the window fits in one page of runs.
 * A closed issue older than this is history: reopening it would be filing
 * work against a close nobody remembers making.
 */
export const LOOKBACK_DAYS = 7;

/**
 * One page of gate runs. A hundred covers this repo's busiest week several
 * times over — the heaviest observed day is fifteen — and where it does not,
 * the window is clipped to what the page reaches and the clipping is logged
 * rather than left to look like an all-clear.
 */
export const RUN_PAGE_SIZE = 100;

/**
 * How early a gate run may be created relative to the close it judges.
 * Nominally never — the run is created after the event — but `closedAt` and
 * `created_at` come from different clocks and different APIs, and the
 * observed gap on a healthy run is two to four seconds. A minute of slack
 * costs nothing; refusing it would read a healthy close as unjudged.
 */
const CLOCK_SLACK_MS = 60_000;

/**
 * The most reopens one run will make. A reconciler that reopened forty
 * issues would be reporting its own defect, not a real backlog, and it
 * would do it by writing to forty issues. What it declines to act on is
 * logged rather than dropped silently — a cap nobody is told about reads
 * as "there was nothing else".
 */
const MAX_REOPENS = 10;

/**
 * A run conclusion that means the gate actually rendered a verdict.
 *
 * `failure` counts: a gate that failed is a *degraded* outcome, and the
 * gate already reopened the issue itself before exiting nonzero — that
 * close is not unjudged, it is refused. `cancelled`, `skipped`,
 * `timed_out`, `stale` and `action_required` do not count: the run exists
 * and the close was never read, which is the same hole as no run at all
 * and would otherwise hide behind one.
 */
const JUDGING_CONCLUSIONS = new Set(["success", "failure"]);

/** A run that has not finished yet, and may still judge the close. */
const PENDING_STATUSES = new Set(["queued", "in_progress", "waiting", "pending", "requested"]);

const ClosedIssue = z.object({
  number: z.number(),
  title: z.string(),
  closedAt: z.string(),
  stateReason: z.string().nullable().optional(),
});
export type ClosedIssue = z.infer<typeof ClosedIssue>;

const GateRun = z.object({
  created_at: z.string(),
  display_title: z.string(),
  status: z.string().nullable().optional(),
  conclusion: z.string().nullable().optional(),
  html_url: z.string().nullable().optional(),
});
export type GateRun = z.infer<typeof GateRun>;

const ClosedIssues = z.array(ClosedIssue);
const GateRuns = z.object({ workflow_runs: z.array(GateRun) });
const GateWorkflow = z.object({ created_at: z.string() });

/** What the reconciler decided about one completed close. */
export type CloseState = "judged" | "pending" | "unjudged";

export interface CloseVerdict {
  issue: ClosedIssue;
  state: CloseState;
  /** The run that answers for this close, where one was matched. */
  run: GateRun | null;
  /** Seconds between the close and the run that judged it, where matched. */
  delaySeconds: number | null;
}

/** The `state_reason` `gh issue list` reports for a delivery claim. */
const COMPLETED = "COMPLETED";

function toMillis(iso: string): number {
  return new Date(iso).getTime();
}

/**
 * Pairs completed closes with the gate runs that judged them.
 *
 * Pure, and the whole judgement lives here: everything above it fetches and
 * everything below it writes. One run answers for at most one close —
 * consumed as it is matched, oldest close first — because the alternative
 * lets a single run vouch for two same-titled issues closed minutes apart,
 * and the direction that error fails is *open*, which is the one direction
 * a gate may never fail.
 */
export function reconcile(issues: ClosedIssue[], runs: GateRun[]): CloseVerdict[] {
  const completed = issues
    .filter((issue) => (issue.stateReason ?? "").toUpperCase() === COMPLETED)
    .sort((a, b) => toMillis(a.closedAt) - toMillis(b.closedAt));

  const available = [...runs].sort((a, b) => toMillis(a.created_at) - toMillis(b.created_at));
  const consumed = new Set<GateRun>();

  return completed.map((issue) => {
    const closedAt = toMillis(issue.closedAt);
    const match = available.find(
      (run) =>
        !consumed.has(run) &&
        run.display_title === issue.title &&
        toMillis(run.created_at) >= closedAt - CLOCK_SLACK_MS,
    );
    if (match === undefined) {
      return { issue, state: "unjudged", run: null, delaySeconds: null };
    }
    consumed.add(match);
    const delaySeconds = Math.round((toMillis(match.created_at) - closedAt) / 1000);
    const pending = PENDING_STATUSES.has(match.status ?? "");
    const judged = match.status === "completed" && JUDGING_CONCLUSIONS.has(match.conclusion ?? "");
    return {
      issue,
      state: pending ? "pending" : judged ? "judged" : "unjudged",
      run: match,
      delaySeconds,
    };
  });
}

export interface ReconcileInput {
  /** Injected so a test can pin the window without pinning the clock. */
  now?: Date;
  lookbackDays?: number;
  /**
   * Read the window and report, write nothing. Not a safety valve — the
   * workflow never sets it — but the way this answer stays checkable: an
   * acceptance criterion that says "it finds nothing when every close was
   * judged" needs a command a reader can run again next year, and the only
   * honest one is the reconciler itself over live state.
   */
  dryRun?: boolean;
  gh?: GhExec;
  log?: (line: string) => void;
}

export interface ReconcileOutcome {
  /** `degraded` is the only red run: it means this could not read its own
   * inputs, and a reconciler that fails silently is the second gate nobody
   * watches. */
  action: "clear" | "reopened" | "degraded";
  checked: number;
  reopened: number[];
  pending: number[];
  note: string;
}

function since(now: Date, lookbackDays: number): Date {
  return new Date(now.getTime() - lookbackDays * 24 * 60 * 60 * 1000);
}

function fetchClosedIssues(gh: GhExec, from: Date): ClosedIssue[] | null {
  const day = from.toISOString().slice(0, 10);
  try {
    // Searched rather than listed-and-filtered: `gh issue list` pages by
    // creation, so an old issue closed yesterday can sit past the page
    // boundary — and a close this cannot see is exactly the close it
    // exists to find.
    const raw = gh([
      "issue",
      "list",
      "--state",
      "closed",
      "--search",
      `closed:>=${day}`,
      "--limit",
      "100",
      "--json",
      "number,title,closedAt,stateReason",
    ]);
    const parsed = ClosedIssues.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * When the gate first existed. The hard floor on everything below: a close
 * that landed before this could not have been judged by a workflow that did
 * not exist, and it is not outstanding work — it is history.
 *
 * This is not a hypothetical. The first dry run over a seven-day window
 * found 42 "unjudged" closes, every one of them from before the gate
 * shipped on 2026-08-25, and would have reopened ten issues that were never
 * the gate's to judge. A lookback window alone does not encode that; this
 * does, and it stays true as the window moves.
 */
function fetchGateStart(gh: GhExec): number | null {
  try {
    const raw = gh(["api", workflowPath(GATE_WORKFLOW_FILE)]);
    const parsed = GateWorkflow.safeParse(JSON.parse(raw));
    return parsed.success ? toMillis(parsed.data.created_at) : null;
  } catch {
    return null;
  }
}

function fetchGateRuns(gh: GhExec): GateRun[] | null {
  try {
    const raw = gh(["api", workflowRunsPath(GATE_WORKFLOW_FILE, RUN_PAGE_SIZE)]);
    const parsed = GateRuns.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data.workflow_runs : null;
  } catch {
    return null;
  }
}

function unjudgedComment(issue: ClosedIssue, run: GateRun | null): string {
  const what =
    run === null
      ? "**no `Close gate` run was ever created for it.**"
      : `**the \`Close gate\` run for it never rendered a verdict** (${run.html_url ?? "run"} — ` +
        `\`${run.status ?? "?"}\`/\`${run.conclusion ?? "-"}\`).`;
  return (
    `**Reopened: this close was never judged.**\n\n` +
    `The issue was closed as completed at ${issue.closedAt}, and ${what}\n\n` +
    "The gate fires on `issues.closed` and GitHub does not replay an event a workflow missed, so " +
    "an Actions outage, a dropped event or a disabled workflow leaves a close that looks " +
    "identical to one that passed. This is that gap being closed after the fact, not a verdict " +
    "on the work — nothing here says the record was bad.\n\n" +
    "**What to do:** close it again. If it carries a `## Closing record` the gate will judge that " +
    "one; if it does not, the gate will read the issue and write one. Nothing needs repairing " +
    "first."
  );
}

/**
 * The reconciler. Reads the tracker and the Actions log, reopens what was
 * never judged, and writes nothing else — no label, deliberately:
 * `close-refused` means *this gate reopened a close and has not since
 * accepted one* (ADR-0023), and an unjudged close is not a refused one. A
 * close nobody read would otherwise be counted as a refusal, and the count
 * of refusals is evidence about the grammar.
 */
export function runReconcile(input: ReconcileInput = {}): ReconcileOutcome {
  const gh = input.gh ?? execGh;
  const log = input.log ?? ((line: string) => console.log(line));
  const now = input.now ?? new Date();
  const from = since(now, input.lookbackDays ?? LOOKBACK_DAYS);

  const issues = fetchClosedIssues(gh, from);
  if (issues === null) {
    return {
      action: "degraded",
      checked: 0,
      reopened: [],
      pending: [],
      note: "the tracker did not return a readable list of closed issues.",
    };
  }

  const runs = fetchGateRuns(gh);
  if (runs === null) {
    return {
      action: "degraded",
      checked: 0,
      reopened: [],
      pending: [],
      note: `the Actions API did not return a readable run list for \`${GATE_WORKFLOW_FILE}\`.`,
    };
  }

  const gateStart = fetchGateStart(gh);
  if (gateStart === null) {
    return {
      action: "degraded",
      checked: 0,
      reopened: [],
      pending: [],
      note: `the Actions API did not say when \`${GATE_WORKFLOW_FILE}\` first existed, and without that every close before the gate shipped reads as unjudged.`,
    };
  }

  // A close is only answerable here if the page of runs could have shown
  // its run. The API returns the newest runs first, so truncation only ever
  // hides *old* ones — and a run that judged a close is newer than the
  // close. So a short page has seen every run there is and clips nothing;
  // only a full page leaves a floor, at its oldest run. Reopening below that
  // floor would be filing work against the reconciler's own page size rather
  // than against a close nobody judged.
  const oldestRun = runs
    .map((run) => toMillis(run.created_at))
    .reduce((oldest, at) => Math.min(oldest, at), Number.POSITIVE_INFINITY);
  const pageIsFull = runs.length >= RUN_PAGE_SIZE && Number.isFinite(oldestRun);
  const pageFloor = pageIsFull ? oldestRun : Number.NEGATIVE_INFINITY;
  const floor = Math.max(from.getTime(), gateStart, pageFloor);
  if (floor > from.getTime()) {
    const why =
      floor === gateStart
        ? `\`${GATE_WORKFLOW_FILE}\` did not exist before then, so nothing earlier was ever its to judge`
        : `one page of \`${GATE_WORKFLOW_FILE}\` runs reaches no further back than that, and closes before it cannot be answered here`;
    log(`window clipped to ${new Date(floor).toISOString()} — ${why}.`);
  }

  const inWindow = issues.filter((issue) => toMillis(issue.closedAt) >= floor);
  const verdicts = reconcile(inWindow, runs);

  for (const verdict of verdicts) {
    const delay =
      verdict.delaySeconds === null
        ? ""
        : ` (${verdict.delaySeconds < 0 ? "" : "+"}${verdict.delaySeconds}s)`;
    log(`#${verdict.issue.number} ${verdict.state}${delay} — closed ${verdict.issue.closedAt}`);
  }

  const unjudged = verdicts.filter((verdict) => verdict.state === "unjudged");
  const pending = verdicts.filter((verdict) => verdict.state === "pending");

  if (unjudged.length > MAX_REOPENS) {
    log(
      `${unjudged.length} unjudged closes found and only the oldest ${MAX_REOPENS} will be ` +
        "reopened — a backlog this size is more likely this reconciler being wrong than the gate " +
        "having missed that many closes. The rest are listed above and were left closed.",
    );
  }

  const reopened: number[] = [];
  for (const verdict of unjudged.slice(0, MAX_REOPENS)) {
    if (input.dryRun) {
      log(`would reopen #${verdict.issue.number} — closed as completed and never judged.`);
      reopened.push(verdict.issue.number);
      continue;
    }
    try {
      gh([
        "issue",
        "reopen",
        String(verdict.issue.number),
        "--comment",
        unjudgedComment(verdict.issue, verdict.run),
      ]);
      reopened.push(verdict.issue.number);
    } catch (err) {
      // One issue that will not reopen must not cost the others theirs.
      log(`could not reopen #${verdict.issue.number}: ${reason(err)}`);
    }
  }

  const pendingNumbers = pending.map((verdict) => verdict.issue.number);
  if (reopened.length === 0) {
    return {
      action: "clear",
      checked: verdicts.length,
      reopened,
      pending: pendingNumbers,
      note:
        `${verdicts.length} completed close(s) in the window, every one of them judged or still ` +
        `queued${pendingNumbers.length > 0 ? ` (#${pendingNumbers.join(", #")} still queued)` : ""}.`,
    };
  }
  return {
    action: "reopened",
    checked: verdicts.length,
    reopened,
    pending: pendingNumbers,
    note: `reopened #${reopened.join(", #")} — closed as completed and never judged.`,
  };
}

function main(): void {
  const eventAction = process.env.EVENT_ACTION || "";
  if (eventAction !== RECONCILE_DISPATCH_ACTION) {
    console.log(
      `dispatch action \`${eventAction}\` is not \`${RECONCILE_DISPATCH_ACTION}\` — nothing to do.`,
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
