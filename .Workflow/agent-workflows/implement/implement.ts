import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { execGh, type GhExec } from "../shared/gh";
import { execGit, type GitExec } from "../shared/git";
import { implementationBranch, TICKET_READY_DISPATCH_ACTION } from "../shared/ready-set";
import { reason } from "../shared/reason";
import { execClaudeIn, runStage, type StageExec } from "../shared/stage";
import { structuredOutput } from "../shared/structured-output";
import {
  extractFilesClaimed,
  normalizeNewlines,
  parentPrdNumber,
  readTicket,
  sectionText,
  type TicketRead,
} from "../shared/ticket-shape";
import {
  claimImplementationBranch,
  ImplementerAnswer,
  landAnswer,
  releaseFailedClaim,
  sayOnTicket,
  staleClaimTakeoverNote,
  type ImplementOutcome,
} from "../shared/implementation-landing";
import { VERIFY_DISPATCH_EVENT_TYPE } from "../shared/verify-dispatch";
import { runVitestJson, type TestRunResult } from "../shared/vitest-json";
import { recordOutOfBrief } from "./out-of-brief";

// The landing half of this lane — claim, write, commit, push, PR, dispatch — lives in
// `shared/implementation-landing.ts` because `recover/recover.ts` runs the very same code over a
// recovered answer. Re-exported here so this lane's tests and readers keep one door.
export {
  CLAIM_TIMEOUT_MINUTES,
  ImplementerAnswer,
  staleClaimTakeoverNote,
  worktreeChanges,
  type ImplementOutcome,
} from "../shared/implementation-landing";

/**
 * Lane: build one ticket from exactly the brief this file assembles — the
 * ticket body, the seam manifest lines it consumes, its target module's
 * `CONTEXT.md`, and its own failing acceptance test file(s) — never a
 * broader repository read (PRD #145 move 6, #167).
 *
 * A Sonnet stage (build/execution work, not the judgement-under-uncertainty
 * every Opus stage in this pipeline is priced for) writes the files the
 * ticket needs, deterministically applied here — the same
 * author-writes/wrapper-applies split `acceptance/acceptance.ts` uses, kept
 * for the same reason: a model's own `gh`/`git` calls are not something a
 * headless run can be trusted to get right unsupervised, so this wrapper
 * owns every write to disk and every write to GitHub, and the stage's only
 * output is structured content.
 */

/** Build/execution work, priced against the pipeline's Opus-tier judgement stages — see the header. */
export const IMPLEMENTER_MODEL = "claude-sonnet-5";

export const IMPLEMENTER_PROMPT_PATH = ".Workflow/agent-workflows/implement/implementer/prompt.md";

/**
 * The `repository_dispatch` action `implement.yml`'s job gates on — the one authority
 * `implement.yml`'s `if:` and the wiring table (`shared/lane-wiring.ts`) both check against, since no compiler
 * sees across the JS↔YAML boundary (the same pattern `SPEC_DISPATCH_EVENT_TYPE` and
 * `AUDIT_DISPATCH_ACTION` follow).
 *
 * Re-exported from `shared/ready-set.ts` rather than declared here, for the reason
 * `VERIFY_DISPATCH_EVENT_TYPE` below is: it has **two senders** now, not one — the publish step
 * (`to-tickets/slice-and-publish.ts`) and the reconciler (`dispatch/reconcile.ts`) — and `shared/`
 * is the only place both can reach without a lane importing a lane. Declaring a wire name twice is
 * what left both of `verify.yml`'s jobs unreachable until #145's seam audit.
 */
export const IMPLEMENT_DISPATCH_EVENT_TYPE = TICKET_READY_DISPATCH_ACTION;

/**
 * The `repository_dispatch` action this lane sends on success, naming the PR
 * it just opened — the implementer's own verification dispatch (ADR-0054:
 * "an implementation PR's checks fire by repository_dispatch").
 *
 * Declared in `shared/verify-dispatch.ts` alongside `dispatchVerify`, the one
 * function that sends it, because this lane is no longer its only sender —
 * the fixer, the recoverer and the ratifier all send it — and its receivers
 * (`verify.yml`'s two jobs and `integrate.yml`) must read the same string.
 * Re-exported here so `implement.test.ts` and `implement.yml` keep reading
 * it off this lane.
 */
export { VERIFY_DISPATCH_EVENT_TYPE };

