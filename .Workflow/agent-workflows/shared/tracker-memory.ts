import type { Tracker, TrackerBlocker, TrackerJob, TrackerSubIssue, WorkflowRun } from "./tracker";

export interface TrackerMemorySeed {
  runs?: WorkflowRun[];
  jobs?: Record<number, TrackerJob[]>;
  blockers?: Record<number, TrackerBlocker[]>;
  subIssues?: Record<number, TrackerSubIssue[]>;
}

export function trackerMemory(seed: TrackerMemorySeed = {}): Tracker {
  const runs = seed.runs ?? [];
  const jobs = new Map(Object.entries(seed.jobs ?? {}).map(([id, list]) => [Number(id), list]));
  const blockers = new Map(Object.entries(seed.blockers ?? {}).map(([id, list]) => [Number(id), list]));
  const subIssues = new Map(Object.entries(seed.subIssues ?? {}).map(([id, list]) => [Number(id), list]));

  return {
    workflowRuns: (_workflow, perPage) => runs.slice(0, perPage),
    jobs: (runId) => jobs.get(runId) ?? [],
    blockedBy: (number) => blockers.get(number) ?? [],
    subIssues: (prdNumber) => subIssues.get(prdNumber) ?? [],
  };
}
