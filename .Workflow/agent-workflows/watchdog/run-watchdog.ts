import { pathToFileURL } from "node:url";
import { z } from "zod";
import { execGh, type GhExec } from "../shared/gh";
import { repoRunsPath, runJobsPath } from "../shared/gh-paths";
import { reason } from "../shared/reason";
import {
  callerHalf,
  citedRuns,
  deadLanes,
  inWindow,
  isCandidate,
  markedLane,
  MAX_JOB_READS,
  MAX_SIGNALS,
  retirementBody,
  RUN_PAGE_SIZE,
  signalBody,
  signalMarker,
  signalTitle,
  stillDeadBody,
  unreportedRuns,
  type DeadLane,
  type RunSummary,
} from "./dead-lanes";

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
  eventAction: string | null | undefined;
  assignee: string;
  now?: Date;
  log?: (line: string) => void;
}

export type WatchdogAction = "skipped" | "swept";

export interface WatchdogOutcome {
  action: WatchdogAction;
  code: string;
  deadCount: number;
  signals: Array<{ lane: string; issue: number; wrote: "opened" | "commented" | "retired" }>;
}

function readRuns(gh: GhExec): RunSummary[] {
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

function jobCount(gh: GhExec, runId: number): number {
  const raw = gh(["api", runJobsPath(runId), "--jq", ".total_count"]);
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(`jobs read for run ${runId} returned no count: ${JSON.stringify(raw)}`);
  }
  return Number(trimmed);
}

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

const IssueComments = z.object({ comments: z.array(z.object({ body: z.string() })) });

function readSaid(gh: GhExec, issue: number, body: string | null): string {
  const raw = gh(["issue", "view", String(issue), "--json", "comments"]);
  const parsed = IssueComments.parse(JSON.parse(raw));
  return [body ?? "", ...parsed.comments.map((comment) => comment.body)].join("\n");
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

  const oldest = runs[runs.length - 1];
  const pageClipped = runs.length >= RUN_PAGE_SIZE && Boolean(oldest) && isCandidate(oldest, now);
  if (pageClipped) {
    log(`note: one page of ${RUN_PAGE_SIZE} runs reaches only back to ${oldest.createdAt} — anything older was not swept`);
  }

  const read = candidates.slice(0, MAX_JOB_READS);
  if (candidates.length > read.length) {
    log(`note: ${candidates.length - read.length} failed run(s) in the window went unread — the sweep spends at most ${MAX_JOB_READS} job counts`);
  }

  const counted = read.map((run) => ({ ...run, jobCount: jobCount(gh, run.id) }));
  const lanes = deadLanes(counted);

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

  if (pageClipped || candidates.length > read.length) {
    log("note: this sweep did not see its whole window, so no standing signal was retired");
  } else {
    signals.push(...retireRecovered({ gh, runs, lanes, existing, now, log }));
  }

  if (lanes.length === 0) {
    log(`swept: no lane executed zero jobs, ${signals.length} signal(s) retired`);
    return { action: "swept", code: "all-lanes-live", deadCount: 0, signals };
  }

  log(`swept: ${lanes.length} dead lane(s), ${signals.length} signal(s) written`);
  return { action: "swept", code: "dead-lanes-found", deadCount: lanes.length, signals };
}

function retireRecovered(options: {
  gh: GhExec;
  runs: RunSummary[];
  lanes: DeadLane[];
  existing: Array<z.infer<typeof SignalIssue>>;
  now: Date;
  log: (line: string) => void;
}): WatchdogOutcome["signals"] {
  const { gh, runs, lanes, existing, now, log } = options;
  const dead = new Set(lanes.map((lane) => lane.path));
  const retired: WatchdogOutcome["signals"] = [];

  for (const issue of existing) {
    if (issue.state.toUpperCase() !== "OPEN") continue;
    const path = markedLane(issue.body ?? "");
    if (!path || dead.has(path)) continue;

    const candidate = callerHalf(path);
    const live = runs.find(
      (run) => (run.path === path || run.path === candidate) && run.status === "completed" && inWindow(run, now),
    );
    if (!live) {
      log(`left #${issue.number} open: ${path} has not run inside the window, so nothing says it recovered`);
      continue;
    }

    try {
      gh(["issue", "comment", String(issue.number), "--body", retirementBody(path, live)]);
      gh(["issue", "close", String(issue.number), "--reason", "completed"]);
      log(`closed #${issue.number}: ${path} runs again (run ${live.id})`);
      retired.push({ lane: path, issue: issue.number, wrote: "retired" });
    } catch (err) {
      log(`could not close #${issue.number}: ${reason(err)}`);
    }
  }

  return retired;
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
    const fresh = unreportedRuns(lane, citedRuns(readSaid(gh, standing.number, standing.body)));
    if (fresh.length === 0) {
      log(`silent on #${standing.number}: ${lane.path} is still dead, and it already says so`);
      return undefined;
    }

    gh(["issue", "comment", String(standing.number), "--body", stillDeadBody(fresh)]);
    log(`commented on #${standing.number}: ${lane.path} died in ${fresh.length} further run(s)`);
    return { lane: lane.path, issue: standing.number, wrote: "commented" };
  }

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
