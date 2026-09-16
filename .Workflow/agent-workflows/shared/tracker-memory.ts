import type { CommitPull, CreateIssueInput, RepoRun, Tracker, TrackerBlocker, TrackerComment, TrackerFindingIssue, TrackerJob, TrackerRecordComment, TrackerSignal, WorkflowRun } from "./tracker";

export interface TrackerMemoryIssue {
  body?: string;
  comments?: string[];
}

export interface TrackerMemorySeed {
  runs?: WorkflowRun[];
  recentRuns?: RepoRun[];
  jobs?: Record<number, TrackerJob[]>;
  jobLogs?: Record<number, string>;
  blockers?: Record<number, TrackerBlocker[]>;
  children?: Record<number, TrackerBlocker[]>;
  comments?: Record<number, TrackerComment[]>;
  recordComments?: Record<number, TrackerRecordComment[]>;
  branches?: string[];
  mergedClosers?: Record<number, number>;
  blockedByIds?: Record<number, number[]>;
  issueIds?: Record<number, number>;
  issues?: Record<number, TrackerMemoryIssue>;
  pulls?: Record<string, CommitPull[]>;
  findingIssues?: Record<string, TrackerFindingIssue[]>;
  signals?: TrackerSignal[];
  createdIssues?: CreateIssueInput[];
  firstIssueNumber?: number;
}

export function trackerMemory(seed: TrackerMemorySeed = {}): Tracker {
  const runs = seed.runs ?? [];
  const recentRuns = seed.recentRuns ?? [];
  const jobs = new Map(Object.entries(seed.jobs ?? {}).map(([id, list]) => [Number(id), list]));
  const jobLogs = new Map(Object.entries(seed.jobLogs ?? {}).map(([id, log]) => [Number(id), log]));
  const blockers = new Map(Object.entries(seed.blockers ?? {}).map(([id, list]) => [Number(id), list]));
  const children = new Map(Object.entries(seed.children ?? {}).map(([id, list]) => [Number(id), list]));
  const comments = new Map(Object.entries(seed.comments ?? {}).map(([id, list]) => [Number(id), list]));
  const recordComments = new Map(Object.entries(seed.recordComments ?? {}).map(([id, list]) => [Number(id), list]));
  const branches = seed.branches ?? [];
  const mergedClosers = new Map(Object.entries(seed.mergedClosers ?? {}).map(([id, pr]) => [Number(id), pr]));
  const blockedByIds = new Map(
    Object.entries(seed.blockedByIds ?? {}).map(([number, ids]) => [Number(number), ids]),
  );
  const issueIds = new Map(Object.entries(seed.issueIds ?? {}).map(([number, id]) => [Number(number), id]));
  const issues = new Map(Object.entries(seed.issues ?? {}).map(([id, issue]) => [Number(id), issue]));
  const pulls = seed.pulls ?? {};
  const findingIssues = seed.findingIssues ?? {};
  const signals = seed.signals ?? [];
  const createdIssues = seed.createdIssues ?? [];
  let nextIssueNumber = seed.firstIssueNumber ?? 1000;

  return {
    workflowRuns: (_workflow, perPage) => runs.slice(0, perPage),
    recentRuns: (perPage) => recentRuns.slice(0, perPage),
    jobs: (runId) => jobs.get(runId) ?? [],
    jobLog: (jobId) => jobLogs.get(jobId) ?? "",
    blockedBy: (number) => blockers.get(number) ?? [],
    children: (number) => children.get(number) ?? [],
    comments: (number) => comments.get(number) ?? [],
    recordComments: (number) => recordComments.get(number) ?? [],
    branchesUnder: (prefix) => branches.filter((branch) => branch.startsWith(prefix)),
    mergedCloser: (number) => mergedClosers.get(number),
    blockedByIds: (number) => blockedByIds.get(number) ?? [],
    issueId: (number) => {
      const id = issueIds.get(number);
      if (id === undefined) {
        throw new Error(`no seeded issue id for #${number}`);
      }
      return id;
    },
    addSubIssue: () => undefined,
    addBlockedBy: () => undefined,
    issueBody: (number) => issues.get(number)?.body ?? "",
    issueComments: (number) => issues.get(number)?.comments ?? [],
    commitPulls: (sha) => pulls[sha] ?? [],
    findingIssues: (label) => findingIssues[label] ?? [],
    signals: () => signals,
    createIssue: (input) => {
      createdIssues.push(input);
      nextIssueNumber += 1;
      return nextIssueNumber;
    },
  };
}
