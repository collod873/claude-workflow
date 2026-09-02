import { pathToFileURL } from "node:url";
import { z } from "zod";
import { execGh, type GhExec } from "../shared/gh";
import { repoRunsPathFor } from "../shared/gh-paths";
import { execGit, type GitExec } from "../shared/git";
import { reason } from "../shared/reason";
import { WATCHDOG_DISPATCH_ACTION } from "./run-watchdog";

/**
 * The walk-home sweep (ADR-0135 as amended by ADR-0141, ADR-0136, #326, #330): a red run in an
 * enrolled repository is routed by its failing path — a machine-side failure files a ticket-shaped
 * issue **here**, on `to-build`, so lane 06 starts on it without the spec chain; a caller-side
 * failure files into that repository's own tracker. Either way the routing costs one set lookup and
 * no model. `routeFor` is the rule and carries the reasoning; only a run of a `*-caller.yml` stub
 * is considered at all, because nothing else checked the machine out.
 *
 * Sibling of `./run-watchdog.ts`, and built to read like one:
 *
 * **Rides session end, like every other standing sweep here (ADR-0004).** `WATCHDOG_DISPATCH_ACTION`
 * is imported rather than restated, so this and `run-watchdog.ts` can never drift on the one string
 * both their workflows gate a job's `if` on.
 *
 * **Recomputes, stores nothing.** No cursor, no ledger. Whether a run has already been walked home
 * is answered by searching the tracker it would have written to for that run's own marker — the
 * same shape `dead-lanes.ts`'s `signalMarker`/`markedLane` use, keyed on `repository:runId`. A
 * GitHub run id is unique platform-wide on its own, but the marker carries the repository too so a
 * reader never has to look the id up to know which tracker it belongs to.
 *
 * **The credential is `ENROL_PAT`** (ADR-0136): the only PAT this repository sends outward already
 * reaches every enrolled repository, so filing into a caller's own tracker spends no new one. Every
 * `gh` call below — reading an enrolled repository's runs, filing there, and filing here — goes
 * through the one `GhExec` this lane's workflow points at `secrets.ENROL_PAT`.
 *
 * **The enrolled set is the topic, not a list.** `enrol/enrol.ts` already answers this question, but
 * `watchdog/` may not deep-import `enrol/` (a lane may not deep-import another lane,
 * docs/agents/module-boundaries.md) — so the same `GET /search/repositories?q=topic:…` call is
 * repeated here rather than shared, over the same public, non-secret topic string.
 *
 * **Declared ceiling.** `MAX_LOG_READS` bounds how many failing-step logs one sweep will read across
 * the whole topic — each is its own network round trip against a repository this machine does not
 * own — and a run that goes unread because the cap was already spent is logged rather than silently
 * skipped.
 */

/** The repository topic that means "run this machine's lanes" — `enrol/enrol.ts`'s own
 * `ENROLMENT_TOPIC`, restated rather than imported (see the module doc above). */
const ENROLMENT_TOPIC = "claude-workflow-enrolled";

/** How many repositories one topic search page returns. Above any plausible estate. */
const SEARCH_PAGE_SIZE = 100;

/** One page of runs per enrolled repository, matching `dead-lanes.ts`'s own page size. */
const RUN_PAGE_SIZE = 100;

/** How far back a sweep looks for a failed run worth walking home. */
const LOOKBACK_DAYS = 7;

/** How many lines of a failing step's log this sweep carries into a filed issue. */
const LOG_TAIL_LINES = 80;

/** The most failing-step logs one sweep will read, across every enrolled repository. */
export const MAX_LOG_READS = 30;

/** The most issues one sweep will file, across every enrolled repository. */
export const MAX_FILED = 5;

const RunSummary = z.object({
  id: z.number(),
  path: z.string(),
  status: z.string(),
  conclusion: z.string().nullable(),
  htmlUrl: z.string(),
  createdAt: z.string(),
});
type RunSummary = z.infer<typeof RunSummary>;

const IssueBody = z.object({ body: z.string().nullable() });

export interface WalkHomeOptions {
  gh: GhExec;
  /** `github.event.action` on the dispatch that triggered this run — see `WATCHDOG_DISPATCH_ACTION`. */
  eventAction: string | null | undefined;
  /** This repository's own `owner/name`, so a repository never walks its own runs home to itself. */
  machineRepository: string;
  /** The machine commit a filed machine-side ticket names as the revision to fix at or after. */
  machineSha: string;
  /** Every file the machine checkout tracks — what `routeFor` proves a machine-side failure
   * against. Injected so a test can pin it. */
  machineFiles: ReadonlySet<string>;
  /** The moment the sweep's lookback window is measured back from. Injected so a test can pin it. */
  now?: Date;
  log?: (line: string) => void;
}

