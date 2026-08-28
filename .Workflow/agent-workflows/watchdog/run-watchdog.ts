import { pathToFileURL } from "node:url";
import { z } from "zod";
import { execGh, type GhExec } from "../shared/gh";
import { repoRunsPath, runJobsPath } from "../shared/gh-paths";
import { reason } from "../shared/reason";
import {
  deadLanes,
  isCandidate,
  MAX_JOB_READS,
  MAX_SIGNALS,
  RUN_PAGE_SIZE,
  signalBody,
  signalMarker,
  signalTitle,
  type DeadLane,
  type RunSummary,
} from "./dead-lanes";

/**
 * The run watchdog's entrypoint (#41, `.github/workflows/run-watchdog.yml`):
 * sweeps this repo's recent runs for any that completed having executed no
 * job, and opens an issue naming the dead lane and linking its runs.
 *
 * **An issue is the signal** because it is the one artifact here that
 * arrives rather than waits — GitHub notifies the owner, it is assigned so
 * it notifies rather than sits in a list, and the record survives the
 * session that produced it. The failure being fixed is precisely that a dead
 * run produces no check-run and no annotation, so anything written inside
 * Actions would be as unread as the runs it watches.
 *
 * **Why it sweeps rather than riding `workflow_run`.** The obvious trigger
 * is the run itself, and it cannot work: `workflow_run`'s `workflows:` filter
 * matches on a workflow's *name*, and the failure this exists for is GitHub
 * being unable to read a name out of the file — the run is named after its
 * own path instead. A trigger keyed on names is blind to exactly the runs it
 * would be there to catch, and `actionlint` refuses the un-filtered form
 * outright ("no workflow is configured for \`workflow_run\` event"), so it is
 * not shippable here either way. That is recorded in ADR-0049.
 *
 * **Why it rides session end rather than a clock.** ADR-0004 forbids a
 * cadence: a mechanism that can fire when nothing has happened since it last
 * fired is a cadence, and a daily sweep of a repo nobody touched is one. A
 * session that ended is work that happened, and dead runs only arrive during
 * work — the same reasoning ADR-0048 applied to the close gate's reconciler,
 * and the same dispatch, deliberately reused rather than given one of its
 * own: a second dispatch is a second thing that can silently stop arriving.
 *
 * **Recomputes, stores nothing.** No cursor and no ledger. Whether a lane
 * has already been reported is derived from the issues themselves, so a
 * signal that gets closed is simply not a standing one next sweep, and
 * nothing this says can go stale.
 *
 * **Declared ceiling.** The sweep sees one page of runs (`RUN_PAGE_SIZE`)
 * and spends at most `MAX_JOB_READS` job-count reads inside it. A repo that
 * outran either in one window gets a log line saying so rather than a quiet
 * all-clear — a bound nobody is told about is the failure this exists for,
 * rebuilt.
 */

/**
 * The dispatch this rides. Spelled here and in `run-watchdog.yml`'s
 * job-level `if` — no compiler sees across that language boundary, so
 * `run-watchdog.test.ts` asserts the two still agree, and
 * `capture/dispatch-action.test.ts` holds both to the name the hook actually
 * sends. #107 is what those guards are for.
 */
export const WATCHDOG_DISPATCH_ACTION = "session-captured";

const ApiRun = z.object({
  id: z.number(),
  name: z.string(),
  path: z.string(),
  status: z.string(),
  conclusion: z.string().nullable(),
  html_url: z.string(),
  head_branch: z.string().nullable(),
  created_at: z.string(),
});

const SignalIssue = z.object({
  number: z.number(),
  body: z.string().nullable(),
  state: z.string(),
  closedAt: z.string().nullable(),
});

export interface RunWatchdogOptions {
  gh: GhExec;
  /** `github.event.action` on the dispatch that triggered this run — see `WATCHDOG_DISPATCH_ACTION`. */
  eventAction: string | null | undefined;
  /** Who each signal is assigned to, so it notifies rather than sits in a list. */
  assignee: string;
  /** The moment the sweep's lookback window is measured back from. Injected so a test can pin it. */
  now?: Date;
  log?: (line: string) => void;
}

