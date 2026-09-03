import { appendFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { execGh, type GhExec } from "../shared/gh.ts";
import { errorMessage, reason } from "../shared/reason.ts";
import { labelPlan, type Label } from "./labels.ts";
import { derivedSecretNames } from "./secrets.ts";
import {
  planFor,
  planIsEmpty,
  readStubSet,
  STUB_SUFFIX,
  WORKFLOWS_PATH,
  type EnrolPlan,
  type RemoteFile,
  type Stub,
} from "./stub-set.ts";

export const ENROLMENT_TOPIC = "claude-workflow-enrolled";

const FILE_MODE = "100644";

const SEARCH_PAGE_SIZE = 100;

const NOT_FOUND = "HTTP 404";

const RemoteFileSchema = z.object({ name: z.string(), sha: z.string() });

const RemoteLabelSchema = z.object({
  name: z.string(),
  color: z.string(),
  description: z.string().nullable().optional(),
});

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

function postJson(gh: GhExec, path: string, body: unknown, jq: string): string {
  const file = join(mkdtempSync(join(tmpdir(), "enrol-")), "body.json");
  writeFileSync(file, JSON.stringify(body));
  return gh(["api", "--method", "POST", path, "--input", file, "--jq", jq]).trim();
}

export function enrolledRepositories(gh: GhExec, topic: string): string[] {
  const raw = gh([
    "api",
    "--paginate",
    `search/repositories?q=topic:${topic}&per_page=${SEARCH_PAGE_SIZE}`,
    "--jq",
    ".items[].full_name",
  ]);
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

function remoteStubs(gh: GhExec, repository: string, branch: string): RemoteFile[] {
  let raw: string;
  try {
    raw = gh([
      "api",
      `repos/${repository}/contents/${WORKFLOWS_PATH}?ref=${branch}`,
      "--jq",
      '[.[] | select(.type == "file") | {name, sha}]',
    ]);
  } catch (err) {
    if (errorMessage(err).includes(NOT_FOUND)) return [];
    throw err;
  }
  return RemoteFileSchema.array().parse(JSON.parse(raw));
}

function createBlob(gh: GhExec, repository: string, stub: Stub): string {
  return gh([
    "api",
    "--method",
    "POST",
    `repos/${repository}/git/blobs`,
    "-f",
    `content=${Buffer.from(stub.content, "utf8").toString("base64")}`,
    "-f",
    "encoding=base64",
    "--jq",
    ".sha",
  ]).trim();
}

function headCommit(gh: GhExec, repository: string, branch: string): string | undefined {
  try {
    return gh(["api", `repos/${repository}/git/ref/heads/${branch}`, "--jq", ".object.sha"]).trim();
  } catch (err) {
    if (errorMessage(err).includes(NOT_FOUND)) return undefined;
    throw err;
  }
}

function commitPlan(
  gh: GhExec,
  repository: string,
  branch: string,
  headSha: string,
  plan: EnrolPlan,
  message: string,
): string {
  const baseTree = gh(["api", `repos/${repository}/git/commits/${headSha}`, "--jq", ".tree.sha"]).trim();

  const tree = [
    ...plan.writes.map((stub) => ({
      path: `${WORKFLOWS_PATH}/${stub.name}`,
      mode: FILE_MODE,
      type: "blob",
      sha: createBlob(gh, repository, stub),
    })),
    ...plan.deletes.map((file) => ({
      path: `${WORKFLOWS_PATH}/${file.name}`,
      mode: FILE_MODE,
      type: "blob",
      sha: null,
    })),
  ];

  const treeSha = postJson(gh, `repos/${repository}/git/trees`, { base_tree: baseTree, tree }, ".sha");
  const commitSha = postJson(
    gh,
    `repos/${repository}/git/commits`,
    { message, tree: treeSha, parents: [headSha] },
    ".sha",
  );
  gh(["api", "--method", "PATCH", `repos/${repository}/git/refs/heads/${branch}`, "-f", `sha=${commitSha}`]);
  return commitSha;
}

function commitMessage(plan: EnrolPlan, machineRepository: string, machineSha: string): string {
  const changed = plan.writes.length + plan.deletes.length;
  return [
    `Carry ${changed} caller stub change(s) from ${machineRepository}`,
    "",
    "Written by the enrol lane, not by hand: this repository carries the enrolment topic, so the",
    "stubs under .github/workflows/*-caller.yml are the machine's and are overwritten from it",
    "(ADR-0133). Edit them there, never here.",
    "",
    `Machine-Sha: ${machineSha}`,
  ].join("\n");
}

function readLabels(gh: GhExec, repository: string): Label[] {
  const raw = gh(["api", "--paginate", `repos/${repository}/labels`, "--jq", ".[] | {name, color, description}"]);
  const objects = raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line));
  return RemoteLabelSchema.array()
    .parse(objects)
    .map((label) => ({ name: label.name, color: label.color, description: label.description ?? "" }));
}

function createLabel(gh: GhExec, repository: string, label: Label): void {
  gh([
    "api",
    "--method",
    "POST",
    `repos/${repository}/labels`,
    "-f",
    `name=${label.name}`,
    "-f",
    `color=${label.color}`,
    "-f",
    `description=${label.description}`,
  ]);
}

