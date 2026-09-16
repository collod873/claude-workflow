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

export interface TrackerComment {
  id: number;
  body: string;
}

export interface TrackerRecordComment {
  body: string;
  authorAssociation: string;
  login: string | null;
}

export interface Tracker {
  workflowRuns(workflow: string, perPage: number): WorkflowRun[];
  jobs(runId: number): TrackerJob[];
  blockedBy(number: number): TrackerBlocker[];
  children(number: number): TrackerBlocker[];
  comments(number: number): TrackerComment[];
  recordComments(number: number): TrackerRecordComment[];
  branchesUnder(prefix: string): string[];
  mergedCloser(number: number): number | undefined;
}
