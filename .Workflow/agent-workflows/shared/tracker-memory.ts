import type { CommitPull, CreateIssueInput, FileChange, Label, RepoRun, RepositoryFile, Tracker, TrackerBlocker, TrackerComment, TrackerFindingIssue, TrackerJob, TrackerRecordComment, TrackerSignal, WorkflowRun } from "./tracker";

export interface TrackerMemoryIssue {
  body?: string;
  comments?: string[];
}

export interface TrackerMemoryRepository {
  defaultBranch?: string;
  headCommit?: string;
  directories?: Record<string, RepositoryFile[]>;
  files?: Record<string, string>;
  labels?: Label[];
  workflowApprovalReadBack?: string;
  refuses?: string;
  refusesLabels?: string;
  refusesSetting?: string;
  refusesSecrets?: string;
  refusesDocs?: string;
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
  repositoriesByTopic?: string[];
  repositories?: Record<string, TrackerMemoryRepository>;
}

export interface TrackerMemoryCommit {
  repository: string;
  branch: string;
  headSha: string;
  changes: FileChange[];
  message: string;
}

export interface TrackerMemoryLabelWrite {
  kind: "create" | "update";
  repository: string;
  label: Label;
}

export interface TrackerMemory extends Tracker {
  commits: TrackerMemoryCommit[];
  labelWrites: TrackerMemoryLabelWrite[];
  workflowApprovalsSet: string[];
  secretsSet: Record<string, Record<string, string>>;
}

export function trackerMemory(seed: TrackerMemorySeed = {}): TrackerMemory {
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
  const repositories = new Map(Object.entries(seed.repositories ?? {}));
  const commits: TrackerMemoryCommit[] = [];
  const labelWrites: TrackerMemoryLabelWrite[] = [];
  const workflowApprovalsSet: string[] = [];
  const secretsSet: Record<string, Record<string, string>> = {};
  let commitCounter = 0;

  function repositoryOf(name: string): TrackerMemoryRepository {
    const repository = repositories.get(name);
    if (repository === undefined) throw new Error(`tracker memory: no repository seeded for ${name}`);
    if (repository.refuses) throw new Error(repository.refuses);
    return repository;
  }

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
    repositoriesByTopic: () => seed.repositoriesByTopic ?? [],
    defaultBranch: (name) => repositoryOf(name).defaultBranch ?? "main",
    headCommit: (name) => repositoryOf(name).headCommit,
    directoryFiles: (name, path) => repositoryOf(name).directories?.[path] ?? [],
    fileContent: (name, path) => {
      const repository = repositoryOf(name);
      if (repository.refusesDocs) throw new Error(repository.refusesDocs);
      return repository.files?.[path];
    },
    commitFiles: (name, branch, headSha, changes, message) => {
      repositoryOf(name);
      commitCounter += 1;
      commits.push({ repository: name, branch, headSha, changes, message });
      return `memory-commit-${commitCounter}`;
    },
    repositoryLabels: (name) => repositoryOf(name).labels ?? [],
    createLabel: (name, label) => {
      const repository = repositoryOf(name);
      if (repository.refusesLabels) throw new Error(repository.refusesLabels);
      repository.labels = [...(repository.labels ?? []), label];
      labelWrites.push({ kind: "create", repository: name, label });
    },
    updateLabel: (name, label) => {
      const repository = repositoryOf(name);
      if (repository.refusesLabels) throw new Error(repository.refusesLabels);
      repository.labels = (repository.labels ?? []).map((existing) => (existing.name === label.name ? label : existing));
      labelWrites.push({ kind: "update", repository: name, label });
    },
    setWorkflowApproval: (name) => {
      const repository = repositoryOf(name);
      if (repository.refusesSetting) throw new Error(repository.refusesSetting);
      workflowApprovalsSet.push(name);
      return (repository.workflowApprovalReadBack ?? "true") === "true";
    },
    setSecret: (name, secretName, value) => {
      const repository = repositoryOf(name);
      if (repository.refusesSecrets) throw new Error(repository.refusesSecrets);
      secretsSet[name] = { ...(secretsSet[name] ?? {}), [secretName]: value };
    },
    commits,
    labelWrites,
    workflowApprovalsSet,
    secretsSet,
  };
}
