import type { Tracker, TrackerBlocker, TrackerJob, WorkflowRun } from "./tracker";

export interface TrackerMemorySeed {
  runs?: WorkflowRun[];
  jobs?: Record<number, TrackerJob[]>;
  blockers?: Record<number, TrackerBlocker[]>;
}

export function trackerMemory(seed: TrackerMemorySeed = {}): Tracker {
  const runs = seed.runs ?? [];
  const jobs = new Map(Object.entries(seed.jobs ?? {}).map(([id, list]) => [Number(id), list]));
  const blockers = new Map(Object.entries(seed.blockers ?? {}).map(([id, list]) => [Number(id), list]));

  return {
    workflowRuns: (_workflow, perPage) => runs.slice(0, perPage),
    jobs: (runId) => jobs.get(runId) ?? [],
    blockedBy: (number) => blockers.get(number) ?? [],
  };
}
