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

export const AUTHOR_MODEL = "claude-opus-5";

export const AUTHOR_PROMPT_PATH = ".Workflow/agent-workflows/acceptance/author/prompt.md";

const FAILS_CALL = /\b(?:test|it)\.fails\(/;

const REPO_DIR = process.env.TARGET_WORKSPACE || process.cwd();

const AuthoredFile = z.object({
  path: z.string().min(1),
  content: z.string().min(1),
});
export type AuthoredFile = z.infer<typeof AuthoredFile>;

const AuthorAnswer = z.object({
  files: z.array(AuthoredFile).min(1),
});
type AuthorAnswer = z.infer<typeof AuthorAnswer>;

export const AUTHOR_OUTPUT = structuredOutput(AuthorAnswer);

export interface AuthorDeps {
  exec: StageExec;
  writeFile: (path: string, content: string) => void;
  issueNumber: number;
  ticket: TicketRead;
  prdBody?: string;
  readFile?: (path: string) => string | undefined;
}

export const CLAIMED_FILE_ABSENT = "(does not exist yet; this ticket creates it)";

export const NO_CLAIMED_FILES = "(this ticket claims no files)";

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

export function renderCriteria(criteria: string[]): string {
  return criteria
    .map((criterion, index) => `### Criterion ${index + 1}\n\n~~~\n${criterion}\n~~~`)
    .join("\n\n");
}

function readIfPresent(path: string): string | undefined {
  try {
    return readFileSync(join(REPO_DIR, path), "utf8");
  } catch {
    return undefined;
  }
}

function underSuiteRoot(path: string): boolean {
  return SUITE_ROOTS.some((root) => path.startsWith(`${root}/`));
}

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
  runTests: (paths: string[]) => TestRunResult;
  lint: (paths: string[]) => string | null;
  git: GitExec;
  paths: string[];
  commitMessage: string;
  landing: Landing;
}

export type LandOutcome = { verdict: "pushed" } | { verdict: "refused"; reason: string };

export type Landing = "push" | "commit";

export function landingFromEnv(env: NodeJS.ProcessEnv = process.env): Landing {
  return env.ACCEPTANCE_LANDING === "commit" ? "commit" : "push";
}

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
        `${result.failures.length} test(s) are red under test.fails, which means they already pass: ` +
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

function readSliceNumbers(gh: GhExec, prdNumber: number): number[] {
  const raw = gh(["api", subIssuesPath(prdNumber)]);
  const issues = JSON.parse(raw) as Array<{ number: number }>;
  return issues.map((issue) => issue.number);
}

export interface RefireDeps {
  gh: GhExec;
  prdNumber: number;
  authorForSlice: (sliceNumber: number) => void | Promise<void>;
  root?: string;
}

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

function authorCommitMessage(issueNumber: number, paths: string[]): string {
  return `Author acceptance tests for #${issueNumber} from the spec alone

Nobody has implemented #${issueNumber} yet, so every test here is test.fails, green until the
work lands, and the implementer turns each on by dropping .fails from its line (#360).
${paths.map((path) => `- ${path}`).join("\n")}

Part of #162`;
}

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