/** `render-body.ts`'s `## Seams consumed` heading — present only when the slice consumed any. */
const SEAMS_HEADING_RE = /^##[ \t]+Seams consumed[ \t]*$/m;

/**
 * The seam manifest lines a ticket's `## Seams consumed` section names, one
 * per line, in the body's own order. Empty when the section is absent — a
 * slice that consumed no seam is not an error (`render-body.ts` omits the
 * heading entirely in that case).
 */
export function extractSeamsConsumed(body: string): string[] {
  const section = sectionText(normalizeNewlines(body), SEAMS_HEADING_RE);
  return section
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/**
 * The nearest `CONTEXT.md` above the first claimed file, walking up one
 * directory at a time and falling back to the repo root's own `CONTEXT.md`
 * when no closer one exists (today, every module in this repo shares the
 * root file — see `CONTEXT.md`'s own header — but a lane-owned one, the
 * shape `to-tickets.ts`'s `VOCABULARY_PATH` comment anticipates, is found
 * the same way without this function changing).
 */
export function moduleContextPath(filesClaimed: string[], fileExists: (path: string) => boolean): string {
  const ROOT_CONTEXT = "CONTEXT.md";
  if (filesClaimed.length === 0) return ROOT_CONTEXT;

  let dir = dirname(filesClaimed[0]);
  while (dir !== "." && dir !== "/") {
    const candidate = join(dir, "CONTEXT.md");
    if (fileExists(candidate)) return candidate;
    dir = dirname(dir);
  }
  return ROOT_CONTEXT;
}

/** One failing acceptance test file the brief inlines — its repo-relative path and its full content. */
export interface FailingTestFile {
  path: string;
  content: string;
}

/** Everything `assembleBrief` is built from — exactly the four ingredients #167 names, nothing else. */
export interface BriefInputs {
  ticketBody: string;
  seamManifestLines: string[];
  moduleContext: string;
  failingTests: FailingTestFile[];
}

/**
 * Assembles the implementer's whole prompt input from exactly four
 * ingredients: the ticket body, the seam manifest lines it consumes, the
 * target module's `CONTEXT.md`, and its failing acceptance test file(s).
 * Deterministic — the same inputs always render the same string — which is
 * what lets `implement.test.ts` assert the result contains only these four
 * and nothing else by building the same template independently rather than
 * trusting this function's own account of itself.
 */
export function assembleBrief(inputs: BriefInputs): string {
  const seams = inputs.seamManifestLines.length > 0 ? inputs.seamManifestLines.join("\n") : "(none)";
  const tests =
    inputs.failingTests.length > 0
      ? inputs.failingTests.map((file) => `### ${file.path}\n\n${file.content}`).join("\n\n")
      : "(none)";

  return [
    "## Ticket",
    inputs.ticketBody,
    "## Seam manifest lines consumed",
    seams,
    "## Module CONTEXT.md",
    inputs.moduleContext,
    "## Failing acceptance test(s)",
    tests,
  ].join("\n\n");
}

/** The implementer stage's structured-output contract (`shared/structured-output.ts`). */
export const IMPLEMENTER_OUTPUT = structuredOutput(ImplementerAnswer);

/** Runs the implementer stage against an already-assembled brief and returns its answer, unwritten. */
export function runImplementer(exec: StageExec, brief: string): Promise<ImplementerAnswer> {
  return runStage(IMPLEMENTER_PROMPT_PATH, { BRIEF: brief }, exec, IMPLEMENTER_OUTPUT, {
    model: IMPLEMENTER_MODEL,
    promptViaStdin: true,
    stage: "implementer",
  });
}

/**
 * Where a run drops the implementer's answer, verbatim, the moment it has one. `implement.yml`
 * points this at the runner's temp directory and uploads the file with `if: always()`; unset — a
 * workstation run — means don't bother.
 */
export const ANSWER_PATH_ENV = "IMPLEMENT_ANSWER_PATH";

/**
 * Writes the implementer's answer down **before anything is decided about it**.
 *
 * A lane 05 answer exists in exactly one place — the model's reply — and run 33275876786 is what
 * that costs when a later step throws it away: 23 minutes and $6.36 of correct work gone, with no
 * artifact, no commit, and a runner log that renders the call as a bare `StructuredOutput()` with
 * its payload elided. Nothing on GitHub held a copy (ADR-0103). This is the copy.
 *
 * **Never throws.** A receipt is for the humans reading the run afterwards; a run that cannot write
 * one still has a ticket to build.
 */
function keepAnswer(
  writeFile: (path: string, content: string) => void,
  env: Record<string, string | undefined>,
  answer: ImplementerAnswer,
  log: (line: string) => void,
): void {
  const path = env[ANSWER_PATH_ENV];
  if (!path) return;
  try {
    writeFile(path, JSON.stringify(answer, null, 2));
    log(`kept the implementer's answer at ${path}`);
  } catch (err) {
    log(`could not keep the implementer's answer at ${path}: ${reason(err)}`);
  }
}

function fsWriteFile(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
}

export { implementationBranch };

export interface ImplementDeps {
  gh: GhExec;
  exec: StageExec;
  git: GitExec;
  readFile: (path: string) => string;
  fileExists: (path: string) => boolean;
  writeFile: (path: string, content: string) => void;
  issueNumber: number;
  /**
   * The failing acceptance test file(s) for this slice — a **thunk**, deliberately, not a resolved
   * array.
   *
   * It was resolved eagerly, and that quietly broke #179's guarantee. `main` builds this object as
   * the argument to `runImplement`, so an eagerly-resolved `failingTests` ran
   * `findFailingTestFiles` — a full `vitest run tests/acceptance/` — *before* `runImplement` was
   * entered, and therefore before `claimImplementationBranch`. The claim was documented as
   * happening "before the ticket read and long before the model"; in practice a whole acceptance
   * suite ran first. On 2026-09-02 that window was seventeen minutes and counting on two runs, and
   * it is what let the reconciler read a live implementer as unstarted and dispatch a second one
   * against #342.
   *
   * Called from `buildAndOpen`, after the claim is held. Two things follow: the window is the
   * claim's own API call again rather than a test suite, and a run that exits `already-claimed`
   * no longer pays for an acceptance suite it will never use.
   */
  failingTests: () => FailingTestFile[];
  /** Where a refused claim is reported. Injected so a test reads it rather than the run log. */
  log?: (line: string) => void;
  /** When this run started, for judging a claim's age. Injected so a test can age one. */
  now?: Date;
  /** Read for `ANSWER_PATH_ENV` only. Injected so a test names a path without setting one. */
  env?: Record<string, string | undefined>;
}

/**
 * The whole implement flow, end to end: claim the branch, read the ticket, assemble its brief
 * from exactly the four ingredients #167 names, run the implementer stage,
 * write what it returns, commit and push the claimed branch, then open exactly one PR
 * and send exactly one verification dispatch naming it.
 *
 * **A claim this run made does not outlive it** (#196). Every path out of here that is not an open
 * pull request gives the branch back: a throw anywhere after the claim, and the no-op where the
 * implementer's files match trunk. The claim is the ready set's `started` term
 * (`shared/ready-set.ts`), so a claim left standing by a dead run is not a stale ref — it is a
 * ticket nothing will ever build again, which is exactly what happened twice in one evening and
 * both times took a `git push origin --delete` by hand to clear.
 */
export async function runImplement(deps: ImplementDeps): Promise<ImplementOutcome> {
  const log = deps.log ?? ((line: string) => console.log(line));

  // First, before the ticket read and long before the model: the claim is only a claim if nothing
  // expensive has happened yet.
  const branch = implementationBranch(deps.issueNumber);
  const claim = claimImplementationBranch(deps.gh, deps.git, branch, log, deps.now ?? new Date());
  if (!claim.claimed) return { outcome: "already-claimed" };

  // A retry that succeeded and a retry that was refused both used to look like a green run with no
  // PR. Saying this on the ticket is what tells them apart, for a reader who has only the tracker.
  if (claim.tookOverStaleClaim) {
    sayOnTicket(deps.gh, deps.issueNumber, staleClaimTakeoverNote(branch), log);
  }

  try {
    return await buildAndOpen(deps, branch, log);
  } catch (err) {
    releaseFailedClaim(deps.gh, branch, log);
    throw err;
  }
}

/** Everything between a held claim and an opened pull request — see `runImplement` for the frame. */
async function buildAndOpen(deps: ImplementDeps, branch: string, log: (line: string) => void): Promise<ImplementOutcome> {
  // Before the brief and long before the model: a dispatch can name a ticket that already merged
  // and closed — #279's stalled wave arrived exactly here, as a full model run against finished
  // work that exited green and made the stall invisible. A closed ticket is refused out loud and
  // the claim is put back. Its own read, not a field on `readTicket`: that call's argv is a pinned
  // seam three other lanes' fakes route on.
  const stateRead = JSON.parse(deps.gh(["issue", "view", String(deps.issueNumber), "--json", "state"])) as {
    state?: string;
  };
  if (stateRead.state === "CLOSED") {
    log(`refusing #${deps.issueNumber}: the ticket is already closed — a stale dispatch builds nothing`);
    releaseFailedClaim(deps.gh, branch, log);
    return { outcome: "ticket-closed" };
  }

  const ticket = readTicket(deps.gh, deps.issueNumber);
  const seamManifestLines = extractSeamsConsumed(ticket.body);
  const filesClaimed = extractFilesClaimed(ticket.body);
  const contextPath = moduleContextPath(filesClaimed, deps.fileExists);
  const moduleContext = deps.readFile(contextPath);

  const brief = assembleBrief({
    ticketBody: ticket.body,
    seamManifestLines,
    moduleContext,
    failingTests: deps.failingTests(),
  });

  const answer = await runImplementer(deps.exec, brief);
  keepAnswer(deps.writeFile, deps.env ?? process.env, answer, log);

  // Non-blocking (ADR-0042): every out-of-brief read the implementer reports is recorded on the
  // standing tracker issue and nothing else — never a `dependencies/blocked_by` write, never a
  // pause. The dependency graph stays lane 03's alone (ADR-0069).
  for (const module of answer.outOfBriefReads) {
    recordOutOfBrief(deps.gh, module);
  }

  return landAnswer(
    deps,
    branch,
    deps.issueNumber,
    ticket,
    answer,
    `Implement #${deps.issueNumber}\n\n${answer.summary}\n\nPart of #${deps.issueNumber}`,
    log,
    { rebaseOntoTrunk: true },
  );
}

/**
 * The acceptance files belonging to one slice: `tests/acceptance/<issue>-*`, the naming lane 04
 * authors by (`acceptance.ts`) and `testsForCriteria` matches against.
 *
 * This scoping is the difference between a brief and a repository read. `findFailingTestFiles`
 * used to run the *whole* acceptance directory and hand back every failure in it: on 2026-09-03
 * that was 19 files, of which 10 belonged to no live ticket at all, and each implementer was
 * handed all of them as "its own failing acceptance test(s)". Its own docstring already promised
 * per-issue scoping that its signature could not deliver — it never took an issue number.
 *
 * The cost was not only wrong content. The unscoped run took 257 seconds of test CPU, which is
 * roughly 26 minutes on the two-core runner this lane gets — measured on runs 33696576981 and
 * 33697122706, both of which spent more than half of `implement.yml`'s 45-minute cap here before
 * their model started. One slice's files are ~13 seconds of the same measure.
 */
export function sliceTestFiles(dir: string, issueNumber: number, repoDir: string): string[] {
  const root = resolve(repoDir, dir);
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .filter((name) => name.startsWith(`${issueNumber}-`) && /\.(test|spec)\.[cm]?[jt]sx?$/.test(name))
    .map((name) => `${dir}${name}`);
}

/**
 * Every failing acceptance test file **for `issueNumber` alone**, read from disk —
 * `push-gate.ts`'s own `TestRunResult` shape, reused rather than
 * re-classified, since "which test failed" is exactly what it already
 * reports. Real production behaviour for `main()`; `runImplement` above
 * never calls this itself, so a test exercising the brief-assembly or
 * PR-and-dispatch criteria never has to run a real suite.
 *
 * `repoDir` is the tree the suite runs in and the paths are relative to —
 * the target checkout under the reusable workflow (ADR-0055), cwd anywhere
 * else. The paths that come back stay repo-relative either way: they are
 * what the brief names and what a criterion is matched against, so they
 * cannot carry a runner's absolute workspace into either.
 */
export function findFailingTestFiles(
  dir: string,
  issueNumber: number,
  readFile: (path: string) => string,
  repoDir: string = process.cwd(),
  runTests: () => TestRunResult = () => runVitestJson(`${dir}${issueNumber}-`, repoDir),
): FailingTestFile[] {
  // Nothing to run, and nothing to say: a slice whose acceptance tests lane 04 has not authored
  // yet has no failing test of its own, which is not the same as a red suite. Asked before the
  // runner is spawned, because vitest given a filter that matches no file reports an uncollected
  // suite, and this function reads that as an error.
  if (sliceTestFiles(dir, issueNumber, repoDir).length === 0) return [];

  const result = runTests();
  if (!result.collected) {
    throw new Error(`acceptance suite under ${dir} did not collect: ${result.collectionError ?? "no detail reported"}`);
  }
  const paths = [...new Set(result.failures.map((failure) => failure.name.split(" > ")[0]))];
  return paths
    .filter((path) => existsSync(resolve(repoDir, path)))
    .map((path) => ({ path, content: readFile(path) }));
}

async function main(): Promise<void> {
  const issueArg = process.argv[2];
  if (!issueArg) {
    console.error("usage: implement.ts <issue-number>");
    process.exitCode = 1;
    return;
  }
  const issueNumber = Number(issueArg);

  // Which checkout is the repository being built. `TARGET_WORKSPACE` is set only by the reusable
  // workflow (ADR-0055, amended by ADR-0132): there, this process runs from the *machine* checkout
  // — that is where this file, the implementer's prompt and the generators live — while everything
  // a ticket names is a path in the target's tree. A workstation run has one of each, so cwd is the
  // right answer and this is absent.
  //
  // Every seam below that could mean either repository is bound to the target here, in one place,
  // rather than left to whichever function happened to reach the filesystem first:
  //
  // - `exec` — the implementer holds Edit, Write and Bash and *builds with them*, so its own
  //   working directory has to be the target or a run would edit the pipeline instead of the
  //   repository it was dispatched for. This is the seam no other lane needs.
  // - `git` — `-C` bound once, the same shape `integrate.ts`'s `main` uses, so the claim's
  //   `rev-parse`, the branch, the commit and the push all describe the target.
  // - `readFile`/`fileExists`/`writeFile` — every path in play is repo-relative (the ticket's
  //   `CONTEXT.md`, the answer's own files), and `resolve` leaves the one absolute path that
  //   reaches `writeFile` — the answer receipt in the runner's temp directory — untouched.
  // - `failingTests` — the target's acceptance suite is what the brief is built from.
  const repoDir = process.env.TARGET_WORKSPACE || process.cwd();
  const inRepo = (path: string) => resolve(repoDir, path);

  try {
    const result = await runImplement({
      gh: execGh,
      exec: execClaudeIn(repoDir),
      git: (args) => execGit(["-C", repoDir, ...args]),
      readFile: (path) => readFileSync(inRepo(path), "utf8"),
      fileExists: (path) => existsSync(inRepo(path)),
      writeFile: (path, content) => fsWriteFile(inRepo(path), content),
      issueNumber,
      failingTests: () =>
        findFailingTestFiles("tests/acceptance/", issueNumber, (path) => readFileSync(inRepo(path), "utf8"), repoDir),
    });
    if (result.outcome === "already-claimed") {
      // Not a failure. A duplicate `ticket-ready` is the price of at-least-once dispatch, and the
      // branch ref is what makes it free — exiting green here is that guarantee being kept.
      console.log(`#${issueNumber} is already claimed — nothing to do.`);
      return;
    }
    if (result.outcome === "ticket-closed") {
      // A refusal, not a failure: the graph moved between the dispatch and this run (#279). Red
      // here would summon Recover to rebuild a ticket that is already done.
      console.log(`#${issueNumber} is already closed — refused the stale dispatch.`);
      return;
    }
    if (result.outcome === "nothing-to-build") {
      // Also not a failure, and the distinction the run that died on `nothing to commit` could not
      // make (#196): the ticket was already true, the claim is back, and the ticket says so.
      console.log(`#${issueNumber} needed no changes — nothing to build.`);
      return;
    }
    if (result.outcome === "rebase-conflict") {
      // Escalated, not failed: the ticket carries `needs-human` and names what did not replay, and
      // this run spent nothing further trying to resolve it itself.
      console.log(`#${issueNumber} conflicted rebasing onto trunk: ${result.paths.join(", ")} — escalated.`);
      return;
    }
    console.log(`opened ${result.pr}`);
  } catch (err) {
    console.error(`implement failed: ${reason(err)}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
