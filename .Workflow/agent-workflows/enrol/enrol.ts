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

/**
 * The enrol lane (ADR-0133, #326, #327): the machine writing its caller stubs, its label set, the
 * ADR-0093 repository setting, and the secrets its lanes spend into every repository that carries
 * the enrolment topic, unattended.
 *
 * This is what replaces the `bin/install` ADR-0057 specified and #180 never built. The difference
 * is not the code — it is that a command has to be remembered, per repository, per lane change,
 * and a lane does not. Adding a lane here reaches every enrolled repository on the next push to
 * `main`; adding a repository is `gh repo edit --add-topic` and one dispatch.
 *
 * **The topic is the list.** No file on either side names a target. `GET /search/repositories` for
 * the topic is the whole enumeration (ADR-0133), which is also its accepted cost: a stale or
 * over-broad topic silently enrols a repository, and the topic decides rather than the token's
 * selection.
 *
 * **Every one of the four writes is derived, never enumerated.** The stub set is a glob over this
 * repository's own `.github/workflows` (`stub-set.ts`). The label set is read off this
 * repository's own live labels (`labels.ts`). The secret set is read off this repository's own
 * workflow files (`secrets.ts`). None of the three names a value in this file — a second copy of
 * any of them here would be exactly the enumerated manifest ADR-0057 rejected.
 *
 * **The four writes are independent per repository.** A repository whose label sync fails is
 * still worth the ADR-0093 setting and the secrets; a repository with no commit yet to build a
 * stub commit on is still worth all three of the others, since none of them touches git history.
 * Each is attempted and reported on its own, and a failure in one never withholds an attempt at
 * another — the loop over repositories is what stops on nothing.
 *
 * **This lane runs here and nowhere else.** Every other lane in this repository is a reusable
 * workflow plus a `*-caller.yml` stub, because enrolled repositories run those lanes. No enrolled
 * repository ever enrols anyone, so `enrol.yml` has no caller stub — and therefore is not in the
 * stub set, without anything having to say so (`stub-set.ts`).
 *
 * **It reaches outward on a PAT, and that is the one credential this repository stores.** ADR-0053
 * stands: `enrol.yml` fires on a push to `main` and on `workflow_dispatch`, neither of which a
 * pull request can trigger, so no pull request ever sees it. The stubs it writes carry no
 * credential at all — ADR-0132 made this repository public, so a caller checks the machine out
 * anonymously. The two secrets it propagates are this repository's own values, handed to the job
 * by name in `enrol.yml` and never read back once written — a secret's value cannot be read back
 * at all, which is why that write is unconditional rather than compare-then-write.
 *
 * **One commit per repository, not one per file**, for the stub half. The obvious shape —
 * `PUT .../contents/<path>` per stub — writes a commit per file, and a first enrolment ships
 * twenty-odd of them. Each is a push to the target's `main`, and the target's own
 * `verify-caller.yml` fires on exactly that: a first enrolment would spend twenty Verify runs on
 * an estate that is already inside GitHub's free minutes on CI alone
 * (`docs/research/actions-billing-2026-08.md`). So the writes are batched through the git data API
 * into a single commit, and a run with nothing to change makes none.
 */

/**
 * The repository topic that means "run this machine's lanes".
 *
 * Deliberately not `claude-workflow`: that is the natural discovery topic for this repository
 * itself, and a repository is skipped from its own enrolment by identity below rather than by
 * hoping nobody ever tags it.
 */
export const ENROLMENT_TOPIC = "claude-workflow-enrolled";

/** A regular, non-executable file, as the git tree API spells the mode. */
const FILE_MODE = "100644";

/** How many repositories one search page returns. Above any plausible estate, so paging is a formality. */
const SEARCH_PAGE_SIZE = 100;

/** `gh`'s own rendering of a 404, which is how a target with no `.github/workflows` yet answers. */
const NOT_FOUND = "HTTP 404";

const RemoteFileSchema = z.object({ name: z.string(), sha: z.string() });

/** One label as `gh api .../labels` reports it — GitHub allows a `null` description. */
const RemoteLabelSchema = z.object({
  name: z.string(),
  color: z.string(),
  description: z.string().nullable().optional(),
});

/** What happened to one repository in one pass. */
export interface RepositoryOutcome {
  repository: string;
  /**
   * The stub half of this repository's outcome.
   * `current` — nothing differed, and nothing was written.
   * `written` — a commit landed; `wrote`/`deleted` name what was in it.
   * `skipped` — this repository is the machine itself, or holds no commit to build on.
   * `failed` — `why` says what refused, and the pass continued to the rest.
   */
  code: "current" | "written" | "skipped" | "failed";
  wrote: string[];
  deleted: string[];
  unchanged: number;
  commit?: string;
  why?: string;
  /** Label names created or corrected in this pass. Absent when the sync itself failed. */
  labelsWritten?: string[];
  /** Set when this repository's label sync failed — the stub, setting, and secret work still ran. */
  labelsFailure?: string;
  /** Set when the ADR-0093 `PUT` or its read-back failed for this repository. */
  settingFailure?: string;
  /** Secret names propagated in this pass. Absent when the propagation itself failed. */
  secretsWritten?: string[];
  /** Set when propagating one or more secrets to this repository failed. */
  secretsFailure?: string;
}