export type WatchdogAction = "skipped" | "swept";

export interface WatchdogOutcome {
  action: WatchdogAction;
  /** A stable slug for the log — mirrors `run-audit.ts`'s `Outcome.code`. */
  code: string;
  /** Dead lanes found in the window. `0` on every skip. */
  deadCount: number;
  /** Issues opened and comments added, in the order they were written. */
  signals: Array<{ lane: string; issue: number; wrote: "opened" | "commented" }>;
}

function readRuns(gh: GhExec): RunSummary[] {
  // Projected in the `--jq`, not after parsing. A run object carries a full commit, actor, repo and
  // head-repo, so a hundred of them is several megabytes of which this reads eight fields — and the
  // seam that would have to buffer it reports the overflow as `ENOBUFS`, naming neither the call
  // nor the size.
  const projection = "[.workflow_runs[] | {id, name, path, status, conclusion, html_url, head_branch, created_at}]";
  const raw = gh(["api", repoRunsPath(RUN_PAGE_SIZE), "--jq", projection]);
  return ApiRun.array()
    .parse(JSON.parse(raw))
    .map((run) => ({
      id: run.id,
      name: run.name,
      path: run.path,
      status: run.status,
      conclusion: run.conclusion ?? "",
      htmlUrl: run.html_url,
      headBranch: run.head_branch ?? "",
      createdAt: run.created_at,
    }));
}

/**
 * How many jobs a run executed. Read per run because the runs list does not
 * carry it: a run object says it completed and says it failed, and says
 * nothing at all about whether anything executed — which is the distinction
 * this whole mechanism is about.
 *
 * Needs `actions: read`. The close gate's reconciler spent every dispatch it
 * received exiting on a 403 for want of exactly that (#107), which is why it
 * is named here as well as in the workflow.
 */
function jobCount(gh: GhExec, runId: number): number {
  const raw = gh(["api", runJobsPath(runId), "--jq", ".total_count"]);
  const trimmed = raw.trim();
  // `Number("")` is `0`, and `0` is this function's alarm value — so an empty read (a 403 for want
  // of `actions: read`, an endpoint that moved) would arrive indistinguishable from a run that
  // genuinely executed nothing, and the sweep would report a healthy lane as dead. Emptiness is
  // therefore checked before the conversion rather than after it.
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(`jobs read for run ${runId} returned no count: ${JSON.stringify(raw)}`);
  }
  return Number(trimmed);
}

/**
 * Every issue carrying a dead-lane marker, open or closed. Closed ones
 * matter: a lane that was reported, fixed and closed must not be reported
 * again for the same runs, and the only durable fact that says so is when
 * the signal was closed.
 */
function readSignals(gh: GhExec): Array<z.infer<typeof SignalIssue>> {
  const raw = gh([
    "issue",
    "list",
    "--state",
    "all",
    "--limit",
    "200",
    "--json",
    "number,body,state,closedAt",
  ]);
  return SignalIssue.array().parse(JSON.parse(raw));
}

