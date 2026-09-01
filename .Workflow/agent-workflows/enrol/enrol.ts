import { appendFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { execGh, type GhExec } from "../shared/gh.ts";
import { errorMessage, reason } from "../shared/reason.ts";
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
 * The enrol lane (ADR-0133, #326): the machine writing its caller stubs into every repository that
 * carries the enrolment topic, unattended.
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
 * **This lane runs here and nowhere else.** Every other lane in this repository is a reusable
 * workflow plus a `*-caller.yml` stub, because enrolled repositories run those lanes. No enrolled
 * repository ever enrols anyone, so `enrol.yml` has no caller stub — and therefore is not in the
 * stub set, without anything having to say so (`stub-set.ts`).
 *
 * **It reaches outward on a PAT, and that is the one credential this repository stores.** ADR-0053
 * stands: `enrol.yml` fires on a push to `main` and on `workflow_dispatch`, neither of which a
 * pull request can trigger, so no pull request ever sees it. The stubs it writes carry no
 * credential at all — ADR-0132 made this repository public, so a caller checks the machine out
 * anonymously.
 *
 * **One commit per repository, not one per file.** The obvious shape — `PUT .../contents/<path>`
 * per stub — writes a commit per file, and a first enrolment ships twenty-odd of them. Each is a
 * push to the target's `main`, and the target's own `verify-caller.yml` fires on exactly that: a
 * first enrolment would spend twenty Verify runs on an estate that is already inside GitHub's free
 * minutes on CI alone (`docs/research/actions-billing-2026-08.md`). So the writes are batched
 * through the git data API into a single commit, and a run with nothing to change makes none.
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

/** What happened to one repository in one pass. */
export interface RepositoryOutcome {
  repository: string;
  /**
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
}

export interface EnrolOptions {
  gh: GhExec;
  /** This repository's `.github/workflows`, where the stub set is globbed from. */
  workflowsDir: string;
  /** The topic that decides who is enrolled. */
  topic: string;
  /** `owner/name` of the machine itself, so a topic on this repository does not enrol it into itself. */
  machineRepository: string;
  /** The machine commit these stubs came from, named in the commit message the target receives. */
  machineSha: string;
  log?: (line: string) => void;
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

/** Brings one repository up to date, reporting rather than throwing when it cannot. */
function enrolOne(
  gh: GhExec,
  repository: string,
  stubs: Stub[],
  options: EnrolOptions,
): RepositoryOutcome {
  const nothing: RepositoryOutcome = { repository, code: "failed", wrote: [], deleted: [], unchanged: 0 };
  try {
    const branch = gh(["api", `repos/${repository}`, "--jq", ".default_branch"]).trim();
    const plan = planFor(stubs, remoteStubs(gh, repository, branch));

    if (planIsEmpty(plan)) {
      return { ...nothing, code: "current", unchanged: plan.unchanged.length };
    }

    // An empty repository has no commit to build a tree on. That is a state one push fixes, not a
    // defect in the estate, so it is skipped rather than counted as a failure that reds the run.
    const headSha = headCommit(gh, repository, branch);
    if (headSha === undefined) {
      return { ...nothing, code: "skipped", why: `${branch} carries no commit to build on` };
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
      repository,
      code: "written",
      wrote: plan.writes.map((stub) => stub.name),
      deleted: plan.deletes.map((file) => file.name),
      unchanged: plan.unchanged.length,
      commit,
    };
  } catch (err) {
    return { ...nothing, code: "failed", why: reason(err) };
  }
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

    const outcome = enrolOne(options.gh, repository, stubs, options);
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
  if (code === "current") return `${repository}: current — ${outcome.unchanged} stub(s) already match`;
  if (code === "skipped") return `${repository}: skipped — ${outcome.why ?? "no reason given"}`;
  if (code === "failed") return `${repository}: FAILED — ${outcome.why ?? "no reason given"}`;
  const wrote = outcome.wrote.length === 0 ? "" : ` wrote ${outcome.wrote.join(", ")};`;
  const deleted = outcome.deleted.length === 0 ? "" : ` deleted ${outcome.deleted.join(", ")};`;
  return `${repository}: ${outcome.commit ?? "?"} —${wrote}${deleted} ${outcome.unchanged} unchanged`;
}

/**
 * What the process exits with, given what the pass did.
 *
 * A failed repository reds the run even though every other one was brought up to date: the estate
 * is now on two different stub sets, and the only thing that can notice is whoever reads this
 * run's conclusion. `skipped` is not a failure — the machine itself, and a repository with no
 * commit yet, are both states the run is right to walk past.
 */
export function exitCodeFor(outcomes: RepositoryOutcome[]): number {
  return outcomes.some((outcome) => outcome.code === "failed") ? 1 : 0;
}

async function main(): Promise<void> {
  try {
    const machineRepository = process.env.GITHUB_REPOSITORY;
    if (!machineRepository) {
      throw new Error("GITHUB_REPOSITORY must be set — without it this lane cannot tell itself from a target");
    }
    const machineSha = process.env.GITHUB_SHA ?? "unknown";

    const outcomes = runEnrol({
      gh: execGh,
      workflowsDir: WORKFLOWS_PATH,
      topic: ENROLMENT_TOPIC,
      machineRepository,
      machineSha,
    });

    const summary = process.env.GITHUB_STEP_SUMMARY;
    if (summary) {
      const lines = [`### Enrolment: topic \`${ENROLMENT_TOPIC}\``, "", ...outcomes.map((o) => `- ${describeOutcome(o)}`)];
      appendFileSync(summary, `${lines.join("\n")}\n`);
    }

    const exitCode = exitCodeFor(outcomes);
    if (exitCode !== 0) {
      const failed = outcomes.filter((outcome) => outcome.code === "failed").length;
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
