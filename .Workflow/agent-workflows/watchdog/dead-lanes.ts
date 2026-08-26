/**
 * The judgement half of the run watchdog (#41), kept apart from the IO half
 * (`./run-watchdog.ts`) so it can be run over the history that motivated it —
 * `push-runs.evidence.json`, every push run this repo has, captured from the
 * API with the job count the watchdog reads.
 *
 * A workflow file GitHub cannot parse produces a run that completes having
 * executed **nothing**. No job, no check-run, no annotation:
 * `gh api .../commits/<sha>/check-runs` came back empty for all thirteen
 * consecutive ones against `main`, so the failure was absent from every
 * surface a person actually looks at. Two PRDs were labelled `prd` in that
 * window and neither sliced; #25 closed green anyway because the work was
 * done by hand and nothing asked where it came from.
 *
 * The rule is about the shape of the run and not about which workflow it
 * was: **a run that executed zero jobs is a dead lane**, whatever lane it is
 * and whether or not that lane existed when this was written. A job a
 * job-level `if` skipped does not qualify — GitHub lists a skipped job, so
 * the count is one, and that is exactly the line between "the lane declined
 * this event" and "the lane could not start".
 */

/** One completed run, as the Actions runs list carries it plus the count that list omits. */
export interface RunSummary {
  id: number;
  /** The workflow's declared name — or its own file path, when GitHub could not read a `name:`. */
  name: string;
  /** The workflow file. Stable whether or not GitHub could parse it, which is why the lane is keyed here. */
  path: string;
  status: string;
  conclusion: string;
  htmlUrl: string;
  headBranch: string;
  /** ISO 8601, as the API returns it. */
  createdAt: string;
  /** How many jobs the run executed, from `actions/runs/<id>/jobs`. Absent until that read happens. */
  jobCount?: number;
}

/** One workflow that has produced at least one run executing nothing, and the runs that prove it. */
export interface DeadLane {
  /** The workflow file — the lane's identity, and what the signal's marker is keyed on. */
  path: string;
  /** How the newest dead run was named, for the reader. */
  name: string;
  /** Every dead run in the window, newest first. */
  runs: RunSummary[];
}

/**
 * How far back a sweep looks. Long enough to cover a break that landed
 * before a weekend, short enough to fit in one page of runs. A dead run
 * older than this is history: opening an issue about it would be filing work
 * against a break nobody remembers making.
 *
 * Mirrors `close-gate/reconcile.ts`'s own window, for the same reasons and
 * deliberately at the same size — both sweeps ride the same dispatch, and
 * two lookbacks that differed would be two answers to "how far back does
 * this repo remember".
 */
export const LOOKBACK_DAYS = 7;

/**
 * One page of runs. A hundred covers this repo's busiest day several times
 * over — the heaviest observed is 22 — and where it does not, the window is
 * clipped to what the page reaches and the clipping is logged rather than
 * left to look like an all-clear.
 */
export const RUN_PAGE_SIZE = 100;

/**
 * The most job-count reads one sweep will spend. Each candidate costs one
 * API call, and a repo mid-incident can fail a great many runs; a sweep that
 * spent four hundred calls would be reporting its own lack of a bound. What
 * it declines to read is logged, because a cap nobody is told about reads as
 * "there was nothing else" — the failure this whole mechanism exists for.
 */
export const MAX_JOB_READS = 60;

/**
 * The most lanes one sweep will write about. A watchdog that opened eight
 * issues at once would be the ticket's own failure with the sign flipped: a
 * signal nobody reads because there is too much of it.
 */
export const MAX_SIGNALS = 3;

/**
 * A run worth spending a job-count read on: it finished, it failed, and it
 * is inside the window. The failure filter is not the rule — the rule is the
 * job count — but a run that executed no job cannot report success, and
 * every one of the 25 in this repo's history concluded `failure`.
 */
export function isCandidate(run: RunSummary, now: Date): boolean {
  if (run.status !== "completed" || run.conclusion !== "failure") return false;
  const age = now.getTime() - new Date(run.createdAt).getTime();
  return age >= 0 && age <= LOOKBACK_DAYS * 24 * 60 * 60 * 1000;
}

/** Whether `run` completed having executed nothing. The whole rule. */
export function executedNothing(run: RunSummary): boolean {
  return run.jobCount === 0;
}

/**
 * The dead lanes among `runs`, newest run first within each, and lanes
 * ordered by their newest run. Groups on the workflow **file**, not its
 * name: a workflow GitHub could not parse has no name to group on — the run
 * is named after the file — and a break that is later fixed and re-broken
 * must land on the same lane both times.
 */
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

/**
 * A hidden marker naming the dead lane, so a second dead run of the same
 * workflow finds the standing signal instead of opening another. Keyed on
 * the file, because the lane is what is dead — thirteen runs of one
 * unparseable file are one problem.
 */
export function signalMarker(path: string): string {
  return `<!-- dead-lane:${path} -->`;
}

/** The signal's title. Stable across sweeps so a reader recognises a repeat. */
export function signalTitle(lane: DeadLane): string {
  return `${lane.path} is dead: its runs execute zero jobs`;
}

export function signalBody(lane: DeadLane): string {
  const newest = lane.runs[0];
  const count = lane.runs.length;
  return [
    `\`${lane.path}\` has produced ${count} run${count === 1 ? "" : "s"} in the last ${LOOKBACK_DAYS} days that`,
    "completed having executed **zero jobs**.",
    "",
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