export function runWatchdog(options: RunWatchdogOptions): WatchdogOutcome {
  const { gh, eventAction, assignee } = options;
  const now = options.now ?? new Date();
  const log = options.log ?? ((line: string) => console.log(line));

  if (eventAction !== WATCHDOG_DISPATCH_ACTION) {
    return { action: "skipped", code: "not-a-session-dispatch", deadCount: 0, signals: [] };
  }

  const runs = readRuns(gh);
  const candidates = runs.filter((run) => isCandidate(run, now));

  // What the page did not reach is said out loud. A window silently clipped to whatever fitted is
  // the exact shape of the failure this watches for: an all-clear that was never actually checked.
  const oldest = runs[runs.length - 1];
  if (runs.length >= RUN_PAGE_SIZE && oldest && isCandidate(oldest, now)) {
    log(`note: one page of ${RUN_PAGE_SIZE} runs reaches only back to ${oldest.createdAt} — anything older was not swept`);
  }

  const read = candidates.slice(0, MAX_JOB_READS);
  if (candidates.length > read.length) {
    log(`note: ${candidates.length - read.length} failed run(s) in the window went unread — the sweep spends at most ${MAX_JOB_READS} job counts`);
  }

  const counted = read.map((run) => ({ ...run, jobCount: jobCount(gh, run.id) }));
  const lanes = deadLanes(counted);
  if (lanes.length === 0) {
    log("swept: no lane executed zero jobs");
    return { action: "swept", code: "all-lanes-live", deadCount: 0, signals: [] };
  }

  const signals: WatchdogOutcome["signals"] = [];
  const existing = readSignals(gh);
  const reportable = lanes.slice(0, MAX_SIGNALS);
  if (lanes.length > reportable.length) {
    log(`note: ${lanes.length - reportable.length} further dead lane(s) not written about this sweep — at most ${MAX_SIGNALS} per sweep`);
  }

  for (const lane of reportable) {
    const written = report({ gh, lane, existing, assignee, log });
    if (written) signals.push(written);
  }

  log(`swept: ${lanes.length} dead lane(s), ${signals.length} signal(s) written`);
  return { action: "swept", code: "dead-lanes-found", deadCount: lanes.length, signals };
}

function report(options: {
  gh: GhExec;
  lane: DeadLane;
  existing: Array<z.infer<typeof SignalIssue>>;
  assignee: string;
  log: (line: string) => void;
}): WatchdogOutcome["signals"][number] | undefined {
  const { gh, lane, existing, assignee, log } = options;
  const marker = signalMarker(lane.path);
  const carriers = existing.filter((issue) => (issue.body ?? "").includes(marker));

  const standing = carriers.find((issue) => issue.state.toUpperCase() === "OPEN");
  if (standing) {
    // Thirteen dead runs are one dead lane. A second issue per run would be this ticket's failure
    // with the sign flipped — a signal nobody reads because there is too much of it.
    const newest = lane.runs[0];
    gh([
      "issue",
      "comment",
      String(standing.number),
      "--body",
      `Still dead: [run ${newest.id}](${newest.htmlUrl}) on \`${newest.headBranch}\` also executed zero jobs (${newest.createdAt}).`,
    ]);
    log(`commented on #${standing.number}: ${lane.path} is still dead`);
    return { lane: lane.path, issue: standing.number, wrote: "commented" };
  }

  // A signal that was closed is a lane somebody dealt with. Re-reporting the same runs would teach
  // the reader to close this mechanism's issues unread, so only a run *newer* than that close
  // reopens the question — recomputed from the issue, with no cursor to keep.
  const newestClose = carriers
    .map((issue) => issue.closedAt)
    .filter((at): at is string => Boolean(at))
    .sort()
    .pop();
  if (newestClose && lane.runs[0].createdAt <= newestClose) {
    log(`ignored ${lane.path}: every dead run predates the close of its signal (${newestClose})`);
    return undefined;
  }

  const url = gh([
    "issue",
    "create",
    "--title",
    signalTitle(lane),
    "--body",
    signalBody(lane),
    "--assignee",
    assignee,
  ]).trim();
  const opened = Number(url.split("/").pop());
  log(`opened #${opened}: ${lane.path} executed zero jobs in ${lane.runs.length} run(s)`);
  return { lane: lane.path, issue: opened, wrote: "opened" };
}

async function main(): Promise<void> {
  try {
    const assignee = process.env.SIGNAL_ASSIGNEE;
    if (!assignee) throw new Error("SIGNAL_ASSIGNEE must be set — an unassigned issue notifies nobody");

    const outcome = runWatchdog({
      gh: execGh,
      eventAction: process.env.EVENT_ACTION,
      assignee,
    });
    console.log(`${outcome.action} (${outcome.code}): ${outcome.deadCount} dead, ${outcome.signals.length} written`);
  } catch (err) {
    console.error(`run-watchdog failed: ${reason(err)}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
