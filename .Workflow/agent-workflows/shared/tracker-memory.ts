import type { Tracker, TrackerBlocker, TrackerComment, TrackerJob, TrackerRecordComment, WorkflowRun } from "./tracker";

export interface TrackerMemorySeed {
  runs?: WorkflowRun[];
  jobs?: Record<number, TrackerJob[]>;
  blockers?: Record<number, TrackerBlocker[]>;
  children?: Record<number, TrackerBlocker[]>;
  comments?: Record<number, TrackerComment[]>;
  recordComments?: Record<number, TrackerRecordComment[]>;
  branches?: string[];
  mergedClosers?: Record<number, number>;
  blockedByIds?: Record<number, number[]>;
  issueIds?: Record<number, number>;
}

export function trackerMemory(seed: TrackerMemorySeed = {}): Tracker {
  const runs = seed.runs ?? [];
  const jobs = new Map(Object.entries(seed.jobs ?? {}).map(([id, list]) => [Number(id), list]));
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

  return {
    workflowRuns: (_workflow, perPage) => runs.slice(0, perPage),
    jobs: (runId) => jobs.get(runId) ?? [],
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
  };
}
