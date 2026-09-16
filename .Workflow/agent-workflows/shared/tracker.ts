export interface WorkflowRun {
  id: number;
  conclusion: string;
  htmlUrl: string;
  headBranch: string;
  createdAt: string;
  event: string;
}

export interface TrackerJobStep {
  name: string;
  conclusion: string | null;
}

export interface TrackerJob {
  steps: TrackerJobStep[];
}

export interface Tracker {
  workflowRuns(workflow: string, perPage: number): WorkflowRun[];
  jobs(runId: number): TrackerJob[];
}
