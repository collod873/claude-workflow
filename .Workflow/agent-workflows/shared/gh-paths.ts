function pathTemplate(
  literal: TemplateStringsArray,
  ..._placeholder: unknown[]
): { build: (n: number) => string; parse: (path: string) => number | undefined } {
  const [prefix, suffix] = literal.raw;
  const pattern = new RegExp(`^${escapeRegExp(prefix)}(\\d+)${escapeRegExp(suffix)}$`);
  return {
    build: (n: number) => `${prefix}${n}${suffix}`,
    parse: (path: string) => {
      const id = path.match(pattern)?.[1];
      return id === undefined ? undefined : Number(id);
    },
  };
}

function namedPathTemplate(
  literal: TemplateStringsArray,
  ..._placeholder: unknown[]
): { build: (name: string) => string } {
  const [prefix, suffix] = literal.raw;
  return { build: (name: string) => `${prefix}${name}${suffix}` };
}

function refPrefixPathTemplate(
  literal: TemplateStringsArray,
  ..._placeholder: unknown[]
): { build: (prefix: string) => string } {
  const [prefix, suffix] = literal.raw;
  return { build: (value: string) => `${prefix}${value}${suffix}` };
}

function escapeRegExp(segment: string): string {
  return segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const issue = pathTemplate`repos/{owner}/{repo}/issues/${0}`;
const subIssues = pathTemplate`repos/{owner}/{repo}/issues/${0}/sub_issues`;
const blockedBy = pathTemplate`repos/{owner}/{repo}/issues/${0}/dependencies/blocked_by`;
const workflowRuns = namedPathTemplate`repos/{owner}/{repo}/actions/workflows/${""}/runs`;
const runJobs = pathTemplate`repos/{owner}/{repo}/actions/runs/${0}/jobs`;
const jobLogs = pathTemplate`repos/{owner}/{repo}/actions/jobs/${0}/logs`;
const repoRuns = pathTemplate`repos/{owner}/{repo}/actions/runs?per_page=${0}`;
const matchingRefs = refPrefixPathTemplate`repos/{owner}/{repo}/git/matching-refs/heads/${""}`;
const commitPulls = namedPathTemplate`repos/{owner}/{repo}/commits/${""}/pulls`;
const issueComments = pathTemplate`repos/{owner}/{repo}/issues/${0}/comments`;
const issueComment = pathTemplate`repos/{owner}/{repo}/issues/comments/${0}`;

const WORKFLOW_RUNS_PATTERN = new RegExp(`^${escapeRegExp("repos/{owner}/{repo}/actions/workflows/")}[\\w.-]+${escapeRegExp("/runs")}$`);
const REPO_RUNS_FOR_PATTERN = /^repos\/([^/?]+\/[^/?]+)\/actions\/runs\?per_page=\d+$/;

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

export function parseIssuePath(path: string): number | undefined {
  return issue.parse(path);
}

export function subIssuesPath(prdNumber: number): string {
  return subIssues.build(prdNumber);
}

export function parseSubIssuesPath(path: string): number | undefined {
  return subIssues.parse(path);
}

export function blockedByPath(number: number): string {
  return blockedBy.build(number);
}

export function parseBlockedByPath(path: string): number | undefined {
  return blockedBy.parse(path);
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

export function isWorkflowRunsPath(path: string): boolean {
  return WORKFLOW_RUNS_PATTERN.test(path);
}

export function runJobsPath(runId: number): string {
  return runJobs.build(runId);
}

export function parseRunJobsPath(path: string): number | undefined {
  return runJobs.parse(path);
}

export function jobLogsPath(jobId: number): string {
  return jobLogs.build(jobId);
}

export function parseJobLogsPath(path: string): number | undefined {
  return jobLogs.parse(path);
}

export function repoRunsPath(perPage: number): string {
  return repoRuns.build(perPage);
}

export function isRepoRunsPath(path: string): boolean {
  return repoRuns.parse(path) !== undefined;
}

export function repoRunsPathFor(repository: string, perPage: number): string {
  return `repos/${repository}/actions/runs?per_page=${perPage}`;
}

export function parseRepoRunsPathFor(path: string): string | undefined {
  return path.match(REPO_RUNS_FOR_PATTERN)?.[1];
}

export function repoRunsSincePath(repository: string, since: string): string {
  return `repos/${repository}/actions/runs?created=>=${since}&per_page=100`;
}

export function matchingRefsPath(prefix: string): string {
  return matchingRefs.build(prefix);
}

export function commitPullsPath(head: string): string {
  return commitPulls.build(head);
}
