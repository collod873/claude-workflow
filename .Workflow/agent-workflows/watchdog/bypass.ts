/**
 * The judgement half of the bypass counter (PRD #117, move 8d), kept apart
 * from the IO half (`./bypass-counter.ts`) so it can be run over
 * `verify-runs.evidence.json` — this repo's own real `verify.yml` history on
 * `main`, captured with the failed step name the counter reads.
 *
 * `verify.yml`'s Gauntlet step now fails through two distinctly named steps
 * (`verify-workflow.test.ts`): `Gauntlet` on exit 1, a real finding that
 * reached `main` despite every free venue that should have caught it first;
 * `Gauntlet could not run` on exit 2, an environment problem that is nobody
 * routing around anything. A third named step, `Lint workflow files`, is
 * actionlint failing on the workflow YAML itself — unrelated to the
 * gauntlet's own verdict. Only the first of the three is a bypass: it is the
 * one case where a red tree reached trunk that the in-turn, turn-end and
 * pre-push venues would already have refused, which means one of them was
 * skipped — `--no-verify`, a clone where `npm ci` never ran, or a commit
 * made outside a session that runs the hooks at all.
 */

/** The step name a real Gauntlet finding (exit 1) fails through. Counting this step, and only this step, is the whole rule. */
export const BYPASS_STEP = "Gauntlet";

/** The step name exit 2 fails through — the checks could not run at all. An environment problem, never a bypass. */
export const COULD_NOT_RUN_STEP = "Gauntlet could not run";

/** The step name actionlint fails through on the workflow files themselves — unrelated to the gauntlet's own verdict. */
export const LINT_WORKFLOW_STEP = "Lint workflow files";

/** The count at which the counter proposes bringing move 10 (branch protection) forward. */
export const BYPASS_THRESHOLD = 3;

/** One completed `verify.yml` run, as the run/job read produces it. */
export interface VerifyRun {
  id: number;
  headBranch: string;
  createdAt: string;
  htmlUrl: string;
  conclusion: string;
  /** The step name whose conclusion was `failure` — `undefined` for a run that succeeded, or one whose failing step this counter has no name for. */
  failedStep?: string;
}

/**
 * Whether `run` is a bypass: a real Gauntlet finding that reached `main`.
 * `headBranch` is checked here rather than filtered upstream, so a run on
 * any other branch — a PR, a worktree push mid-review — never counts,
 * whatever step it failed through.
 */
export function isBypass(run: VerifyRun): boolean {
  return run.headBranch === "main" && run.conclusion === "failure" && run.failedStep === BYPASS_STEP;
}

/** Every run in `runs` that is a bypass. */
export function bypassRuns(runs: VerifyRun[]): VerifyRun[] {
  return runs.filter(isBypass);
}

/** How many bypasses `runs` carries — the count the counter proposes against. */
export function bypassCount(runs: VerifyRun[]): number {
  return bypassRuns(runs).length;
}

/** Whether `count` clears the threshold at which the counter proposes move 10. */
export function shouldPropose(count: number): boolean {
  return count >= BYPASS_THRESHOLD;
}

/**
 * A hidden marker recording the count a proposal was filed at, so a later
 * sweep can tell whether the count has grown since a declined proposal was
 * closed — the fact a re-proposal needs and the only fact this counter
 * stores anywhere, and it stores it on the issue rather than in this repo.
 */
export function countMarker(count: number): string {
  return `<!-- bypass-counter:${count} -->`;
}

/** The count recorded on a marker inside `body`, or `undefined` if it carries none. */
export function markedCount(body: string): number | undefined {
  const match = body.match(/<!-- bypass-counter:(\d+) -->/);
  return match ? Number(match[1]) : undefined;
}

/** The signal's title. Stable across sweeps so a reader recognises a repeat. */
export const ISSUE_TITLE = "verify.yml has bypassed the free gates — bring move 10 forward";

export function issueBody(runs: VerifyRun[]): string {
  const bypasses = bypassRuns(runs);
  const count = bypasses.length;
  const newest = bypasses[0];
  return [
    `\`verify.yml\` has failed at the \`${BYPASS_STEP}\` step **${count}** time${count === 1 ? "" : "s"} on \`main\` —`,
    "a red tree that reached trunk despite the free venues (in-turn, turn-end, pre-push) that should",
    "have refused it first. That only happens when one of them was skipped: `--no-verify`, a clone",
    "where `npm ci` never ran, or a commit made outside a session that installs the hooks at all.",
    "",
    ...(newest ? [`Most recent: [run ${newest.id}](${newest.htmlUrl}), ${newest.createdAt}.`, ""] : []),
    ...bypasses.slice(0, 10).map((run) => `- [${run.id}](${run.htmlUrl}) — ${run.createdAt}`),
    ...(count > 10 ? [`- …and ${count - 10} more`] : []),
    "",
    "**Proposal:** bring move 10 (branch protection, ~$4/month) forward. It makes this class of event",
    "structurally impossible — a bypass becomes a push branch protection refuses rather than a red",
    "tree on `main` — and once it lands, this counter's job is done.",
    "",
    "This does not count `Gauntlet could not run` (exit 2, an environment problem) or",
    "`Lint workflow files` (actionlint on the workflow YAML itself) — neither is a bypass.",
    "",
    "If this is declined, it will not ask again until the count above has grown.",
    "",
    countMarker(count),
  ].join("\n");
}
