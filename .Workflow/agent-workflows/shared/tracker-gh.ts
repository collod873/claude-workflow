import { z } from "zod";
import { blockedByPath, commitPullsPath, issueCommentPath, issueCommentsPath, issuePath, jobLogsPath, matchingRefsPath, repoRunsPath, repoRunsSincePath, repoRunsPathFor, runJobsPath, subIssuesPath, workflowRunsPath } from "./gh-paths";
import type { CommitPull, FileChange, Label, RepoRun, RepositoryFile, Tracker, TrackerBlocker, TrackerComment, TrackerDispatchRequest, TrackerFindingIssue, TrackerRecordComment, TrackerRunSummary, WorkflowRun } from "./tracker";
import { issueComments, type GhExec } from "./gh";
import { issueBody } from "./issue-body";
import { parseIssueNumber } from "./issue-url";
import { SignalIssueSchema } from "./signal-issue-schema";
import { errorMessage } from "./reason";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ApiRun = z.object({
  id: z.number(),
  status: z.string(),
  conclusion: z.string().nullable(),
  html_url: z.string(),
  head_branch: z.string().nullable(),
  head_sha: z.string(),
  created_at: z.string(),
  event: z.string(),
});

const ApiRepoRun = z.object({
  id: z.number(),
  name: z.string(),
  path: z.string(),
  status: z.string(),
  conclusion: z.string().nullable(),
  html_url: z.string(),
  head_branch: z.string().nullable(),
  created_at: z.string(),
});

const JobsResponse = z.object({
  jobs: z.array(
    z.object({
      id: z.number(),
      name: z.string(),
      status: z.string(),
      conclusion: z.string().nullable(),
      steps: z.array(
        z.object({
          name: z.string(),
          conclusion: z.string().nullable(),
        }),
      ),
    }),
  ),
});

const ApiBlocker = z.object({
  number: z.number(),
  state: z.string(),
  state_reason: z.string().nullable().optional(),
});

const ApiComment = z.object({ id: z.number(), body: z.string() });

const ApiRecordComment = z.object({
  body: z.string(),
  author_association: z.string(),
  user: z.object({ login: z.string() }).nullable(),
});

const ApiRecordCommentPages = z.array(z.array(ApiRecordComment));

const ApiRefs = z.array(z.string());

const ClosingPrNumbers = z.array(z.number());

const MERGED = "MERGED";
const ALLOW_ESCAPE_SEQUENCES = "--allow-escape-sequences";
const ApiCommitPull = z.object({
  head: z.object({ sha: z.string(), ref: z.string() }),
});

const ApiFindingIssue = z.object({
  number: z.number(),
  state: z.string(),
  stateReason: z.string().nullable().optional(),
  createdAt: z.string(),
});
const ApiContentFile = z.object({ name: z.string(), sha: z.string() });

const ApiLabel = z.object({
  name: z.string(),
  color: z.string(),
  description: z.string().nullable().optional(),
});

const SEARCH_PAGE_SIZE = 100;

const FILE_MODE = "100644";

const NOT_FOUND = "HTTP 404";

function postJson(gh: GhExec, path: string, body: unknown, jq: string): string {
  const file = join(mkdtempSync(join(tmpdir(), "tracker-gh-")), "body.json");
  writeFileSync(file, JSON.stringify(body));
  return gh(["api", "--method", "POST", path, "--input", file, "--jq", jq]).trim();
}

function createBlob(gh: GhExec, repository: string, content: string): string {
  return gh([
    "api",
    "--method",
    "POST",
    `repos/${repository}/git/blobs`,
    "-f",
    `content=${Buffer.from(content, "utf8").toString("base64")}`,
    "-f",
    "encoding=base64",
    "--jq",
    ".sha",
  ]).trim();
}

function toWorkflowRun(run: z.infer<typeof ApiRun>): WorkflowRun {
  return {
    id: run.id,
    status: run.status,
    conclusion: run.conclusion ?? "",
    htmlUrl: run.html_url,
    headBranch: run.head_branch ?? "",
    headSha: run.head_sha,
    createdAt: run.created_at,
    event: run.event,
  };
}

