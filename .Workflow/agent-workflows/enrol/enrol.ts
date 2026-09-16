import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { execGh, type GhExec } from "../shared/gh.ts";
import { reason } from "../shared/reason.ts";
import { catalogueLabels, syncLabels, type Label } from "../shared/label-sync.ts";
import { trackerGh } from "../shared/tracker-gh.ts";
import type { FileChange, Tracker } from "../shared/tracker.ts";
import { derivedSecretNames } from "./secrets.ts";
import { SEEDED_DOC_NAMES, pointerDoc, pointerDocPath, withAgentSkillsPointer } from "./seeded-docs.ts";
import {
  planFor,
  planIsEmpty,
  readStubSet,
  STUB_SUFFIX,
  WORKFLOWS_PATH,
  type EnrolPlan,
  type Stub,
} from "./stub-set.ts";

export const ENROLMENT_TOPIC = "claude-workflow-enrolled";

export interface RepositoryOutcome {
  repository: string;
  code: "current" | "written" | "skipped" | "failed";
  wrote: string[];
  deleted: string[];
  unchanged: number;
  commit?: string;
  why?: string;
  labelsWritten?: string[];
  labelsFailure?: string;
  settingFailure?: string;
  secretsWritten?: string[];
  secretsFailure?: string;
  docsWritten?: string[];
  docsFailure?: string;
}

export interface EnrolOptions {
  gh: GhExec;
  workflowsDir: string;
  topic: string;
  machineRepository: string;
  machineSha: string;
  secretValues: Record<string, string>;
  log?: (line: string) => void;
}

interface Attempt<T> {
  value?: T;
  failure?: string;
}

function attempt<T>(fn: () => T): Attempt<T> {
  try {
    return { value: fn() };
  } catch (err) {
    return { failure: reason(err) };
  }
}

function asTracker(gh: GhExec): Tracker {
  return gh as unknown as Tracker;
}

export function enrolledRepositories(gh: GhExec, topic: string): string[] {
  return asTracker(gh).repositoriesByTopic(topic);
}

function commitPlan(
  gh: GhExec,
  repository: string,
  branch: string,
  headSha: string,
  plan: EnrolPlan,
  message: string,
): string {
  const changes: FileChange[] = [
    ...plan.writes.map((stub) => ({ path: `${WORKFLOWS_PATH}/${stub.name}`, content: stub.content })),
    ...plan.deletes.map((file) => ({ path: `${WORKFLOWS_PATH}/${file.name}`, content: null })),
  ];
  return asTracker(gh).commitFiles(repository, branch, headSha, changes, message);
}

function seededDocMessage(paths: string[], machineRepository: string): string {
  return [
    `docs: point ${paths.length} seeded doc(s) at ${machineRepository}`,
    "",
    "Written by the enrol lane, not by hand: these are pointers, not copies, naming this",
    `repository's own file at ${machineRepository} and the workstation clone path.`,
    "",
    ...paths.map((path) => `- ${path}`),
  ].join("\n");
}

function syncSeededDocs(
  gh: GhExec,
  repository: string,
  machineRepository: string,
): Pick<RepositoryOutcome, "docsWritten" | "docsFailure"> {
  try {
    const tracker = asTracker(gh);
    const branch = tracker.defaultBranch(repository);
    const desired = SEEDED_DOC_NAMES.map((name) => ({
      path: pointerDocPath(name),
      content: pointerDoc(name, machineRepository),
    }));

    const changed: FileChange[] = desired.filter(
      (doc) => tracker.fileContent(repository, doc.path, branch) !== doc.content,
    );

    const currentClaudeMd = tracker.fileContent(repository, "CLAUDE.md", branch);
    if (currentClaudeMd !== undefined) {
      const desiredClaudeMd = withAgentSkillsPointer(currentClaudeMd, machineRepository);
      if (desiredClaudeMd !== currentClaudeMd) changed.push({ path: "CLAUDE.md", content: desiredClaudeMd });
    }

    if (changed.length === 0) return { docsWritten: [] };

    const headSha = tracker.headCommit(repository, branch);
    if (headSha === undefined) return { docsWritten: [] };

    tracker.commitFiles(
      repository,
      branch,
      headSha,
      changed,
      seededDocMessage(
        changed.map((c) => c.path),
        machineRepository,
      ),
    );
    return { docsWritten: changed.map((c) => c.path) };
  } catch (err) {
    return { docsFailure: reason(err) };
  }
}

