export interface WorkflowRun {
  id: number;
  status: string;
  conclusion: string;
  htmlUrl: string;
  headBranch: string;
  headSha: string;
  createdAt: string;
  event: string;
}

export interface RepoRun {
  id: number;
  name: string;
  path: string;
  status: string;
  conclusion: string;
  htmlUrl: string;
  headBranch: string;
  createdAt: string;
}

export interface TrackerJobStep {
  name: string;
  conclusion: string | null;
}

export interface TrackerJob {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
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

export interface CommitPull {
  headSha: string;
  headRef: string;
}

export interface TrackerFindingIssue {
  number: number;
  state: string;
  stateReason?: string;
  createdAt: string;
}

export interface TrackerSignal {
  number: number;
  body: string | null;
  state: string;
  stateReason?: string | null;
}

export interface CreateIssueInput {
  title: string;
  body: string;
  assignee: string;
  label?: string;
}

export interface RepositoryFile {
  name: string;
  sha: string;
}

export interface Label {
  name: string;
  color: string;
  description: string;
}

export interface FileChange {
  path: string;
  content: string | null;
}

export interface Tracker {
  workflowRuns(workflow: string, perPage: number): WorkflowRun[];
  recentRuns(perPage: number, repository?: string): RepoRun[];
  jobs(runId: number): TrackerJob[];
  jobLog(jobId: number): string;
  blockedBy(number: number): TrackerBlocker[];
  children(number: number): TrackerBlocker[];
  comments(number: number): TrackerComment[];
  recordComments(number: number): TrackerRecordComment[];
  branchesUnder(prefix: string): string[];
  mergedCloser(number: number): number | undefined;
  blockedByIds(number: number): number[];
  issueId(number: number): number;
  addSubIssue(parentNumber: number, childId: number): void;
  addBlockedBy(number: number, blockerId: number): void;
  issueBody(number: number): string;
  issueComments(number: number): string[];
  commitPulls(sha: string): CommitPull[];
  findingIssues(label: string): TrackerFindingIssue[];
  signals(): TrackerSignal[];
  createIssue(input: CreateIssueInput): number;
  repositoriesByTopic(topic: string): string[];
  defaultBranch(repository: string): string;
  headCommit(repository: string, branch: string): string | undefined;
  directoryFiles(repository: string, path: string, branch: string): RepositoryFile[];
  fileContent(repository: string, path: string, branch: string): string | undefined;
  commitFiles(repository: string, branch: string, headSha: string, changes: FileChange[], message: string): string;
  repositoryLabels(repository: string): Label[];
  createLabel(repository: string, label: Label): void;
  updateLabel(repository: string, label: Label): void;
  setWorkflowApproval(repository: string): boolean;
  setSecret(repository: string, name: string, value: string): void;
}
