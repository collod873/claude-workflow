import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { affectedSlices, SUITE_ROOTS, testsForCriteria, type ExistingTestCriterion, type SliceRef } from "../shared/affected-tests";
import { childEnv } from "../shared/child-env";
import { execGh, type GhExec } from "../shared/gh";
import { subIssuesPath } from "../shared/gh-paths";
import { execGit, type GitExec } from "../shared/git";
import { reason } from "../shared/reason";
import { execClaudeIn, runStage, type StageExec } from "../shared/stage";
import { structuredOutput } from "../shared/structured-output";
import {
  CRITERIA_HEADING_RE,
  extractCriteria,
  extractFilesClaimed,
  parentPrdNumber,
  readTicket,
  type TicketRead,
} from "../shared/ticket-shape";
import { runVitestJson, type TestRunResult } from "../shared/vitest-json";

/**
 * Lane: author acceptance tests from the spec alone.
 *
 * One Opus stage (§3: being subtly wrong here is expensive and invisible — a criterion the author
 * silently drops is a hole nobody sees until the ticket that was supposed to close it turns out
 * not to) reads a ticket's `## Acceptance criteria` and its parent PRD, and writes one
 * `test.fails(` per criterion **beside the subject it exercises**, plus a stub entry point when
 * the subject does not exist yet (#360). The batch lands on `main` green: under `test.fails` a
 * test whose assertion does not hold is green, and one that already passes is red — which is the
 * whole gate. The implementer turns a test on by dropping `.fails` from its line and nothing
 * else (`fails-rule.ts`), and `bin/close-ticket` refuses a ticket a surviving `test.fails(` still
 * names.
 *
 * The author never opens a pull request — `authorAcceptanceTests` touches only `StageExec` and
 * the filesystem, and the one `GhExec` call this lane makes is a read (`issue view`). Landing is
 * `landAuthoredBatch`'s job, straight onto `main`.
 */

/** §3: authoring a test from the spec alone is exactly the low-volume, high-consequence case. */
export const AUTHOR_MODEL = "claude-opus-5";

export const AUTHOR_PROMPT_PATH = ".Workflow/agent-workflows/acceptance/author/prompt.md";

