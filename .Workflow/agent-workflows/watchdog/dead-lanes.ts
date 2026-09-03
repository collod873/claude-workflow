const STUB_SUFFIX = "-caller.yml";

export interface RunSummary {
  id: number;
  name: string;
  path: string;
  status: string;
  conclusion: string;
  htmlUrl: string;
  headBranch: string;
  createdAt: string;
  jobCount?: number;
}

export interface DeadLane {
  path: string;
  name: string;
  runs: RunSummary[];
}

export const LOOKBACK_DAYS = 7;

export const RUN_PAGE_SIZE = 100;

export const MAX_JOB_READS = 60;

export const MAX_SIGNALS = 3;

export function isCandidate(run: RunSummary, now: Date): boolean {
  if (run.status !== "completed" || run.conclusion !== "failure") return false;
  return inWindow(run, now);
}

export function inWindow(run: RunSummary, now: Date): boolean {
  const age = now.getTime() - new Date(run.createdAt).getTime();
  return age >= 0 && age <= LOOKBACK_DAYS * 24 * 60 * 60 * 1000;
}

export function executedNothing(run: RunSummary): boolean {
  return run.jobCount === 0;
}

export function deadLanes(runs: RunSummary[]): DeadLane[] {
  const byPath = new Map<string, RunSummary[]>();
  for (const run of runs.filter(executedNothing)) {
    const list = byPath.get(run.path) ?? [];
    list.push(run);
    byPath.set(run.path, list);
  }

  const lanes: DeadLane[] = [];
  for (const [path, laneRuns] of byPath) {
    const newestFirst = [...laneRuns].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    lanes.push({ path, name: newestFirst[0].name, runs: newestFirst });
  }
  return lanes.sort((a, b) => b.runs[0].createdAt.localeCompare(a.runs[0].createdAt));
}

export function signalMarker(path: string): string {
  return `<!-- dead-lane:${path} -->`;
}

export function markedLane(body: string): string | undefined {
  return /<!-- dead-lane:(.+?) -->/.exec(body)?.[1];
}

export function citedRuns(text: string): Set<number> {
  return new Set([...text.matchAll(/\/actions\/runs\/(\d+)/g)].map((match) => Number(match[1])));
}

export function unreportedRuns(lane: DeadLane, cited: Set<number>): RunSummary[] {
  return lane.runs.filter((run) => !cited.has(run.id));
}

export function reusableHalf(path: string): string {
  return path.endsWith(STUB_SUFFIX) ? `${path.slice(0, -STUB_SUFFIX.length)}.yml` : path;
}

export function callerHalf(path: string): string {
  return path.endsWith(STUB_SUFFIX) ? path : path.replace(/\.yml$/, STUB_SUFFIX);
}

export function signalTitle(lane: DeadLane): string {
  const reusable = reusableHalf(lane.path);
  const machinery = reusable === lane.path ? "" : ` (its machinery: ${reusable})`;
  return `${lane.path} is dead: its runs execute zero jobs${machinery}`;
}

export function signalBody(lane: DeadLane): string {
  const newest = lane.runs[0];
  const count = lane.runs.length;
  const reusable = reusableHalf(lane.path);
  const isStub = reusable !== lane.path;
  return [
    `\`${lane.path}\` has produced ${count} run${count === 1 ? "" : "s"} in the last ${LOOKBACK_DAYS} days that`,
    "completed having executed **zero jobs**.",
    "",
    ...(isStub
      ? [
          `\`${lane.path}\` is a caller stub — a trigger and \`uses:\`, six lines — that delegates to`,
          `\`${reusable}\`. That is almost always where a break like this actually lives: GitHub`,
          "attributes every run reached through `uses:` to the caller's file, never the reusable",
          "workflow underneath it.",
          "",
        ]
      : []),
    `Most recent: [run ${newest.id}](${newest.htmlUrl}) on \`${newest.headBranch}\`, ${newest.createdAt}.`,
    "",
    ...lane.runs.slice(0, 10).map((run) => `- [${run.id}](${run.htmlUrl}) — \`${run.headBranch}\`, ${run.createdAt}`),
    ...(count > 10 ? [`- …and ${count - 10} more`] : []),
    "",
    "**Zero jobs is not a lane that declined the event.** GitHub lists a skipped job, so a lane whose",
    "`if` was false has a job count of one. Zero means the run could not start at all, and the usual",
    "cause is a workflow file GitHub cannot parse.",
    "",
    "It reaches nobody on its own: no check-run on the commit, no annotation, nothing red on any",
    "surface a person reads. That is how thirteen consecutive dead runs went unnoticed for two days",
    "while two PRDs silently failed to slice ([#41](https://github.com/collod873/claude-workflow/issues/41)).",
    "This issue is the signal.",
    "",
    "**To confirm:**",
    "",
    "```",
    `gh run view ${newest.id} --log`,
    `actionlint ${lane.path}`,
    ...(isStub ? [`actionlint ${reusable}`] : []),
    "```",
    "",
    ...(newest.name === lane.path
      ? [
          "The run is named after its own file rather than a declared name — that is GitHub naming a",
          "workflow it could not parse well enough to read a `name:` out of.",
          "",
        ]
      : []),
    signalMarker(lane.path),
  ].join("\n");
}

export function stillDeadBody(fresh: RunSummary[]): string {
  const newest = fresh[0];
  const rest = fresh.slice(1);
  return [
    `Still dead: [run ${newest.id}](${newest.htmlUrl}) on \`${newest.headBranch}\` also executed zero jobs (${newest.createdAt}).`,
    ...(rest.length > 0
      ? [
          "",
          `${rest.length} further dead run${rest.length === 1 ? "" : "s"} since this lane was last noted here:`,
          "",
          ...rest.slice(0, 10).map((run) => `- [${run.id}](${run.htmlUrl}) — \`${run.headBranch}\`, ${run.createdAt}`),
          ...(rest.length > 10 ? [`- …and ${rest.length - 10} more`] : []),
        ]
      : []),
  ].join("\n");
}

export function retirementBody(lane: string, live: RunSummary): string {
  return [
    "## Closing record",
    "",
    "No diff.",
    "",
    `\`${lane}\` starts again: [run ${live.id}](${live.htmlUrl}) on \`${live.headBranch}\` executed jobs`,
    `(${live.createdAt}), and nothing in the last ${LOOKBACK_DAYS} days executed zero. The signal has`,
    "nothing left to stand for.",
    "",
    "This closes the signal, never the mechanism: the next run of this lane that executes nothing",
    "opens a fresh one against the same marker.",
  ].join("\n");
}
