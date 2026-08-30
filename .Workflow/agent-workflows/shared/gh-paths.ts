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
 * `\d+` would not match `run-watchdog.yml`, and widening the number template
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

/**
 * The same generator again for a path whose variable segment is a **ref prefix** — `implement/`,
 * today. Separate from `namedPathTemplate` only in its character class: a ref prefix carries the
 * `/` that a workflow file name never does, and widening the workflow matcher to accept one would
 * let it match paths that are not workflow paths at all.
 */
function refPrefixPathTemplate(
  literal: TemplateStringsArray,
  ..._placeholder: unknown[]
): { build: (prefix: string) => string; matcher: RegExp } {
  const [prefix, suffix] = literal.raw;
  return {
    build: (value: string) => `${prefix}${value}${suffix}`,
    matcher: new RegExp(`^${escapeRegExp(prefix)}([\\w./-]+)${escapeRegExp(suffix)}$`),
  };
}

function escapeRegExp(segment: string): string {
  return segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const issue = pathTemplate`repos/{owner}/{repo}/issues/${0}`;
const subIssues = pathTemplate`repos/{owner}/{repo}/issues/${0}/sub_issues`;
const blockedBy = pathTemplate`repos/{owner}/{repo}/issues/${0}/dependencies/blocked_by`;
const workflowRuns = namedPathTemplate`repos/{owner}/{repo}/actions/workflows/${""}/runs`;
const runJobs = pathTemplate`repos/{owner}/{repo}/actions/runs/${0}/jobs`;
const runArtifacts = pathTemplate`repos/{owner}/{repo}/actions/runs/${0}/artifacts`;
const repoRuns = pathTemplate`repos/{owner}/{repo}/actions/runs?per_page=${0}`;
const matchingRefs = refPrefixPathTemplate`repos/{owner}/{repo}/git/matching-refs/heads/${""}`;
const commitPulls = namedPathTemplate`repos/{owner}/{repo}/commits/${""}/pulls`;
const issueComments = pathTemplate`repos/{owner}/{repo}/issues/${0}/comments`;
const issueComment = pathTemplate`repos/{owner}/{repo}/issues/comments/${0}`;

/**
 * Where a ref is **created**, which is how an implementer claims its slice (#179). No variable
 * segment: the ref name and the commit it points at are fields on the POST, not path segments.
 *
 * This endpoint is chosen over a push precisely because it is an atomic create that **fails when
 * the ref already exists** (HTTP 422). A push might fast-forward, and a second implementer that
 * fast-forwards has already done the whole job twice.
 */
export const GIT_REFS_PATH = "repos/{owner}/{repo}/git/refs";

/**
 * How far `head` has run past `base`. Lane 05 asks this of a claim branch it found already there:
 * a branch carrying commits is somebody's unfinished work, and never debris to be taken over
 * (`implement/implement.ts`, #196).
 *
 * A plain builder with no matcher, like `GIT_REFS_PATH` above — nothing in this pipeline has to
 * *recognise* a compare path, only send one, and a matcher no fake reads would be a shape claiming
 * to be checked that nothing checks.
 */
export function comparePath(base: string, head: string): string {
  return `repos/{owner}/{repo}/compare/${base}...${head}`;
}

/**
 * When one branch was created, from the repository activity feed — newest entry first, one entry.
 *
 * The only place GitHub records a ref's age. A ref carries no timestamp of its own, and the commit
 * it points at answers a different question: lane 05's claim ref is created at trunk's tip, so its
 * commit date says when trunk last moved, not when the claim was made. Telling a claim made a
 * minute ago from one a dead run left behind last night is the whole of #196, and this is the only
 * endpoint that can (`implement/implement.ts`).
 */
export function branchCreationPath(branch: string): string {
  const ref = encodeURIComponent(`refs/heads/${branch}`);
  return `repos/{owner}/{repo}/activity?activity_type=branch_creation&per_page=1&ref=${ref}`;
}

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
 * Every comment on `number`, oldest first, with the REST integer id each one carries — the id
 * `issueCommentPath` accepts, not the GraphQL node id `gh issue view --json comments` would hand
 * back instead. Read fresh rather than cached: a caller upserting a marker-keyed comment
 * (`dispatch/reconcile.ts`'s spec-evaluate pass) needs to find one it already wrote before
 * deciding whether to rewrite it or create a fresh one.
 */
export function issueCommentsPath(number: number): string {
  return issueComments.build(number);
}

/** The path to rewrite one comment whole, by the REST id `issueCommentsPath` reads back. */
export function issueCommentPath(id: number): string {
  return issueComment.build(id);
}

/**
 * The path for one workflow's runs, newest first, with the page size on it.
 *
 * The page size is part of the path rather than a caller's concern because
 * it is load-bearing: `watchdog/dead-lanes.ts` reads how far back one page
 * reaches and refuses to answer for runs older than that, so a caller
 * that quietly asked for a smaller page would be narrowing the window that
 * sweep trusts without saying so.
 */
export function workflowRunsPath(workflowFile: string, perPage: number): string {
  return `${workflowRuns.build(workflowFile)}?per_page=${perPage}`;
}

/**
 * The path for one run's jobs. The run watchdog (#41) reads `total_count`
 * off this and nothing else: the `workflow_run` payload says a run completed
 * and says it failed, and says nothing about whether anything executed —
 * which is exactly the distinction the watchdog exists to make.
 */
export function runJobsPath(runId: number): string {
  return runJobs.build(runId);
}

/**
 * The path for one run's artifacts — `recover/recover.ts`'s first source for the ticket a failed
 * `Implement` run was building: an `implementer-answer-<n>` artifact names it, and its presence is
 * also what tells the recovery path from the re-dispatch path (a run that never reached the
 * upload step left the model's answer nowhere to recover).
 */
export function runArtifactsPath(runId: number): string {
  return runArtifacts.build(runId);
}

/**
 * The path for this repo's runs across every workflow, newest first, with
 * the page size on it. The run watchdog (#41) sweeps this rather than one
 * workflow's runs, because the lane it is looking for may be one nobody has
 * written yet — and, in the case it exists for, one GitHub could not parse
 * well enough to name.
 *
 * The page size is part of the path rather than a caller's concern for the
 * same reason it is in `workflowRunsPath`: it bounds the window the sweep
 * can answer for, and a caller that quietly asked for a smaller page would
 * be narrowing that window without saying so.
 */
export function repoRunsPath(perPage: number): string {
  return repoRuns.build(perPage);
}

/**
 * Every ref under one prefix, in one call — `implement/` finds every claim the fleet holds, which
 * is the `started` term of the ready set (`shared/ready-set.ts`) read without a per-slice lookup.
 */
export function matchingRefsPath(prefix: string): string {
  return matchingRefs.build(prefix);
}

/**
 * Every pull request associated with one commit — **regardless of state**, which is the whole
 * reason lane 07 reads this endpoint rather than `pr list`. The reviewer rides a `workflow_run`
 * and is always behind the event that started it, so a fast lane 08 can merge the pull request
 * before the reviewer reaches this lookup; an open-only query would make the conformance reviewer
 * silently skip exactly the runs that moved quickest (#189).
 *
 * The caller still has to pick the pull request whose *own* head SHA is the commit it asked
 * about: this endpoint also lists a pull request that merely contains the commit somewhere in its
 * branch, which is a different question from "which pull request is this run reviewing?".
 */
export function commitPullsPath(head: string): string {
  return commitPulls.build(head);
}

/** Matches an `issuePath`, capturing the issue number. */
export const issuePathMatcher: RegExp = issue.matcher;

/** Matches a `subIssuesPath`, capturing the parent issue number. */
export const subIssuesPathMatcher: RegExp = subIssues.matcher;

/** Matches a `blockedByPath`, capturing the blocked issue number. */
export const blockedByPathMatcher: RegExp = blockedBy.matcher;

/**
 * Matches an `issueCommentsPath`, capturing the issue number.
 *
 * @fixture — no lane reads this; it exists so a `GhExec` stand-in (`dispatch/reconcile.test.ts`'s
 * fake) answers the comments-list lookup by the same segments `issueCommentsPath` sends, rather
 * than restating the path in a way that could name a different endpoint from the one production
 * actually calls.
 */
export const issueCommentsPathMatcher: RegExp = issueComments.matcher;

/**
 * Matches an `issueCommentPath`, capturing the comment id.
 *
 * @fixture — no lane reads this; same reason as `issueCommentsPathMatcher` above, for the rewrite
 * side of the same pair.
 */
export const issueCommentPathMatcher: RegExp = issueComment.matcher;

/** Matches a `workflowRunsPath` minus its query string, capturing the file. */
export const workflowRunsPathMatcher: RegExp = workflowRuns.matcher;

/** Matches a `runJobsPath`, capturing the run id. */
export const runJobsPathMatcher: RegExp = runJobs.matcher;

/** Matches a `repoRunsPath`, capturing the page size. */
export const repoRunsPathMatcher: RegExp = repoRuns.matcher;

/** Matches a `matchingRefsPath`, capturing the ref prefix. */
export const matchingRefsPathMatcher: RegExp = matchingRefs.matcher;

/**
 * Matches a `commitPullsPath`, capturing the commit.
 *
 * @fixture — no lane reads this; it exists so a `GhExec` stand-in answers the commit-to-pulls
 * lookup by the same segments `commitPullsPath` sends, rather than restating the path in a way
 * that could name a different endpoint from the one production actually calls.
 */
export const commitPullsPathMatcher: RegExp = commitPulls.matcher;
