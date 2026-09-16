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

export interface TrackerBlocker {
  number: number;
  state: string;
  stateReason: string | null;
}

export interface TrackerSubIssue {
  number: number;
  state: string;
}

export interface Tracker {
  workflowRuns(workflow: string, perPage: number): WorkflowRun[];
  jobs(runId: number): TrackerJob[];
  blockedBy(number: number): TrackerBlocker[];
  subIssues(prdNumber: number): TrackerSubIssue[];
}