function commitMessage(plan: EnrolPlan, machineRepository: string, machineSha: string): string {
  const changed = plan.writes.length + plan.deletes.length;
  return [
    `ci: carry ${changed} caller stub change(s) from ${machineRepository}`,
    "",
    "Written by the enrol lane, not by hand: this repository carries the enrolment topic, so the",
    "stubs under .github/workflows/*-caller.yml are the machine's and are overwritten from it",
    "Edit them there, never here.",
    "",
    `Machine-Sha: ${machineSha}`,
  ].join("\n");
}

function setPullRequestApproval(gh: GhExec, repository: string): void {
  const readBack = asTracker(gh).setWorkflowApproval(repository);
  if (!readBack) {
    throw new Error(`can_approve_pull_request_reviews read back as ${readBack}, not true (ADR-0093)`);
  }
}

function propagateSecrets(gh: GhExec, repository: string, names: string[], values: Record<string, string>): string[] {
  const tracker = asTracker(gh);
  for (const name of names) {
    const value = values[name];
    if (value === undefined) {
      throw new Error(`${name}: this job's own environment carries no value for it; see enrol.yml's env`);
    }
    tracker.setSecret(repository, name, value);
  }
  return names;
}

function syncStubs(
  gh: GhExec,
  repository: string,
  stubs: Stub[],
  options: EnrolOptions,
): Pick<RepositoryOutcome, "code" | "wrote" | "deleted" | "unchanged" | "commit" | "why"> {
  try {
    const tracker = asTracker(gh);
    const branch = tracker.defaultBranch(repository);
    const plan = planFor(stubs, tracker.directoryFiles(repository, WORKFLOWS_PATH, branch));

    if (planIsEmpty(plan)) {
      return { code: "current", wrote: [], deleted: [], unchanged: plan.unchanged.length };
    }

    const headSha = tracker.headCommit(repository, branch);
    if (headSha === undefined) {
      return { code: "skipped", wrote: [], deleted: [], unchanged: 0, why: `${branch} carries no commit to build on` };
    }

    const commit = commitPlan(
      gh,
      repository,
      branch,
      headSha,
      plan,
      commitMessage(plan, options.machineRepository, options.machineSha),
    );
    return {
      code: "written",
      wrote: plan.writes.map((stub) => stub.name),
      deleted: plan.deletes.map((file) => file.name),
      unchanged: plan.unchanged.length,
      commit,
    };
  } catch (err) {
    return { code: "failed", wrote: [], deleted: [], unchanged: 0, why: reason(err) };
  }
}

function enrolOne(
  gh: GhExec,
  repository: string,
  stubs: Stub[],
  ownLabels: Label[],
  secretNames: string[],
  options: EnrolOptions,
): RepositoryOutcome {
  const stubOutcome = syncStubs(gh, repository, stubs, options);
  const labels = attempt(() => syncLabels(gh, repository, ownLabels));
  const setting = attempt(() => setPullRequestApproval(gh, repository));
  const secrets = attempt(() => propagateSecrets(gh, repository, secretNames, options.secretValues));
  const docs = syncSeededDocs(gh, repository, options.machineRepository);

  return {
    repository,
    ...stubOutcome,
    labelsWritten: labels.value,
    labelsFailure: labels.failure,
    settingFailure: setting.failure,
    secretsWritten: secrets.value,
    secretsFailure: secrets.failure,
    ...docs,
  };
}

export function runEnrol(options: EnrolOptions): RepositoryOutcome[] {
  const log = options.log ?? ((line: string) => console.log(line));
  const stubs = readStubSet(options.workflowsDir);
  if (stubs.length === 0) {
    throw new Error(
      `no *${STUB_SUFFIX} stubs found in ${options.workflowsDir}: enrolling an empty set would ` +
        "delete every stub in every enrolled repository",
    );
  }

  const ownLabels = catalogueLabels();
  const secretNames = derivedSecretNames(options.workflowsDir);

  const outcomes: RepositoryOutcome[] = [];
  for (const repository of enrolledRepositories(options.gh, options.topic)) {
    if (repository === options.machineRepository) {
      log(`${repository}: skipped: this is the machine itself`);
      outcomes.push({
        repository,
        code: "skipped",
        wrote: [],
        deleted: [],
        unchanged: 0,
        why: "the machine does not enrol itself",
      });
      continue;
    }

    const outcome = enrolOne(options.gh, repository, stubs, ownLabels, secretNames, options);
    log(describeOutcome(outcome));
    outcomes.push(outcome);
  }

  if (outcomes.length === 0) {
    log(`no repository carries the topic ${options.topic}; nothing to enrol`);
  }
  return outcomes;
}

