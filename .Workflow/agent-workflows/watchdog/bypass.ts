export const BYPASS_STEP = "Gauntlet";

export const COULD_NOT_RUN_STEP = "Gauntlet could not run";

export const LINT_WORKFLOW_STEP = "Lint workflow files";

export const BYPASS_THRESHOLD = 3;

export interface VerifyRun {
  id: number;
  headBranch: string;
  createdAt: string;
  htmlUrl: string;
  conclusion: string;
  failedStep?: string;
}

export function isBypass(run: VerifyRun): boolean {
  return run.headBranch === "main" && run.conclusion === "failure" && run.failedStep === BYPASS_STEP;
}

export function bypassRuns(runs: VerifyRun[]): VerifyRun[] {
  return runs.filter(isBypass);
}

export function bypassCount(runs: VerifyRun[]): number {
  return bypassRuns(runs).length;
}

export function shouldPropose(count: number): boolean {
  return count >= BYPASS_THRESHOLD;
}

export function countMarker(count: number): string {
  return `<!-- bypass-counter:${count} -->`;
}

export function markedCount(body: string): number | undefined {
  const match = body.match(/<!-- bypass-counter:(\d+) -->/);
  return match ? Number(match[1]) : undefined;
}

export const ISSUE_TITLE = "The verification lane has bypassed the free gates — bring move 10 forward";

export function issueBody(runs: VerifyRun[]): string {
  const bypasses = bypassRuns(runs);
  const count = bypasses.length;
  const newest = bypasses[0];
  return [
    `The verification lane has failed at the \`${BYPASS_STEP}\` step **${count}** time${count === 1 ? "" : "s"} on \`main\` —`,
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
    "This does not count `Gauntlet could not run` (the old gate's environment-problem step) or",
    "`Lint workflow files` (actionlint on the workflow YAML itself) — neither is a bypass.",
    "",
    "Close this **completed** and it will not ask again until the count above has grown. Close it",
    "**not planned** and it will not ask again at all — the count is still computed, and still in",
    "this workflow's log, for whoever goes looking.",
    "",
    countMarker(count),
  ].join("\n");
}
