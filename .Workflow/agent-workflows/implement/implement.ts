import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { execGh, type GhExec } from "../shared/gh";
import { execGit, type GitExec } from "../shared/git";
import { IMPLEMENTATION_PR_DISPATCH_ACTION } from "../shared/immutable-set";
import { reason } from "../shared/reason";
import { execClaude, runStage, type StageExec } from "../shared/stage";
import { structuredOutput } from "../shared/structured-output";
import { normalizeNewlines, sectionText } from "../shared/ticket-shape";
import { extractCriteria } from "../acceptance/acceptance";
import { runVitestJson, type TestRunResult } from "../acceptance/push-gate";
import { recordOutOfBrief } from "./out-of-brief";

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
 * The `repository_dispatch` action `implement.yml`'s job gates on — sent by
 * `to-tickets.yml`'s publish step for every slice with zero unresolved
 * blocked-by edges. Spelled here as the one authority `implement.yml`'s `if:`
 * and `implement-workflow.test.ts` both check against, since no compiler sees
 * across the JS↔YAML boundary (the same pattern `SPEC_DISPATCH_EVENT_TYPE`
 * and `AUDIT_DISPATCH_ACTION` follow). **Not yet sent by anything** — wiring
 * the publish step to send it belongs to whichever ticket owns
 * `to-tickets/slice-and-publish.ts`, not this one's claimed files. This file
 * only has to get the receiving side right and provable, the same way
 * `spec.yml` shipped its trigger ahead of a runnable stage dispatch.
 */
export const IMPLEMENT_DISPATCH_EVENT_TYPE = "ticket-ready";

/**
 * The `repository_dispatch` action this lane sends on success, naming the PR
 * it just opened — the implementer's own verification dispatch (ADR-0054:
 * "an implementation PR's checks fire by repository_dispatch").
 *
 * Re-exported from `shared/immutable-set.ts` rather than declared here,
 * because the three jobs that receive it — `verify.yml`'s Immutability and
 * Restore-and-run-acceptance, and `integrate.yml` — must read the same
 * string this sends, and `shared/` is the only place all four can reach
 * without a lane importing a lane. Declaring it twice is what left both of
 * `verify.yml`'s jobs unreachable until #145's seam audit.
 */
export const VERIFY_DISPATCH_EVENT_TYPE = IMPLEMENTATION_PR_DISPATCH_ACTION;

/** One `## Parent PRD\n#<n>` heading, as `shared/render-body.ts` writes it. */
const PARENT_PRD_RE = /^##[ \t]+Parent PRD[ \t]*\n#(\d+)/m;

/** `render-body.ts`'s `## Seams consumed` heading — present only when the slice consumed any. */
const SEAMS_HEADING_RE = /^##[ \t]+Seams consumed[ \t]*$/m;

/** `render-body.ts`'s `## Files claimed` heading — always present on a published ticket. */
const FILES_HEADING_RE = /^##[ \t]+Files claimed[ \t]*$/m;

const FILE_ITEM_RE = /^[ \t]*-[ \t]*(.+?)[ \t]*$/;

export interface TicketRead {
  title: string;
  body: string;
}

/** Reads a ticket's title and body through `gh` — one of two `GhExec` reads this lane makes. */
export function readTicket(gh: GhExec, issueNumber: number): TicketRead {
  const raw = gh(["issue", "view", String(issueNumber), "--json", "title,body"]);
  return JSON.parse(raw) as TicketRead;
}

/** The parent PRD's issue number, or `undefined` when the body carries none. */
export function parentPrdNumber(body: string): number | undefined {
  const match = PARENT_PRD_RE.exec(normalizeNewlines(body));
  return match ? Number(match[1]) : undefined;
}

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
 * The repo-relative paths a ticket's `## Files claimed` section names, one
 * per `- ` bullet, in the body's own order. `render-body.ts` writes
 * `- None — no files.` for an empty claim, which this filters out rather
 * than returning as a path — nothing on disk is named "None".
 */