/** A `test.fails(` / `it.fails(` opener — the marker every authored test must carry. */
const FAILS_CALL = /\b(?:test|it)\.fails\(/;

/**
 * `TARGET_WORKSPACE` is set only by the reusable workflow (#315, ADR-0055): the machine checkout
 * this script runs from is a different directory than the target checkout its tests are written
 * into, its eslint/vitest spawns judge, and its git commit lands in. Falling back to `process.cwd()`
 * is what lets a local run hand in a different one without needing to run from inside it too.
 */
const REPO_DIR = process.env.TARGET_WORKSPACE || process.cwd();

const AuthoredFile = z.object({
  /** Repo-relative, under one of `SUITE_ROOTS`. */
  path: z.string().min(1),
  content: z.string().min(1),
});
/** One file the author wrote. Returned as well as written, so the gate judges the answer itself. */
export type AuthoredFile = z.infer<typeof AuthoredFile>;

const AuthorAnswer = z.object({
  files: z.array(AuthoredFile).min(1),
});
type AuthorAnswer = z.infer<typeof AuthorAnswer>;

/** The author's structured-output contract (`shared/structured-output.ts`). */
export const AUTHOR_OUTPUT = structuredOutput(AuthorAnswer);

export interface AuthorDeps {
  exec: StageExec;
  writeFile: (path: string, content: string) => void;
  issueNumber: number;
  ticket: TicketRead;
  /** The parent PRD's body, when the ticket names one — the other half of "from the spec alone". */
  prdBody?: string;
  /**
   * Reads one repo-relative file, `undefined` when it does not exist yet — the ordinary case for a
   * slice whose whole job is to create the file it claims. Defaults to a real filesystem read.
   */
  readFile?: (path: string) => string | undefined;
}

/** What a file that does not exist yet is shown as. */
export const CLAIMED_FILE_ABSENT = "(does not exist yet — this ticket creates it)";

/** Shown in place of the section when the ticket claims no files at all. */
export const NO_CLAIMED_FILES = "(this ticket claims no files)";

/**
 * A set of files rendered as the files themselves rather than as a list of paths
 * ([ADR-0098](../../../docs/adr/0098-the-acceptance-author-is-shown-the-files-its-ticket-claims-r.md)):
 * put the file's real text in front of the model instead of its name, so it matches the shape of
 * what it asserts against — an export's real signature, a config key that is quoted. Uncapped,
 * deliberately: a truncated file is the half-seen state this exists to remove, and the bound is
 * the slice's own claim, which lane 03 already sizes to one session.
 */
export function renderFiles(
  paths: string[],
  readFile: (path: string) => string | undefined,
  whenEmpty: string,
): string {
  if (paths.length === 0) return whenEmpty;
  return paths
    .map((path) => {
      const content = readFile(path);
      if (content === undefined) return `### ${path}\n\n${CLAIMED_FILE_ABSENT}`;
      return `### ${path}\n\n\`\`\`\n${content}\n\`\`\``;
    })
    .join("\n\n");
}

/**
 * The ticket's criteria as the author is shown them: numbered, one per tilde-fenced block, each
 * the exact string `extractCriteria` lifted. The criterion string is not prose the author
 * paraphrases — it is an identifier: `testsForCriteria` is a literal `String.includes` over test
 * source, and a test whose copy differs by one character selects nothing
 * ([ADR-0128](../../../docs/adr/0128-the-acceptance-author-is-handed-its-criteria-as-extracted-an.md)).
 * Tilde fences rather than backticks: a criterion may carry backticks of its own.
 */
export function renderCriteria(criteria: string[]): string {
  return criteria
    .map((criterion, index) => `### Criterion ${index + 1}\n\n~~~\n${criterion}\n~~~`)
    .join("\n\n");
}

/** `readFile`'s default: the file's text, or `undefined` when it is not there yet. */
function readIfPresent(path: string): string | undefined {
  try {
    return readFileSync(join(REPO_DIR, path), "utf8");
  } catch {
    return undefined;
  }
}

/** Whether `path` sits inside one of the trees the suite collects. */
function underSuiteRoot(path: string): boolean {
  return SUITE_ROOTS.some((root) => path.startsWith(`${root}/`));
}

/**
 * Runs the author stage and writes what it returns, returning the files (in the order the model
 * listed them). Throws — without writing anything — when the ticket declares no acceptance
 * criteria, when the model names a path outside the suite's trees (a test written wherever the
 * model felt like never runs), or when a test file it wrote carries no `test.fails(` naming this
 * ticket (a test with no marker is one the implementer cannot turn on and `bin/close-ticket`
 * cannot see).
 */
export async function authorAcceptanceTests(deps: AuthorDeps): Promise<AuthoredFile[]> {
  const criteria = extractCriteria(deps.ticket.body);
  if (criteria.length === 0) {
    throw new Error(
      `issue #${deps.issueNumber} declares no acceptance criteria under ${CRITERIA_HEADING_RE.source}`,
    );
  }

  const answer = await runStage(
    AUTHOR_PROMPT_PATH,
    {
      ISSUE_NUMBER: String(deps.issueNumber),
      ISSUE_TITLE: deps.ticket.title,
      ISSUE_BODY: deps.ticket.body,
      PRD_BODY: deps.prdBody ?? "(no parent PRD)",
      CRITERIA: renderCriteria(criteria),
      CRITERIA_COUNT: String(criteria.length),
      CLAIMED_FILES: renderFiles(extractFilesClaimed(deps.ticket.body), deps.readFile ?? readIfPresent, NO_CLAIMED_FILES),
    },
    deps.exec,
    AUTHOR_OUTPUT,
    { model: AUTHOR_MODEL, promptViaStdin: true, stage: "author" },
  );

  const marker = new RegExp(`${FAILS_CALL.source}[^\\n]*#${deps.issueNumber}\\b`);
  for (const file of answer.files) {
    if (!underSuiteRoot(file.path)) {
      throw new Error(`author wrote outside ${SUITE_ROOTS.join("/, ")}/: ${file.path}`);
    }
    if (file.path.endsWith(".test.ts") && !marker.test(file.content)) {
      throw new Error(`author wrote a test with no test.fails( naming #${deps.issueNumber}: ${file.path}`);
    }
  }
  if (!answer.files.some((file) => file.path.endsWith(".test.ts"))) {
    throw new Error(`author wrote no test file for #${deps.issueNumber}`);
  }

  for (const file of answer.files) deps.writeFile(file.path, file.content);
  return answer.files;
}

export interface LandDeps {
  /** Runs the authored test files and classifies the result. Defaults to a real vitest run over them. */
  runTests: (paths: string[]) => TestRunResult;
  /** Lints the authored paths, returning the report when it found something and `null` when clean. */
  lint: (paths: string[]) => string | null;
  git: GitExec;
  /** Every file this run is landing, repo-relative — tests and stub entry points alike. */
  paths: string[];
  /** CLAUDE.md: explains why, not what — the caller's to write. */
  commitMessage: string;
  /** `"commit"` when a `contents: write` job does the push (ADR-0091); `"push"` otherwise. */
  landing: Landing;
}

export type LandOutcome = { verdict: "pushed" } | { verdict: "refused"; reason: string };

/**
 * Where a commit this gate clears actually lands. ADR-0091: a job that spends a model holds
 * `contents: read`, so it cannot push; `acceptance.yml`'s model job commits and its `land` job
 * pushes. `ACCEPTANCE_LANDING=commit` selects that split; `"push"` is the workstation default.
 */
export type Landing = "push" | "commit";

export function landingFromEnv(env: NodeJS.ProcessEnv = process.env): Landing {
  return env.ACCEPTANCE_LANDING === "commit" ? "commit" : "push";
}

/**
 * The gate a freshly authored batch has to clear before it is trusted with a commit on `main` —
 * no PR, no review, because a model wrote it from the spec alone. Two questions, both answered by
 * running the batch: did every file collect (a typo'd import proves nothing about the subject),
 * and is every test green under its `test.fails` (a red one is a test that already passes, which
 * is vacuous or about work already done). Then lint, because lane 04 lands with no review and this
 * is the only venue that can refuse a file the repo cannot accept ([ADR-0102](../../../docs/adr/0102-a-lint-rule-that-points-at-an-import-the-boundary-forbids-do.md)).
 * Refuses before any git call, so a refused run leaves `main` untouched.
 */
export function landAuthoredBatch(deps: LandDeps): LandOutcome {
  const tests = deps.paths.filter((path) => path.endsWith(".test.ts"));
  const result = deps.runTests(tests);
  if (!result.collected) {
    return { verdict: "refused", reason: `a test file failed to collect: ${result.collectionError ?? "no detail reported"}` };
  }
  if (result.failures.length > 0) {
    const names = result.failures.map((failure) => failure.name).join(", ");
    return {
      verdict: "refused",
      reason:
        `${result.failures.length} test(s) are red under test.fails, which means they already pass — ` +
        `a vacuous test or one about work already done: ${names}`,
    };
  }
  const lintReport = deps.lint(deps.paths);
  if (lintReport !== null) {
    return { verdict: "refused", reason: `the authored files do not lint:\n${lintReport}` };
  }

  deps.git(["add", ...deps.paths]);
  deps.git(["commit", "-m", deps.commitMessage]);
  if (deps.landing === "push") {
    deps.git(["fetch", "origin", "main"]);
    deps.git(["rebase", "origin/main"]);
    deps.git(["push", "origin", "HEAD:main"]);
  }
  return { verdict: "pushed" };
}

/**
 * The real `lint`: the repo's own eslint over exactly the paths being landed — this gate answers
 * "may *these* files land", and a pre-existing finding elsewhere is not this batch's to be refused
 * for. eslint exits non-zero on any finding, so the report is read off the caught error.
 */
export function runEslint(paths: string[], repoDir: string = process.cwd()): string | null {
  if (paths.length === 0) return null;
  try {
    execFileSync("npx", ["eslint", ...paths], { cwd: repoDir, encoding: "utf8", maxBuffer: 10 * 1024 * 1024, env: childEnv() });
    return null;
  } catch (err) {
    const output = (err as { stdout?: string }).stdout;
    return typeof output === "string" && output.trim() !== "" ? output.trim() : reason(err);
  }
}

export interface RunAcceptanceDeps {
  gh: GhExec;
  exec: StageExec;
  writeFile: (path: string, content: string) => void;
  issueNumber: number;
  runTests?: (paths: string[]) => TestRunResult;
  lint?: (paths: string[]) => string | null;
  git?: GitExec;
  landing?: Landing;
}

/**
 * The whole authoring flow, end to end: read the ticket (and its parent PRD, when it names one),
 * author the tests, and hand what was written to the gate. Never opens a PR — `readTicket` is the
 * only `GhExec` call anywhere in this function, and it is a read.
 */
export async function runAcceptanceAuthor(deps: RunAcceptanceDeps): Promise<LandOutcome> {
  const ticket = readTicket(deps.gh, deps.issueNumber);
  const prdNumber = parentPrdNumber(ticket.body);
  const prd = prdNumber === undefined ? undefined : readTicket(deps.gh, prdNumber);

  const files = await authorAcceptanceTests({
    exec: deps.exec,
    writeFile: deps.writeFile,
    issueNumber: deps.issueNumber,
    ticket,
    prdBody: prd?.body,
  });
  const paths = files.map((file) => file.path);

  return landAuthoredBatch({
    runTests: deps.runTests ?? ((tests) => runVitestJson(tests.join(" "), REPO_DIR)),
    lint: deps.lint ?? ((lintPaths) => runEslint(lintPaths, REPO_DIR)),
    git: deps.git ?? ((args) => execGit(["-C", REPO_DIR, ...args])),
    paths,
    commitMessage: authorCommitMessage(deps.issueNumber, paths),
    landing: deps.landing ?? "push",
  });
}

/** Every sub-issue number attached under `prdNumber` — a slice this spec was cut into. */
function readSliceNumbers(gh: GhExec, prdNumber: number): number[] {
  const raw = gh(["api", subIssuesPath(prdNumber)]);
  const issues = JSON.parse(raw) as Array<{ number: number }>;
  return issues.map((issue) => issue.number);
}

export interface RefireDeps {
  gh: GhExec;
  /** The spec issue that was just edited — a PRD, carrying `prd`. */
  prdNumber: number;
  /** Called once per affected slice, in ascending slice-number order — the re-fire itself. */
  authorForSlice: (sliceNumber: number) => void | Promise<void>;
  /** The checkout whose suite is searched for existing tests. Defaults to this repository. */
  root?: string;
}

/**
 * ADR-0033's re-entry trigger, end to end: read the edited spec and every slice it was cut into,
 * find which of each slice's own criteria an existing test already proves, hand that record to
 * `affectedSlices`, and call `deps.authorForSlice` once per slice it names.
 */
export async function refireAcceptance(deps: RefireDeps): Promise<SliceRef[]> {
  const prd = readTicket(deps.gh, deps.prdNumber);
  const sliceNumbers = readSliceNumbers(deps.gh, deps.prdNumber);

  const existingTests: ExistingTestCriterion[] = [];
  for (const sliceNumber of sliceNumbers) {
    const slice = readTicket(deps.gh, sliceNumber);
    for (const criterion of extractCriteria(slice.body)) {
      if (testsForCriteria([criterion], deps.root).length > 0) existingTests.push({ sliceNumber, criterion });
    }
  }

  const affected = affectedSlices(prd.body, existingTests);
  for (const { sliceNumber } of affected) await deps.authorForSlice(sliceNumber);
  return affected;
}

/** CLAUDE.md: why, not what. */
function authorCommitMessage(issueNumber: number, paths: string[]): string {
  return `Author acceptance tests for #${issueNumber} from the spec alone

Nobody has implemented #${issueNumber} yet, so every test here is test.fails — green until the
work lands, and the implementer turns each on by dropping .fails from its line (#360).
${paths.map((path) => `- ${path}`).join("\n")}

Part of #162`;
}

/** Resolved against `REPO_DIR`, like every other read/spawn in this file. */
function fsWriteFile(path: string, content: string): void {
  const resolved = join(REPO_DIR, path);
  mkdirSync(dirname(resolved), { recursive: true });
  writeFileSync(resolved, content, "utf8");
}

async function authorForSliceInProcess(sliceNumber: number): Promise<void> {
  const outcome = await runAcceptanceAuthor({
    gh: execGh,
    exec: execClaudeIn(REPO_DIR),
    writeFile: fsWriteFile,
    issueNumber: sliceNumber,
    landing: landingFromEnv(),
  });
  if (outcome.verdict === "refused") throw new Error(`refused for #${sliceNumber}: ${outcome.reason}`);
}

async function main(): Promise<void> {
  if (process.argv[2] === "--refire") {
    const prdArg = process.argv[3];
    if (!prdArg) {
      console.error("usage: acceptance.ts --refire <prd-issue-number>");
      process.exitCode = 1;
      return;
    }
    try {
      const affected = await refireAcceptance({ gh: execGh, prdNumber: Number(prdArg), authorForSlice: authorForSliceInProcess, root: REPO_DIR });
      console.log(
        affected.length === 0
          ? "no slice's test lost its criterion; nothing re-fired"
          : `re-fired acceptance for ${affected.length} slice(s): ${affected.map((s) => s.sliceNumber).join(", ")}`,
      );
    } catch (err) {
      console.error(`acceptance re-entry failed: ${reason(err)}`);
      process.exitCode = 1;
    }
    return;
  }

  const issueArg = process.argv[2];
  if (!issueArg) {
    console.error("usage: acceptance.ts <issue-number>");
    process.exitCode = 1;
    return;
  }
  try {
    const landing = landingFromEnv();
    const outcome = await runAcceptanceAuthor({
      gh: execGh,
      exec: execClaudeIn(REPO_DIR),
      writeFile: fsWriteFile,
      issueNumber: Number(issueArg),
      landing,
    });
    if (outcome.verdict === "refused") {
      console.error(`refused: ${outcome.reason}`);
      process.exitCode = 1;
      return;
    }
    console.log(landing === "commit" ? "committed" : "pushed");
  } catch (err) {
    console.error(`acceptance authoring failed: ${reason(err)}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
