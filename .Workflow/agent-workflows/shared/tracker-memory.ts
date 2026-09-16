import type { Tracker, TrackerJob, WorkflowRun } from "./tracker";

export interface TrackerMemorySeed {
  runs?: WorkflowRun[];
  jobs?: Record<number, TrackerJob[]>;
}

export function trackerMemory(seed?: TrackerMemorySeed): Tracker {
  void seed;
  throw new Error("#607: not built");
}