function toBlocker(blocker: z.infer<typeof ApiBlocker>): TrackerBlocker {
  return { number: blocker.number, state: blocker.state, stateReason: blocker.state_reason ?? null };
}

function toRecordComment(comment: z.infer<typeof ApiRecordComment>): TrackerRecordComment {
  return { body: comment.body, authorAssociation: comment.author_association, login: comment.user?.login ?? null };
}

function prIsMerged(gh: GhExec, pr: number): boolean {
  try {
    return gh(["pr", "view", String(pr), "--json", "state", "--jq", ".state"]).trim() === MERGED;
  } catch {
    return false;
  }
}

const ID_FIELD_FLAG = "-F";

function parsedId(raw: string, number: number): number {
  const id = Number(raw.trim());
  if (!Number.isInteger(id)) {
    throw new Error(`could not parse a numeric id for issue #${number} from: ${JSON.stringify(raw)}`);
  }
  return id;
}

function parsedIds(raw: string, number: number): number[] {
  const parsed: unknown = JSON.parse(raw.trim());
  if (!Array.isArray(parsed) || !parsed.every((value) => Number.isInteger(value))) {
    throw new Error(`could not parse blocked-by ids for issue #${number} from: ${JSON.stringify(raw)}`);
  }
  return parsed as number[];
}

function toRepoRun(run: z.infer<typeof ApiRepoRun>): RepoRun {
  return {
    id: run.id,
    name: run.name,
    path: run.path,
    status: run.status,
    conclusion: run.conclusion ?? "",
    htmlUrl: run.html_url,
    headBranch: run.head_branch ?? "",
    createdAt: run.created_at,
  };
}

function toCommitPull(pull: z.infer<typeof ApiCommitPull>): CommitPull {
  return { headSha: pull.head.sha, headRef: pull.head.ref };
}

function toFindingIssue(issue: z.infer<typeof ApiFindingIssue>): TrackerFindingIssue {
  return { ...issue, stateReason: issue.stateReason ?? undefined };
}

const ApiRunSummary = z.object({
  name: z.string(),
  conclusion: z.string().nullable(),
});

function dispatchArgs(request: TrackerDispatchRequest): string[] {
  const args = ["api", "repos/{owner}/{repo}/dispatches", "-f", `event_type=${request.event_type}`];
  for (const [key, value] of Object.entries(request.client_payload)) {
    if (Array.isArray(value)) {
      args.push(...value.flatMap((member) => ["-f", `client_payload[${key}][]=${member}`]));
      continue;
    }
    args.push("-f", `client_payload[${key}]=${value}`);
  }
  return args;
}

export function trackerReadsGh(gh: GhExec): Pick<Tracker, "workflowRuns" | "jobs" | "blockedBy" | "runsSince"> {
  return {
    workflowRuns(workflow, perPage) {
      const projection =
        "[.workflow_runs[] | {id, status, conclusion, html_url, head_branch, head_sha, created_at, event}]";
      const raw = gh(["api", workflowRunsPath(workflow, perPage), "--jq", projection]);
      return ApiRun.array()
        .parse(JSON.parse(raw))
        .map(toWorkflowRun);
    },
    jobs(runId) {
      const raw = gh(["api", runJobsPath(runId)]);
      return JobsResponse.parse(JSON.parse(raw)).jobs;
    },
    blockedBy(number) {
      const raw = gh(["api", blockedByPath(number), "--jq", "[.[] | {number, state, state_reason}]"]);
      return ApiBlocker.array()
        .parse(JSON.parse(raw))
        .map(toBlocker);
    },
    runsSince(repository, since) {
      const raw = gh(["api", "--paginate", repoRunsSincePath(repository, since), "--jq", ".workflow_runs[] | {name, conclusion}"]);
      return raw
        .split("\n")
        .filter((line) => line.trim().length > 0)
        .map((line): TrackerRunSummary => ApiRunSummary.parse(JSON.parse(line)));
    },
  };
}

