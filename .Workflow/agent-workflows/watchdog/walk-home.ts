import { pathToFileURL } from "node:url";
import { z } from "zod";
import { execGh, type GhExec } from "../shared/gh";
import { repoRunsPathFor } from "../shared/gh-paths";
import { execGit, type GitExec } from "../shared/git";
import { touchesImmutableSet } from "../shared/immutable-set";
import { NEEDS_HUMAN_LABEL } from "../shared/needs-human";
import { reason } from "../shared/reason";
import { WATCHDOG_DISPATCH_ACTION } from "./run-watchdog";

const ENROLMENT_TOPIC = "claude-workflow-enrolled";

const SEARCH_PAGE_SIZE = 100;

const RUN_PAGE_SIZE = 100;

const LOOKBACK_DAYS = 7;

const LOG_TAIL_LINES = 80;

export const MAX_LOG_READS = 30;

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
  eventAction: string | null | undefined;
  machineRepository: string;
  machineSha: string;
  machineFiles: ReadonlySet<string>;
  now?: Date;
  log?: (line: string) => void;
}

export type WalkHomeAction = "skipped" | "swept";

export interface FiledTicket {
  repository: string;
  runId: number;
  routed: "machine" | "caller" | "needs-human";
  issue: number;
}

export interface WalkHomeOutcome {
  action: WalkHomeAction;
  code: string;
  repositoriesSwept: number;
  filed: FiledTicket[];
  failures: string[];
}

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

function withinLookback(createdAt: string, now: Date): boolean {
  const age = now.getTime() - new Date(createdAt).getTime();
  return age >= 0 && age <= LOOKBACK_DAYS * 24 * 60 * 60 * 1000;
}

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

function failingStepLogTail(gh: GhExec, repository: string, runId: number): string {
  const raw = gh(["run", "view", String(runId), "-R", repository, "--log-failed"]);
  return raw.split("\n").slice(-LOG_TAIL_LINES).join("\n").trim();
}

const LOG_PATH_RE = /(?:^|[\s"'`(])((?:target\/)?[\w.-]+(?:\/[\w.-]+)+\.[A-Za-z0-9]+)(?=[\s"'`):,]|$)/m;

export function failingPath(logTail: string): string | undefined {
  return LOG_PATH_RE.exec(logTail)?.[1];
}

export function routeFor(path: string, machineFiles: ReadonlySet<string>): "machine" | "caller" {
  if (path === "target" || path.startsWith("target/")) return "caller";
  return machineFiles.has(path) ? "machine" : "caller";
}

export function machineFilesFrom(git: GitExec): ReadonlySet<string> {
  return new Set(
    git(["ls-files"])
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== ""),
  );
}

export function ranMachineLane(workflowPath: string): boolean {
  return workflowPath.endsWith("-caller.yml");
}

function markerKey(repository: string, runId: number): string {
  return `${repository}:${runId}`;
}

function walkHomeMarker(repository: string, runId: number): string {
  return `<!-- walk-home:${markerKey(repository, runId)} -->`;
}

const MARKER_RE = /<!-- walk-home:([^\s>]+) -->/g;

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

const TS_SUFFIXES = [".proc.test.ts", ".test.ts", ".ts"];

function derivedCheckCommand(path: string): string | undefined {
  const suffix = TS_SUFFIXES.find((candidate) => path.endsWith(candidate));
  if (suffix === undefined) return undefined;
  return `npx vitest run ${path.slice(0, -suffix.length)}`;
}

function machineTicketBody(repository: string, run: RunSummary, machineSha: string, path: string, logTail: string): string {
  const check = derivedCheckCommand(path);
  const criterion = `- [ ] \`${path}\` no longer fails this way, at or after machine SHA \`${machineSha}\`${
    check === undefined ? "" : ` - check: \`${check}\``
  }`;
  return [
    "## What to build",
    "",
    `A run of \`${run.path}\` in \`${repository}\`, an enrolled repository (docs/agents/enrolment.md),`,
    `failed with its failing step naming \`${path}\`, a path inside the machine checkout rather`,
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
    criterion,
    "",
    "## Files claimed",
    "",
    `- ${path}`,
    "",
    walkHomeMarker(repository, run.id),
  ].join("\n");
}

function machineImmutableTicketTitle(repository: string, path: string): string {
  return `${repository}: ${path} failed inside the machine's own immutable set`;
}

function machineImmutableTicketBody(repository: string, run: RunSummary, machineSha: string, path: string, logTail: string): string {
  return [
    `A run of \`${run.path}\` in \`${repository}\`, an enrolled repository (docs/agents/enrolment.md),`,
    `failed with its failing step naming \`${path}\`, a path inside the machine checkout's own`,
    "immutable set (`vitest.config.ts`, `.github/`). No pull request may edit",
    "it (ADR-0053), so no implementer could ever build a ticket claiming it, so it is filed `needs-human`",
    "here instead of `to-build`.",
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
    walkHomeMarker(repository, run.id),
  ].join("\n");
}

function callerIssueTitle(path: string): string {
  return `${path} failed`;
}

function callerIssueBody(repository: string, run: RunSummary, path: string, logTail: string): string {
  return [
    `A run of \`${run.path}\` failed with its failing step naming \`${path}\`, a path inside this`,
    "repository's own tree rather than the claude-workflow machine checkout, so this is this",
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

  if (touchesImmutableSet([path])) {
    const url = gh([
      "issue",
      "create",
      "--title",
      machineImmutableTicketTitle(repository, path),
      "--body",
      machineImmutableTicketBody(repository, run, machineSha, path, logTail),
      "--label",
      NEEDS_HUMAN_LABEL,
    ]).trim();
    return { repository, runId: run.id, routed: "needs-human", issue: Number(url.split("/").pop()) };
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
      log(`${repository} run ${run.id}: not walked home; this sweep already filed ${MAX_FILED}`);
      continue;
    }
    if (budget.logReads <= 0) {
      log(`${repository} run ${run.id}: not walked home; this sweep already read ${MAX_LOG_READS} log(s)`);
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
    log(`${repository} run ${run.id}: filed ${ticket.routed === "caller" ? "there" : "here"} as #${ticket.issue} (${path})`);
    filed.push(ticket);
  }

  return filed;
}

export function walkHome(options: WalkHomeOptions): WalkHomeOutcome {
  const { gh, eventAction, machineRepository, machineSha, machineFiles } = options;

  if (eventAction !== WATCHDOG_DISPATCH_ACTION) {
    return { action: "skipped", code: "not-a-session-dispatch", repositoriesSwept: 0, filed: [], failures: [] };
  }

  const now = options.now ?? new Date();
  const log = options.log ?? ((line: string) => console.log(line));

  const repositories = enrolledRepositories(gh).filter((repository) => repository !== machineRepository);
  if (repositories.length === 0) {
    log(`no repository carries the topic ${ENROLMENT_TOPIC}; nothing to walk home`);
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
      throw new Error("GITHUB_REPOSITORY must be set: without it this sweep cannot tell itself from a target");
    }
    const machineSha = process.env.GITHUB_SHA;
    if (!machineSha) {
      throw new Error("GITHUB_SHA must be set: a filed ticket needs the machine's own revision");
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