export function extractFilesClaimed(body: string): string[] {
  const section = sectionText(normalizeNewlines(body), FILES_HEADING_RE);
  const paths: string[] = [];
  for (const line of section.split("\n")) {
    const match = FILE_ITEM_RE.exec(line);
    if (!match) continue;
    const path = match[1].trim();
    if (path.length > 0 && path !== "None — no files.") paths.push(path);
  }
  return paths;
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

const ImplementerAnswer = z.object({
  files: z.array(z.object({ path: z.string().min(1), content: z.string().min(1) })).min(1),
  /** A short account of what was built — becomes the PR body's lead paragraph. */
  summary: z.string().min(1),
  /**
   * Every module this implementer read outside its brief — ADR-0042: it
   * reads what it needs and carries on, never blocking, and names each
   * module here rather than filing a `seam/question`. One entry per read,
   * in read order; the same module named twice is two reads, not one — each
   * becomes its own call to `recordOutOfBrief`, so a module read twice is
   * counted twice on the tracker.
   */
  outOfBriefReads: z.array(z.string().min(1)).default([]),
});
type ImplementerAnswer = z.infer<typeof ImplementerAnswer>;

/** The implementer stage's structured-output contract (`shared/structured-output.ts`). */
export const IMPLEMENTER_OUTPUT = structuredOutput(ImplementerAnswer);

/** Runs the implementer stage against an already-assembled brief and returns its answer, unwritten. */
export function runImplementer(exec: StageExec, brief: string): Promise<ImplementerAnswer> {
  return runStage(IMPLEMENTER_PROMPT_PATH, { BRIEF: brief }, exec, IMPLEMENTER_OUTPUT, {
    model: IMPLEMENTER_MODEL,
    promptViaStdin: true,
  });
}

function fsWriteFile(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
}

/** The branch a ticket's implementation lands on. */
export function implementationBranch(issueNumber: number): string {
  return `implement/issue-${issueNumber}`;
}

/**
 * Commits the stage's written files to a fresh branch and pushes it — the
 * same add-commit-push shape `push-gate.ts`'s `commitAndPush` uses, minus
 * the rebase-onto-main step: this lands on its own branch for a PR to
 * review, never straight onto `main`.
 */
function commitAndPushBranch(git: GitExec, branch: string, paths: string[], commitMessage: string): void {
  git(["checkout", "-b", branch]);
  git(["add", ...paths]);
  git(["commit", "-m", commitMessage]);
  git(["push", "origin", `HEAD:${branch}`]);
}

/** What `openPrAndDispatch` opens a PR for and then tells the verification lane about. */
export interface PrDispatch {
  branch: string;
  title: string;
  body: string;
  /**
   * Every path this implementer wrote, exactly as `commitAndPushBranch` staged
   * them. The Immutability job reads this and **refuses an empty one** — an
   * implementer that sends no file list is a broken guarantee, not "nothing to
   * check" — so this is never allowed to be omitted or defaulted.
   */
  changedFiles: string[];
  /**
   * This slice's acceptance criteria, verbatim, as `extractCriteria` lifts
   * them from the ticket body. The Restore-and-run-acceptance job greps
   * trunk's `tests/acceptance/` for these (ADR-0033's verbatim match,
   * `shared/affected-tests.ts`) to scope its run to this slice alone.
   */
  criteria: string[];
}

/**
 * Opens exactly one PR for the branch just pushed, then sends exactly one
 * `VERIFY_DISPATCH_EVENT_TYPE` dispatch naming that PR — in that order, the
 * same order `applyGate` (`spec/open-questions.ts`) keeps for its own
 * label-then-dispatch write, so a dispatch that never sends still leaves the
 * PR as a durable trace rather than a silent stop.
 *
 * The payload carries three fields because trunk's `verify.yml` reads three:
 * `pr` for lane 08 to merge, `changed_files` for the Immutability job, and
 * `criteria` for the Restore-and-run-acceptance job. It carried only `pr`
 * until #145's seam audit, which meant that even once the action names were
 * reconciled, Immutability would have refused every PR on a missing file list
 * and the acceptance job would have found no test to run. A dispatch that
 * satisfies its receivers is the whole point of sending one.
 *
 * `changed_files` is comma-joined rather than sent as an array because the
 * Immutability job is deliberately a shell string-compare with no checkout and
 * no Node (`verify.yml`), and it splits on `,`. `criteria` is sent as a real
 * array — `gh api`'s `key[]=` repetition — because that job reads it through
 * `toJson()` and parses it as JSON.
 */
export function openPrAndDispatch(gh: GhExec, dispatch: PrDispatch): string {
  const prUrl = gh([
    "pr",
    "create",
    "--title",
    dispatch.title,
    "--body",
    dispatch.body,
    "--head",
    dispatch.branch,
  ]).trim();

  gh([
    "api",
    "repos/{owner}/{repo}/dispatches",
    "-f",
    `event_type=${VERIFY_DISPATCH_EVENT_TYPE}`,
    "-f",
    `client_payload[pr]=${prUrl}`,
    "-f",
    `client_payload[changed_files]=${dispatch.changedFiles.join(",")}`,
    ...dispatch.criteria.flatMap((criterion) => ["-f", `client_payload[criteria][]=${criterion}`]),
  ]);
  return prUrl;
}

export interface ImplementDeps {
  gh: GhExec;
  exec: StageExec;
  git: GitExec;
  readFile: (path: string) => string;
  fileExists: (path: string) => boolean;
  writeFile: (path: string, content: string) => void;
  issueNumber: number;
  /**
   * The failing acceptance test file(s) for this slice, already resolved —
   * pre-fetched the same way `acceptance.ts`'s `AuthorDeps.ticket` is,
   * rather than this function reaching into the filesystem or a test runner
   * itself.
   */
  failingTests: FailingTestFile[];
}

/**
 * The whole implement flow, end to end: read the ticket, assemble its brief
 * from exactly the four ingredients #167 names, run the implementer stage,
 * write what it returns, commit and push a branch, then open exactly one PR
 * and send exactly one verification dispatch naming it.
 */
export async function runImplement(deps: ImplementDeps): Promise<string> {
  const ticket = readTicket(deps.gh, deps.issueNumber);
  const seamManifestLines = extractSeamsConsumed(ticket.body);
  const filesClaimed = extractFilesClaimed(ticket.body);
  const contextPath = moduleContextPath(filesClaimed, deps.fileExists);
  const moduleContext = deps.readFile(contextPath);

  const brief = assembleBrief({
    ticketBody: ticket.body,
    seamManifestLines,
    moduleContext,
    failingTests: deps.failingTests,
  });

  const answer = await runImplementer(deps.exec, brief);

  // Non-blocking (ADR-0042): every out-of-brief read the implementer reports is recorded on the
  // standing tracker issue and nothing else — never a `dependencies/blocked_by` write, never a
  // pause. The dependency graph stays lane 03's alone (ADR-0069).
  for (const module of answer.outOfBriefReads) {
    recordOutOfBrief(deps.gh, module);
  }

  for (const file of answer.files) {
    deps.writeFile(file.path, file.content);
  }

  const branch = implementationBranch(deps.issueNumber);
  const paths = answer.files.map((file) => file.path);
  commitAndPushBranch(
    deps.git,
    branch,
    paths,
    `Implement #${deps.issueNumber}\n\n${answer.summary}\n\nPart of #${deps.issueNumber}`,
  );

  return openPrAndDispatch(deps.gh, {
    branch,
    title: ticket.title,
    body: `${answer.summary}\n\nCloses #${deps.issueNumber}`,
    // The same `paths` just staged and pushed — the implementer's own report of what it wrote,
    // not a `git diff` re-read, so the list the Immutability job judges is the list this lane
    // committed.
    changedFiles: paths,
    criteria: extractCriteria(ticket.body),
  });
}

/**
 * Every failing acceptance test file for `issueNumber`, read from disk —
 * `push-gate.ts`'s own `TestRunResult` shape, reused rather than
 * re-classified, since "which test failed" is exactly what it already
 * reports. Real production behaviour for `main()`; `runImplement` above
 * never calls this itself, so a test exercising the brief-assembly or
 * PR-and-dispatch criteria never has to run a real suite.
 */
export function findFailingTestFiles(
  dir: string,
  readFile: (path: string) => string,
  runTests: () => TestRunResult = () => runVitestJson(dir),
): FailingTestFile[] {
  const result = runTests();
  if (!result.collected) {
    throw new Error(`acceptance suite under ${dir} did not collect: ${result.collectionError ?? "no detail reported"}`);
  }
  const paths = [...new Set(result.failures.map((failure) => failure.name.split(" > ")[0]))];
  return paths
    .filter((path) => existsSync(path))
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
  try {
    const prUrl = await runImplement({
      gh: execGh,
      exec: execClaude,
      git: execGit,
      readFile: (path) => readFileSync(path, "utf8"),
      fileExists: (path) => existsSync(path),
      writeFile: fsWriteFile,
      issueNumber,
      failingTests: findFailingTestFiles("tests/acceptance/", (path) => readFileSync(path, "utf8")),
    });
    console.log(`opened ${prUrl}`);
  } catch (err) {
    console.error(`implement failed: ${reason(err)}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