export function trackerGh(gh: GhExec): Tracker {
  return {
    ...trackerReadsGh(gh),
    dispatch(request) {
      gh(dispatchArgs(request));
    },
    recentRuns(perPage, repository) {
      const path = repository ? repoRunsPathFor(repository, perPage) : repoRunsPath(perPage);
      const projection = "[.workflow_runs[] | {id, name, path, status, conclusion, html_url, head_branch, created_at}]";
      const raw = gh(["api", path, "--jq", projection]);
      return ApiRepoRun.array()
        .parse(JSON.parse(raw))
        .map(toRepoRun);
    },
    jobLog(jobId) {
      try {
        return gh(["api", jobLogsPath(jobId), ALLOW_ESCAPE_SEQUENCES]);
      } catch {
        return gh(["api", jobLogsPath(jobId)]);
      }
    },
    children(number) {
      const raw = gh(["api", subIssuesPath(number), "--jq", "[.[] | {number, state, state_reason}]"]);
      return ApiBlocker.array()
        .parse(JSON.parse(raw))
        .map(toBlocker);
    },
    comments(number): TrackerComment[] {
      const raw = gh(["api", issueCommentsPath(number)]);
      return ApiComment.array().parse(JSON.parse(raw));
    },
    recordComments(number) {
      const raw = gh(["api", issueCommentsPath(number), "--paginate", "--slurp"]);
      return ApiRecordCommentPages.parse(JSON.parse(raw))
        .flat()
        .map(toRecordComment);
    },
    updateComment(id, body) {
      gh(["api", issueCommentPath(id), "-X", "PATCH", "-f", `body=${body}`]);
    },
    branchesUnder(prefix) {
      const raw = gh(["api", matchingRefsPath(prefix), "--jq", "[.[].ref]"]);
      return ApiRefs.parse(JSON.parse(raw)).map((ref) => ref.replace(/^refs\/heads\//, ""));
    },
    mergedCloser(number) {
      let closers: number[];
      try {
        const raw = gh([
          "issue",
          "view",
          String(number),
          "--json",
          "closedByPullRequestsReferences",
          "--jq",
          "[.closedByPullRequestsReferences[].number]",
        ]);
        const parsed = ClosingPrNumbers.safeParse(JSON.parse(raw));
        if (!parsed.success) return undefined;
        closers = parsed.data;
      } catch {
        return undefined;
      }
      return closers.find((pr) => prIsMerged(gh, pr));
    },
    blockedByIds(number) {
      const raw = gh(["api", blockedByPath(number), "--jq", "[.[].id]"]);
      return parsedIds(raw, number);
    },
    issueId(number) {
      const raw = gh(["api", issuePath(number), "--jq", ".id"]);
      return parsedId(raw, number);
    },
    addSubIssue(parentNumber, childId) {
      gh(["api", subIssuesPath(parentNumber), ID_FIELD_FLAG, `sub_issue_id=${childId}`]);
    },
    addBlockedBy(number, blockerId) {
      gh(["api", blockedByPath(number), ID_FIELD_FLAG, `issue_id=${blockerId}`]);
    },
    issueBody(number) {
      return issueBody(gh, number);
    },
    issueComments(number) {
      return issueComments(gh, number);
    },
    commitPulls(sha) {
      const raw = gh(["api", commitPullsPath(sha)]);
      return ApiCommitPull.array()
        .parse(JSON.parse(raw))
        .map(toCommitPull);
    },
    findingIssues(label) {
      const raw = gh([
        "issue",
        "list",
        "--state",
        "all",
        "--label",
        label,
        "--limit",
        "200",
        "--json",
        "number,state,stateReason,createdAt",
      ]);
      return ApiFindingIssue.array()
        .parse(JSON.parse(raw))
        .map(toFindingIssue);
    },
    signals() {
      const raw = gh(["issue", "list", "--state", "all", "--limit", "200", "--json", "number,body,state,stateReason"]);
      return SignalIssueSchema.array().parse(JSON.parse(raw));
    },
    createIssue(input) {
      const args = ["issue", "create", "--title", input.title, "--body", input.body, "--assignee", input.assignee];
      if (input.label) args.push("--label", input.label);
      const url = gh(args);
      return parseIssueNumber(url, input.title);
    },
    repositoriesByTopic(topic) {
      const raw = gh([
        "api",
        "--paginate",
        `search/repositories?q=topic:${topic}&per_page=${SEARCH_PAGE_SIZE}`,
        "--jq",
        ".items[].full_name",
      ]);
      return raw
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line !== "");
    },
    defaultBranch(repository) {
      return gh(["api", `repos/${repository}`, "--jq", ".default_branch"]).trim();
    },
    headCommit(repository, branch) {
      try {
        return gh(["api", `repos/${repository}/git/ref/heads/${branch}`, "--jq", ".object.sha"]).trim();
      } catch (err) {
        if (errorMessage(err).includes(NOT_FOUND)) return undefined;
        throw err;
      }
    },
    directoryFiles(repository, path, branch): RepositoryFile[] {
      let raw: string;
      try {
        raw = gh([
          "api",
          `repos/${repository}/contents/${path}?ref=${branch}`,
          "--jq",
          '[.[] | select(.type == "file") | {name, sha}]',
        ]);
      } catch (err) {
        if (errorMessage(err).includes(NOT_FOUND)) return [];
        throw err;
      }
      return ApiContentFile.array().parse(JSON.parse(raw));
    },
    fileContent(repository, path, branch) {
      try {
        const raw = gh(["api", `repos/${repository}/contents/${path}?ref=${branch}`, "--jq", ".content"]).trim();
        return Buffer.from(raw, "base64").toString("utf8");
      } catch (err) {
        if (errorMessage(err).includes(NOT_FOUND)) return undefined;
        throw err;
      }
    },
    commitFiles(repository, branch, headSha, changes: FileChange[], message) {
      const baseTree = gh(["api", `repos/${repository}/git/commits/${headSha}`, "--jq", ".tree.sha"]).trim();
      const tree = changes.map((change) => ({
        path: change.path,
        mode: FILE_MODE,
        type: "blob" as const,
        sha: change.content === null ? null : createBlob(gh, repository, change.content),
      }));
      const treeSha = postJson(gh, `repos/${repository}/git/trees`, { base_tree: baseTree, tree }, ".sha");
      const commitSha = postJson(
        gh,
        `repos/${repository}/git/commits`,
        { message, tree: treeSha, parents: [headSha] },
        ".sha",
      );
      gh(["api", "--method", "PATCH", `repos/${repository}/git/refs/heads/${branch}`, "-f", `sha=${commitSha}`]);
      return commitSha;
    },
    repositoryLabels(repository): Label[] {
      const raw = gh(["api", "--paginate", `repos/${repository}/labels`, "--jq", ".[] | {name, color, description}"]);
      const objects = raw
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line !== "")
        .map((line) => JSON.parse(line));
      return ApiLabel.array()
        .parse(objects)
        .map((label) => ({ name: label.name, color: label.color, description: label.description ?? "" }));
    },
    createLabel(repository, label) {
      gh([
        "api",
        "--method",
        "POST",
        `repos/${repository}/labels`,
        "-f",
        `name=${label.name}`,
        "-f",
        `color=${label.color}`,
        "-f",
        `description=${label.description}`,
      ]);
    },
    updateLabel(repository, label) {
      gh([
        "api",
        "--method",
        "PATCH",
        `repos/${repository}/labels/${encodeURIComponent(label.name)}`,
        "-f",
        `color=${label.color}`,
        "-f",
        `description=${label.description}`,
      ]);
    },
    setWorkflowApproval(repository) {
      gh([
        "api",
        "--method",
        "PUT",
        `repos/${repository}/actions/permissions/workflow`,
        "-F",
        "can_approve_pull_request_reviews=true",
      ]);
      const readBack = gh([
        "api",
        `repos/${repository}/actions/permissions/workflow`,
        "--jq",
        ".can_approve_pull_request_reviews",
      ]).trim();
      return readBack === "true";
    },
    setSecret(repository, name, value) {
      gh(["secret", "set", name, "-R", repository, "--body", value]);
    },
  };
}