export interface EnrolOptions {
  gh: GhExec;
  /** This repository's `.github/workflows`, where the stub set and the secret set are derived from. */
  workflowsDir: string;
  /** The topic that decides who is enrolled. */
  topic: string;
  /** `owner/name` of the machine itself, so a topic on this repository does not enrol it into itself. */
  machineRepository: string;
  /** The machine commit these stubs came from, named in the commit message the target receives. */
  machineSha: string;
  /**
   * Every derived secret's value, keyed by name — this job's own environment, since GitHub Actions
   * hands a job the value of a secret only when that secret was named to it (see `enrol.yml`).
   */
  secretValues: Record<string, string>;
  log?: (line: string) => void;
}

/** The result of one independent write attempt: its value, or the reason it refused. */
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

/** One `gh api` POST whose body is JSON this argv cannot express as flat fields. */
function postJson(gh: GhExec, path: string, body: unknown, jq: string): string {
  // `gh api -f k=v` sends flat fields only, and a git tree is an array of objects. `--input <file>`
  // is the one form that takes a JSON body through argv alone — which matters because `execGh` is
  // an `execFileSync` seam with no stdin, and widening that seam for one call site would change
  // how every lane in this repository reaches GitHub.
  const file = join(mkdtempSync(join(tmpdir(), "enrol-")), "body.json");
  writeFileSync(file, JSON.stringify(body));
  return gh(["api", "--method", "POST", path, "--input", file, "--jq", jq]).trim();
}

/** Every repository carrying `topic`, as `owner/name`. */
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

/** The stub-shaped files a target already holds, or none when it has no workflow directory yet. */
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
    // A repository that has never held a workflow is enrolled, not broken. Every other failure —
    // a token that cannot read it, a repository that is gone — has to keep travelling.
    if (errorMessage(err).includes(NOT_FOUND)) return [];
    throw err;
  }
  return RemoteFileSchema.array().parse(JSON.parse(raw));
}

/** Uploads one stub's bytes and returns the blob sha the tree will point at. */
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

/**
 * The commit `branch` points at, or `undefined` when the repository has no commit at all.
 *
 * Read separately from the commit that follows it because the two 404s mean different things: a
 * repository the token cannot see is a failure, and a repository nobody has pushed to yet is a
 * state one push fixes. Collapsing them would report the first as the second and quietly leave a
 * repository un-enrolled.
 */
function headCommit(gh: GhExec, repository: string, branch: string): string | undefined {
  try {
    return gh(["api", `repos/${repository}/git/ref/heads/${branch}`, "--jq", ".object.sha"]).trim();
  } catch (err) {
    if (errorMessage(err).includes(NOT_FOUND)) return undefined;
    throw err;
  }
}

/**
 * Lands `plan` on `branch` as one commit, and returns its sha.
 *
 * A tree entry with `sha: null` is how the git data API spells a deletion, which is what lets the
 * writes and the deletes ride in the same commit rather than in two.
 */
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

/** What the target's history says about where a commit came from — the machine, at a nameable sha. */
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

/** One repository's labels, as this repository or a target carries them. */
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

/** Brings one target's labels up to this repository's own, and reports what it touched. */
function syncLabels(gh: GhExec, repository: string, own: Label[]): string[] {
  const changes = labelPlan(own, readLabels(gh, repository));
  for (const change of changes) {
    if (change.exists) updateLabel(gh, repository, change.label);
    else createLabel(gh, repository, change.label);
  }
  return changes.map((change) => change.label.name);
}

/**
 * Sets and verifies ADR-0093's repository setting: without it, lane 05's `gh pr create` fails on a
 * repository whose every `permissions:` block is otherwise correct. The read-back is not optional
 * — a `PUT` GitHub silently ignored is worse than one this lane never made, because nothing else
 * will notice before the next pull request tries to open.
 */
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

/**
 * Hands every derived secret's value to one target.
 *
 * Unconditional rather than compare-then-write: a secret's value cannot be read back, so there is
 * nothing to compare against, and every run writes every derived secret again. `gh secret set`
 * does the repository-public-key encryption itself — no sodium handling lives in this tree.
 */
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

/** The stub half of one repository's outcome, brought up to date and reported rather than thrown. */
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

    // An empty repository has no commit to build a tree on. That is a state one push fixes, not a
    // defect in the estate, so it is skipped rather than counted as a failure that reds the run.
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

/**
 * Brings one repository up to date on all four writes, reporting rather than throwing when one
 * cannot. Each is attempted independently of the other three's outcome: none of the label sync,
 * the ADR-0093 setting, or the secret propagation touches git history, so none of them needs the
 * stub half to have succeeded, and a failure in any one still leaves the other three attempted.
 */
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

/**
 * One enrolment pass over the whole topic.
 *
 * Every repository is attempted, whatever the ones before it did: a token that cannot write one
 * repository must not leave the rest of the estate on a stub set older than the machine's, which
 * is the half-enrolled state that is worse than either end of it. The failures are what the caller
 * exits non-zero on.
 */
export function runEnrol(options: EnrolOptions): RepositoryOutcome[] {
  const log = options.log ?? ((line: string) => console.log(line));
  const stubs = readStubSet(options.workflowsDir);
  if (stubs.length === 0) {
    // Refused rather than run: an empty stub set is indistinguishable from "every lane was
    // deleted", and this lane's delete half would carry that reading into every enrolled
    // repository in one pass. A wrong working directory is the likely cause and the cheap fix.
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

/** One repository's line in the run's report. */
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

/**
 * What the process exits with, given what the pass did.
 *
 * A failure in the stub write, the label sync, the ADR-0093 setting, or the secret propagation for
 * any one repository reds the run even though every other write went through: the estate now
 * disagrees with itself on that one axis, and the only thing that can notice is whoever reads this
 * run's conclusion. `skipped` is not a failure — the machine itself, and a repository with no
 * commit yet, are both states the run is right to walk past.
 */
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