export type WalkHomeAction = "skipped" | "swept";

export interface FiledTicket {
  repository: string;
  runId: number;
  routed: "machine" | "caller";
  issue: number;
}

export interface WalkHomeOutcome {
  action: WalkHomeAction;
  /** A stable slug for the log. */
  code: string;
  repositoriesSwept: number;
  /** Every issue this sweep filed, in the order it filed them. */
  filed: FiledTicket[];
  /** One entry per enrolled repository this sweep could not finish — never empty on a clean sweep. */
  failures: string[];
}

/** Every repository carrying the enrolment topic, as `owner/name` — the whole enumeration. */
function enrolledRepositories(gh: GhExec): string[] {
  const raw = gh([
    "api",
    "--paginate",
    `search/repositories?q=topic:${ENROLMENT_TOPIC}&per_page=${SEARCH_PAGE_SIZE}`,
    "--jq",
    ".items[].full_name",
  ]);
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

/** Whether `createdAt` falls inside the lookback window, measured back from `now`. */
function withinLookback(createdAt: string, now: Date): boolean {
  const age = now.getTime() - new Date(createdAt).getTime();
  return age >= 0 && age <= LOOKBACK_DAYS * 24 * 60 * 60 * 1000;
}

/** Every run of `repository` that completed, failed, and falls inside the lookback window. */
function failedRuns(gh: GhExec, repository: string, now: Date): RunSummary[] {
  const raw = gh([
    "api",
    repoRunsPathFor(repository, RUN_PAGE_SIZE),
    "--jq",
    "[.workflow_runs[] | {id, path, status, conclusion, htmlUrl: .html_url, createdAt: .created_at}]",
  ]);
  return RunSummary.array()
    .parse(JSON.parse(raw))
    .filter((run) => run.status === "completed" && run.conclusion === "failure")
    .filter((run) => withinLookback(run.createdAt, now));
}

/** The last `LOG_TAIL_LINES` lines of `runId`'s own failing step(s) — never the whole run's log,
 * which for a long-running lane can run to thousands of lines a filed issue has no business
 * carrying in full. */
function failingStepLogTail(gh: GhExec, repository: string, runId: number): string {
  const raw = gh(["run", "view", String(runId), "-R", repository, "--log-failed"]);
  return raw.split("\n").slice(-LOG_TAIL_LINES).join("\n").trim();
}

/**
 * A repo-relative-looking path named in a failing step's log — the first one, since that is
 * ordinarily the file the failure is actually about (a test file a runner announces before its
 * failure, a source file a stack trace's first frame names). `undefined` means the log named
 * nothing this sweep can route on, which is reported rather than guessed at.
 */
const LOG_PATH_RE = /(?:^|[\s"'`(])((?:target\/)?[\w.-]+(?:\/[\w.-]+)+\.[A-Za-z0-9]+)(?=[\s"'`):,]|$)/m;

export function failingPath(logTail: string): string | undefined {
  return LOG_PATH_RE.exec(logTail)?.[1];
}

/**
 * Where a failing path's defect belongs — the whole routing rule (ADR-0135 as amended by ADR-0141),
 * and the one place it is spelled.
 *
 * Every reusable lane checks the machine out at the workspace root and the calling repository at
 * `target/` (`shared/checkout-pair.fixture.ts`), so that prefix settles it when it is printed. It
 * usually is not: vitest and eslint name paths relative to the target's own cwd, so the first path
 * in a failing log is ordinarily bare. Reading a bare path as the machine's is what put five of an
 * enrolled repository's own test failures on `to-build`, so the machine is **proven, not assumed** —
 * a bare path is the machine's only if it is a file this checkout actually tracks, and anything
 * else is the caller's.
 *
 * `machineFiles` is that tracked set, injected rather than read here so a test can pin it. The
 * sweep runs inside the machine checkout, so the tree is the list and there is no prefix roster to
 * maintain (ADR-0057).
 */
export function routeFor(path: string, machineFiles: ReadonlySet<string>): "machine" | "caller" {
  if (path === "target" || path.startsWith("target/")) return "caller";
  return machineFiles.has(path) ? "machine" : "caller";
}

/** Every file the machine checkout tracks, as `routeFor` reads it. */
export function machineFilesFrom(git: GitExec): ReadonlySet<string> {
  return new Set(
    git(["ls-files"])
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== ""),
  );
}

/**
 * Whether a run of `workflowPath` could carry a machine defect at all. Only a caller stub reaches
 * `uses:` into this repository, and the stub set is globbed as `*-caller.yml` (`enrol/enrol.ts`),
 * so a run of any other workflow — the caller's own CI, its licence gate — never checked the
 * machine out and has no machine side to route to.
 */
export function ranMachineLane(workflowPath: string): boolean {
  return workflowPath.endsWith("-caller.yml");
}

/** `owner/name:runId` — what one walked-home run is keyed on, wherever its marker is read. */
function markerKey(repository: string, runId: number): string {
  return `${repository}:${runId}`;
}

/** A hidden marker naming one walked-home run, so a second sweep over the same run writes nothing. */
function walkHomeMarker(repository: string, runId: number): string {
  return `<!-- walk-home:${markerKey(repository, runId)} -->`;
}

const MARKER_RE = /<!-- walk-home:([^\s>]+) -->/g;

/** Every run this sweep has already walked home, as read out of one tracker's own issues — open or
 * closed, since a closed one is still proof this run was already reported once. */
function readWalkedHome(gh: GhExec, repository?: string): Set<string> {
  const args = repository
    ? ["issue", "list", "-R", repository, "--state", "all", "--limit", "200", "--json", "body"]
    : ["issue", "list", "--state", "all", "--limit", "200", "--json", "body"];
  const raw = gh(args);
  const issues = IssueBody.array().parse(JSON.parse(raw));
  const keys = new Set<string>();
  for (const issue of issues) {
    for (const match of (issue.body ?? "").matchAll(MARKER_RE)) keys.add(match[1]);
  }
  return keys;
}

const TO_BUILD_LABEL = "to-build";

function machineTicketTitle(repository: string, path: string): string {
  return `${repository}: ${path} failed inside the machine checkout`;
}

function machineTicketBody(repository: string, run: RunSummary, machineSha: string, path: string, logTail: string): string {
  return [
    "## What to build",
    "",
    `A run of \`${run.path}\` in \`${repository}\` — an enrolled repository (docs/agents/enrolment.md)`,
    `— failed with its failing step naming \`${path}\`, a path inside the machine checkout rather`,
    "than the caller's own tree (ADR-0135). That makes it this repository's own defect, filed here",
    "by the walk-home sweep (ADR-0136) rather than left for a human to decide whose it is.",
    "",
    `- Run: ${run.htmlUrl}`,
    `- Machine SHA: \`${machineSha}\``,
    `- Failing path: \`${path}\``,
    "",
    "Log tail:",
    "",
    "```",
    logTail,
    "```",
    "",
    "## Acceptance criteria",
    "",
    `- [ ] \`${path}\` no longer fails this way, at or after machine SHA \`${machineSha}\``,
    "",
    "## Files claimed",
    "",
    `- ${path}`,
    "",
    walkHomeMarker(repository, run.id),
  ].join("\n");
}

function callerIssueTitle(path: string): string {
  return `${path} failed`;
}

function callerIssueBody(repository: string, run: RunSummary, path: string, logTail: string): string {
  return [
    `A run of \`${run.path}\` failed with its failing step naming \`${path}\`, a path inside this`,
    "repository's own tree rather than the claude-workflow machine checkout — so this is this",
    "repository's own defect, not the machine's (ADR-0135). Filed by claude-workflow's walk-home",
    "sweep (ADR-0136), which runs there under a credential scoped to write here, and nowhere else.",
    "",
    `- Run: ${run.htmlUrl}`,
    `- Failing path: \`${path}\``,
    "",
    "Log tail:",
    "",
    "```",
    logTail,
    "```",
    "",
    walkHomeMarker(repository, run.id),
  ].join("\n");
}

/** Files `run` home, having already decided it is new evidence — one issue, in the tracker its
 * failing path names, and the `FiledTicket` record the caller reports back. */
function file(
  gh: GhExec,
  repository: string,
  run: RunSummary,
  machineSha: string,
  path: string,
  logTail: string,
  machineFiles: ReadonlySet<string>,
): FiledTicket {
  if (routeFor(path, machineFiles) === "caller") {
    const url = gh([
      "issue",
      "create",
      "-R",
      repository,
      "--title",
      callerIssueTitle(path),
      "--body",
      callerIssueBody(repository, run, path, logTail),
    ]).trim();
    return { repository, runId: run.id, routed: "caller", issue: Number(url.split("/").pop()) };
  }

  const url = gh([
    "issue",
    "create",
    "--title",
    machineTicketTitle(repository, path),
    "--body",
    machineTicketBody(repository, run, machineSha, path, logTail),
    "--label",
    TO_BUILD_LABEL,
  ]).trim();
  return { repository, runId: run.id, routed: "machine", issue: Number(url.split("/").pop()) };
}

/** One enrolled repository's share of a sweep: every failed run in its window, walked home unless
 * it already was or the sweep's own read/write budget is spent. */
function walkOneRepository(
  gh: GhExec,
  repository: string,
  machineSha: string,
  now: Date,
  hereMarkers: Set<string>,
  budget: { logReads: number; filed: number },
  machineFiles: ReadonlySet<string>,
  log: (line: string) => void,
): FiledTicket[] {
  const runs = failedRuns(gh, repository, now).filter((run) => ranMachineLane(run.path));
  if (runs.length === 0) return [];

  let callerMarkers: Set<string> | undefined;
  const filed: FiledTicket[] = [];

  for (const run of runs) {
    const key = markerKey(repository, run.id);
    if (hereMarkers.has(key)) continue;

    if (budget.filed <= 0) {
      log(`${repository} run ${run.id}: not walked home — this sweep already filed ${MAX_FILED}`);
      continue;
    }
    if (budget.logReads <= 0) {
      log(`${repository} run ${run.id}: not walked home — this sweep already read ${MAX_LOG_READS} log(s)`);
      continue;
    }

    budget.logReads -= 1;
    const logTail = failingStepLogTail(gh, repository, run.id);
    const path = failingPath(logTail);
    if (path === undefined) {
      log(`${repository} run ${run.id}: its failing step's log names no path this sweep can route on`);
      continue;
    }

    if (routeFor(path, machineFiles) === "caller") {
      callerMarkers ??= readWalkedHome(gh, repository);
      if (callerMarkers.has(key)) continue;
    }

    const ticket = file(gh, repository, run, machineSha, path, logTail, machineFiles);
    budget.filed -= 1;
    log(`${repository} run ${run.id}: filed ${ticket.routed === "machine" ? "here" : "there"} as #${ticket.issue} (${path})`);
    filed.push(ticket);
  }

  return filed;
}

export function walkHome(options: WalkHomeOptions): WalkHomeOutcome {
  const { gh, eventAction, machineRepository, machineSha, machineFiles } = options;

  // The refusal comes before the defaults rather than after: a sweep that is not going to run has
  // no clock and no logger to take. `run-watchdog.ts` reads the same guard the other way round,
  // and the clone gate is right that the pair was one copied span.
  if (eventAction !== WATCHDOG_DISPATCH_ACTION) {
    return { action: "skipped", code: "not-a-session-dispatch", repositoriesSwept: 0, filed: [], failures: [] };
  }

  const now = options.now ?? new Date();
  const log = options.log ?? ((line: string) => console.log(line));

  const repositories = enrolledRepositories(gh).filter((repository) => repository !== machineRepository);
  if (repositories.length === 0) {
    log(`no repository carries the topic ${ENROLMENT_TOPIC} — nothing to walk home`);
    return { action: "swept", code: "no-enrolled-repositories", repositoriesSwept: 0, filed: [], failures: [] };
  }

  const hereMarkers = readWalkedHome(gh);
  const budget = { logReads: MAX_LOG_READS, filed: MAX_FILED };
  const filed: FiledTicket[] = [];
  const failures: string[] = [];

  for (const repository of repositories) {
    try {
      filed.push(...walkOneRepository(gh, repository, machineSha, now, hereMarkers, budget, machineFiles, log));
    } catch (err) {
      const message = `${repository}: ${reason(err)}`;
      log(`FAILED: ${message}`);
      failures.push(message);
    }
  }

  const code = failures.length > 0 ? "repository-failed" : filed.length > 0 ? "walked-home" : "all-clear";
  log(`swept ${repositories.length} repositor${repositories.length === 1 ? "y" : "ies"}: ${filed.length} run(s) walked home, ${failures.length} failure(s)`);
  return { action: "swept", code, repositoriesSwept: repositories.length, filed, failures };
}

async function main(): Promise<void> {
  try {
    const machineRepository = process.env.GITHUB_REPOSITORY;
    if (!machineRepository) {
      throw new Error("GITHUB_REPOSITORY must be set — without it this sweep cannot tell itself from a target");
    }
    const machineSha = process.env.GITHUB_SHA;
    if (!machineSha) {
      throw new Error("GITHUB_SHA must be set — a filed ticket needs the machine's own revision");
    }

    const outcome = walkHome({
      gh: execGh,
      eventAction: process.env.EVENT_ACTION,
      machineRepository,
      machineSha,
      machineFiles: machineFilesFrom(execGit),
    });
    console.log(`${outcome.action} (${outcome.code}): ${outcome.filed.length} run(s) walked home across ${outcome.repositoriesSwept} repositor${outcome.repositoriesSwept === 1 ? "y" : "ies"}`);

    if (outcome.failures.length > 0) {
      console.error(outcome.failures.join("\n"));
      process.exitCode = 1;
    }
  } catch (err) {
    console.error(`walk-home failed: ${reason(err)}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