export function describeOutcome(outcome: RepositoryOutcome): string {
  const { repository, code } = outcome;
  const base = (() => {
    if (code === "current") return `${repository}: current, ${outcome.unchanged} stub(s) already match`;
    if (code === "skipped") return `${repository}: skipped, ${outcome.why ?? "no reason given"}`;
    if (code === "failed") return `${repository}: FAILED, ${outcome.why ?? "no reason given"}`;
    const wrote = outcome.wrote.length === 0 ? "" : ` wrote ${outcome.wrote.join(", ")};`;
    const deleted = outcome.deleted.length === 0 ? "" : ` deleted ${outcome.deleted.join(", ")};`;
    return `${repository}: ${outcome.commit ?? "?"},${wrote}${deleted} ${outcome.unchanged} unchanged`;
  })();

  const extra: string[] = [];
  if (outcome.labelsFailure !== undefined) extra.push(`labels FAILED, ${outcome.labelsFailure}`);
  else if (outcome.labelsWritten !== undefined && outcome.labelsWritten.length > 0) {
    extra.push(`labels: ${outcome.labelsWritten.join(", ")}`);
  }
  if (outcome.settingFailure !== undefined) extra.push(`ADR-0093 setting FAILED, ${outcome.settingFailure}`);
  if (outcome.docsFailure !== undefined) extra.push(`docs FAILED, ${outcome.docsFailure}`);
  else if (outcome.docsWritten !== undefined && outcome.docsWritten.length > 0) {
    extra.push(`docs pointed: ${outcome.docsWritten.join(", ")}`);
  }
  if (outcome.secretsFailure !== undefined) extra.push(`secrets FAILED, ${outcome.secretsFailure}`);
  else if (outcome.secretsWritten !== undefined && outcome.secretsWritten.length > 0) {
    extra.push(`secrets written: ${outcome.secretsWritten.join(", ")}`);
  }

  return extra.length === 0 ? base : `${base}; ${extra.join("; ")}`;
}

export function exitCodeFor(outcomes: RepositoryOutcome[]): number {
  return outcomes.some(
    (outcome) =>
      outcome.code === "failed" ||
      outcome.labelsFailure !== undefined ||
      outcome.settingFailure !== undefined ||
      outcome.secretsFailure !== undefined,
  )
    ? 1
    : 0;
}

async function main(): Promise<void> {
  try {
    const machineRepository = process.env.GITHUB_REPOSITORY;
    if (!machineRepository) {
      throw new Error("GITHUB_REPOSITORY must be set: without it this lane cannot tell itself from a target");
    }
    const machineSha = process.env.GITHUB_SHA ?? "unknown";

    const secretValues: Record<string, string> = {};
    const unset: string[] = [];
    for (const name of derivedSecretNames(WORKFLOWS_PATH)) {
      const value = process.env[name];
      if (value === undefined || value === "") unset.push(name);
      else secretValues[name] = value;
    }
    if (unset.length > 0) {
      throw new Error(
        `${unset.join(", ")} empty in this lane's environment: every enrolled repository would be ` +
          "written a stub set whose lanes have no credential, and fail only when one next runs",
      );
    }

    const outcomes = runEnrol({
      gh: trackerGh(execGh) as unknown as GhExec,
      workflowsDir: WORKFLOWS_PATH,
      topic: ENROLMENT_TOPIC,
      machineRepository,
      machineSha,
      secretValues,
    });

    const summary = process.env.GITHUB_STEP_SUMMARY;
    if (summary) {
      const lines = [`### Enrolment: topic \`${ENROLMENT_TOPIC}\``, "", ...outcomes.map((o) => `- ${describeOutcome(o)}`)];
      appendFileSync(summary, `${lines.join("\n")}\n`);
    }

    const exitCode = exitCodeFor(outcomes);
    if (exitCode !== 0) {
      const failed = outcomes.filter(
        (outcome) =>
          outcome.code === "failed" ||
          outcome.labelsFailure !== undefined ||
          outcome.settingFailure !== undefined ||
          outcome.secretsFailure !== undefined,
      ).length;
      console.error(`enrol: ${failed} of ${outcomes.length} repository(s) failed`);
      process.exitCode = exitCode;
    }
  } catch (err) {
    console.error(`enrol failed: ${reason(err)}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
