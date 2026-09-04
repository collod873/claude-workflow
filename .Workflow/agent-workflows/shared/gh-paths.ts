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

export const GIT_REFS_PATH = "repos/{owner}/{repo}/git/refs";

export function comparePath(base: string, head: string): string {
  return `repos/{owner}/{repo}/compare/${base}...${head}`;
}

export function branchCreationPath(branch: string): string {
  const ref = encodeURIComponent(`refs/heads/${branch}`);
  return `repos/{owner}/{repo}/activity?activity_type=branch_creation&per_page=1&ref=${ref}`;
}

export function issuePath(number: number): string {
  return issue.build(number);
}

export function subIssuesPath(prdNumber: number): string {
  return subIssues.build(prdNumber);
}

export function blockedByPath(number: number): string {
  return blockedBy.build(number);
}

export function issueCommentsPath(number: number): string {
  return issueComments.build(number);
}

export function issueCommentPath(id: number): string {
  return issueComment.build(id);
}

export function workflowRunsPath(workflowFile: string, perPage: number): string {
  return `${workflowRuns.build(workflowFile)}?per_page=${perPage}`;
}

export function runJobsPath(runId: number): string {
  return runJobs.build(runId);
}

export function runArtifactsPath(runId: number): string {
  return runArtifacts.build(runId);
}

export function repoRunsPath(perPage: number): string {
  return repoRuns.build(perPage);
}

export function repoRunsPathFor(repository: string, perPage: number): string {
  return `repos/${repository}/actions/runs?per_page=${perPage}`;
}

/**
 * @fixture No lane reads this; it exists so `watchdog/walk-home.test.ts`'s fake `gh` recognises
 * the path `repoRunsPathFor` sends, by the same segments, rather than restating the shape in a way
 * that could silently drift from what production actually calls.
 */
export const repoRunsPathForMatcher: RegExp = /^repos\/([^/?]+\/[^/?]+)\/actions\/runs\?per_page=(\d+)$/;

export function matchingRefsPath(prefix: string): string {
  return matchingRefs.build(prefix);
}

export function commitPullsPath(head: string): string {
  return commitPulls.build(head);
}

export const issuePathMatcher: RegExp = issue.matcher;

export const subIssuesPathMatcher: RegExp = subIssues.matcher;

export const blockedByPathMatcher: RegExp = blockedBy.matcher;

/**
 * @fixture No lane reads this; a `GhExec` stand-in answers the comments-list lookup by the same
 * segments `issueCommentsPath` sends, rather than restating a path that could drift from it.
 */
export const issueCommentsPathMatcher: RegExp = issueComments.matcher;

/**
 * @fixture No lane reads this; same reason as `issueCommentsPathMatcher` above, for the rewrite
 * side of the same pair.
 */
export const issueCommentPathMatcher: RegExp = issueComment.matcher;

export const workflowRunsPathMatcher: RegExp = workflowRuns.matcher;

export const runJobsPathMatcher: RegExp = runJobs.matcher;

export const repoRunsPathMatcher: RegExp = repoRuns.matcher;

/**
 * @fixture No lane reads this; it exists so a `GhExec` stand-in answers the commit-to-pulls
 * lookup by the same segments `commitPullsPath` sends, rather than restating the path in a way
 * that could name a different endpoint from the one production actually calls.
 */
export const commitPullsPathMatcher: RegExp = commitPulls.matcher;