function updateLabel(gh: GhExec, repository: string, label: Label): void {
  gh([
    "api",
    "--method",
    "PATCH",
    `repos/${repository}/labels/${encodeURIComponent(label.name)}`,
    "-f",
    `color=${label.color}`,
    "-f",
    `description=${label.description}`,
  ]);
}

function syncLabels(gh: GhExec, repository: string, own: Label[]): string[] {
  const changes = labelPlan(own, readLabels(gh, repository));
  for (const change of changes) {
    if (change.exists) updateLabel(gh, repository, change.label);
    else createLabel(gh, repository, change.label);
  }
  return changes.map((change) => change.label.name);
}

function setPullRequestApproval(gh: GhExec, repository: string): void {
  gh([
    "api",
    "--method",
    "PUT",
    `repos/${repository}/actions/permissions/workflow`,
    "-F",
    "can_approve_pull_request_reviews=true",
  ]);
  const readBack = gh([
    "api",
    `repos/${repository}/actions/permissions/workflow`,
    "--jq",
    ".can_approve_pull_request_reviews",
  ]).trim();
  if (readBack !== "true") {
    throw new Error(
      `can_approve_pull_request_reviews read back as ${JSON.stringify(readBack)}, not "true" (ADR-0093)`,
    );
  }
}

function propagateSecrets(gh: GhExec, repository: string, names: string[], values: Record<string, string>): string[] {
  for (const name of names) {
    const value = values[name];
    if (value === undefined) {
      throw new Error(`${name}: this job's own environment carries no value for it — see enrol.yml's env`);
    }
    gh(["secret", "set", name, "-R", repository, "--body", value]);
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
    const branch = gh(["api", `repos/${repository}`, "--jq", ".default_branch"]).trim();
    const plan = planFor(stubs, remoteStubs(gh, repository, branch));

    if (planIsEmpty(plan)) {
      return { code: "current", wrote: [], deleted: [], unchanged: plan.unchanged.length };
    }

    const headSha = headCommit(gh, repository, branch);
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

  return {
    repository,
    ...stubOutcome,
    labelsWritten: labels.value,
    labelsFailure: labels.failure,
    settingFailure: setting.failure,
    secretsWritten: secrets.value,
    secretsFailure: secrets.failure,
  };
}

export function runEnrol(options: EnrolOptions): RepositoryOutcome[] {
  const log = options.log ?? ((line: string) => console.log(line));
  const stubs = readStubSet(options.workflowsDir);
  if (stubs.length === 0) {
    throw new Error(
      `no *${STUB_SUFFIX} stubs found in ${options.workflowsDir} — enrolling an empty set would ` +
        "delete every stub in every enrolled repository",
    );
  }

  const ownLabels = readLabels(options.gh, options.machineRepository);
  const secretNames = derivedSecretNames(options.workflowsDir);

  const outcomes: RepositoryOutcome[] = [];
  for (const repository of enrolledRepositories(options.gh, options.topic)) {
    if (repository === options.machineRepository) {
      log(`${repository}: skipped — this is the machine itself`);
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
    log(`no repository carries the topic ${options.topic} — nothing to enrol`);
  }
  return outcomes;
}

export function describeOutcome(outcome: RepositoryOutcome): string {
  const { repository, code } = outcome;
  const base = (() => {
    if (code === "current") return `${repository}: current — ${outcome.unchanged} stub(s) already match`;
    if (code === "skipped") return `${repository}: skipped — ${outcome.why ?? "no reason given"}`;
    if (code === "failed") return `${repository}: FAILED — ${outcome.why ?? "no reason given"}`;
    const wrote = outcome.wrote.length === 0 ? "" : ` wrote ${outcome.wrote.join(", ")};`;
    const deleted = outcome.deleted.length === 0 ? "" : ` deleted ${outcome.deleted.join(", ")};`;
    return `${repository}: ${outcome.commit ?? "?"} —${wrote}${deleted} ${outcome.unchanged} unchanged`;
  })();

  const extra: string[] = [];
  if (outcome.labelsFailure !== undefined) extra.push(`labels FAILED — ${outcome.labelsFailure}`);
  else if (outcome.labelsWritten !== undefined && outcome.labelsWritten.length > 0) {
    extra.push(`labels: ${outcome.labelsWritten.join(", ")}`);
  }
  if (outcome.settingFailure !== undefined) extra.push(`ADR-0093 setting FAILED — ${outcome.settingFailure}`);
  if (outcome.secretsFailure !== undefined) extra.push(`secrets FAILED — ${outcome.secretsFailure}`);
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
      throw new Error("GITHUB_REPOSITORY must be set — without it this lane cannot tell itself from a target");
    }
    const machineSha = process.env.GITHUB_SHA ?? "unknown";

    const secretValues: Record<string, string> = {};
    for (const name of derivedSecretNames(WORKFLOWS_PATH)) {
      const value = process.env[name];
      if (value !== undefined) secretValues[name] = value;
    }

    const outcomes = runEnrol({
      gh: execGh,
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
