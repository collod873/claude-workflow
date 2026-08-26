/**
 * Every `gh api` REST path this pipeline builds, under
 * `repos/{owner}/{repo}/issues/...` — `{owner}`/`{repo}` are `gh`'s own
 * placeholders, resolved from the working directory's git remote (see
 * `shared/gh.ts`), not interpolated here.
 *
 * `publish-sub-issues.ts` builds these paths to send real writes;
 * `gh.fake.ts` needs to recognise the same paths to answer them in tests.
 * Both are generated, here, from one `pathTemplate` call per path shape —
 * the builder function and the matching `RegExp` are produced from the same
 * literal segments, so `gh.fake.ts` can never restate a path in a way that
 * names it differently from what `publish-sub-issues.ts` actually sends.
 *
 * What this buys, and what it doesn't: this is the "shared constant"
 * design, not the "typed template" one. Builder and matcher cannot drift
 * from *each other* — they're two views of the same segments — but nothing
 * here checks those segments against what GitHub's API actually accepts, so
 * a wrong segment (misspelled, reordered, missing a placeholder) is simply
 * wrong on both sides at once, and TypeScript will not flag it. That is not
 * a type error on drift, only single-sourcing. The one thing that still
 * pins the literal wire format GitHub's API accepts is the hardcoded
 * `-F issue_id=<n>` value kept in `slice-and-publish.test.ts` for the
 * `blocked_by` write — and that pin was itself wrong until run 32679981039,
 * where the real API refused the string `-f` sends. A literal in a test is
 * only as good as the wire that last checked it.
 */

function pathTemplate(
  literal: TemplateStringsArray,
  ..._placeholder: unknown[]
): { build: (n: number) => string; matcher: RegExp } {
  const [prefix, suffix] = literal.raw;
  return {
    build: (n: number) => `${prefix}${n}${suffix}`,
    matcher: new RegExp(`^${escapeRegExp(prefix)}(\\d+)${escapeRegExp(suffix)}$`),
  };
}

/**
 * The same generator for a path whose variable segment is a **name** rather
 * than an issue number — a workflow file, today. Separate from
 * `pathTemplate` only in what it accepts and what its matcher captures:
 * `\d+` would not match `close-gate.yml`, and widening the number template
 * to take one would let an issue path be built from a string that is not a
 * number at all.
 */
function namedPathTemplate(
  literal: TemplateStringsArray,
  ..._placeholder: unknown[]
): { build: (name: string) => string; matcher: RegExp } {
  const [prefix, suffix] = literal.raw;
  return {
    build: (name: string) => `${prefix}${name}${suffix}`,
    matcher: new RegExp(`^${escapeRegExp(prefix)}([\\w.-]+)${escapeRegExp(suffix)}$`),
  };
}

function escapeRegExp(segment: string): string {
  return segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const issue = pathTemplate`repos/{owner}/{repo}/issues/${0}`;
const subIssues = pathTemplate`repos/{owner}/{repo}/issues/${0}/sub_issues`;
const blockedBy = pathTemplate`repos/{owner}/{repo}/issues/${0}/dependencies/blocked_by`;
const workflow = namedPathTemplate`repos/{owner}/{repo}/actions/workflows/${""}`;
const workflowRuns = namedPathTemplate`repos/{owner}/{repo}/actions/workflows/${""}/runs`;

/** The path for one issue: `repos/{owner}/{repo}/issues/<number>`. */
export function issuePath(number: number): string {
  return issue.build(number);
}

/** The path to attach a native sub-issue under `prdNumber`. */
export function subIssuesPath(prdNumber: number): string {
  return subIssues.build(prdNumber);
}

/** The path to wire or read back `number`'s blocked-by graph. */
export function blockedByPath(number: number): string {
  return blockedBy.build(number);
}

/**
 * The path for one workflow itself — its `created_at` is the earliest
 * moment it could ever have fired, which is what
 * `close-gate/reconcile.ts` uses to keep from reopening closes that
 * predate the gate.
 */
export function workflowPath(workflowFile: string): string {
  return workflow.build(workflowFile);
}

/**
 * The path for one workflow's runs, newest first, with the page size on it.
 *
 * The page size is part of the path rather than a caller's concern because
 * it is load-bearing: `close-gate/reconcile.ts` reads how far back one page
 * reaches and refuses to answer for closes older than that, so a caller
 * that quietly asked for a smaller page would be narrowing the window that
 * reconciler trusts without saying so.
 */
export function workflowRunsPath(workflowFile: string, perPage: number): string {
  return `${workflowRuns.build(workflowFile)}?per_page=${perPage}`;
}

/** Matches an `issuePath`, capturing the issue number. */
export const issuePathMatcher: RegExp = issue.matcher;

/** Matches a `subIssuesPath`, capturing the parent issue number. */
export const subIssuesPathMatcher: RegExp = subIssues.matcher;

/** Matches a `blockedByPath`, capturing the blocked issue number. */
export const blockedByPathMatcher: RegExp = blockedBy.matcher;

/** Matches a `workflowPath`, capturing the workflow file. */
export const workflowPathMatcher: RegExp = workflow.matcher;

/** Matches a `workflowRunsPath` minus its query string, capturing the file. */
export const workflowRunsPathMatcher: RegExp = workflowRuns.matcher;
