import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import {
  affectedSlices,
  authoredCriterionTitleRe,
  SUITE_ROOTS,
  testsForCriterion,
  type ExistingTestCriterion,
  type SliceRef,
} from "../shared/affected-tests";
import { execGh, type GhExec } from "../shared/gh";
import { subIssuesPath } from "../shared/gh-paths";
import { execGit, type GitExec } from "../shared/git";
import { sayOnTicket } from "../shared/implementation-landing";
import { escalateToOwner } from "../shared/needs-human";
import { reason } from "../shared/reason";
import { gateOutputTail, gateVerdict, type GateVerdict } from "../shared/run-gauntlet";
import { execClaudeIn, runStageSession, type StageExec, type StageSessionResult } from "../shared/stage";
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

export const AUTHOR_REPAIR_PROMPT_PATH = ".Workflow/agent-workflows/acceptance/author/repair.md";

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

export interface AuthoredBatch {
  files: AuthoredFile[];
  sessionId?: string;
}

export async function authorAcceptanceTests(deps: AuthorDeps): Promise<AuthoredBatch> {
  const criteria = extractCriteria(deps.ticket.body);
  if (criteria.length === 0) {
    throw new Error(
      `issue #${deps.issueNumber} declares no acceptance criteria under ${CRITERIA_HEADING_RE.source}`,
    );
  }

  const round = await runStageSession(
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
  return acceptRound(deps, criteria, round);
}

export async function repairAcceptanceTests(deps: AuthorDeps, sessionId: string, judgement: string): Promise<AuthoredBatch> {
  const criteria = extractCriteria(deps.ticket.body);
  const round = await runStageSession(
    AUTHOR_REPAIR_PROMPT_PATH,
    {
      ISSUE_NUMBER: String(deps.issueNumber),
      CRITERIA_COUNT: String(criteria.length),
      JUDGEMENT: gateOutputTail(judgement),
    },
    deps.exec,
    AUTHOR_OUTPUT,
    { model: AUTHOR_MODEL, promptViaStdin: true, resume: sessionId, stage: "author-repair" },
  );
  return acceptRound(deps, criteria, round);
}

function acceptRound(deps: AuthorDeps, criteria: string[], round: StageSessionResult<AuthorAnswer>): AuthoredBatch {
  const answer = round.value;
  for (const file of answer.files) {
    if (!underSuiteRoot(file.path)) {
      throw new Error(`author wrote outside ${SUITE_ROOTS.join("/, ")}/: ${file.path}`);
    }
  }
  if (!answer.files.some((file) => file.path.endsWith(".test.ts"))) {
    throw new Error(`author wrote no test file for #${deps.issueNumber}`);
  }

  const combined = answer.files.map((file) => file.content).join("\n");
  const missing = criteria
    .map((_criterion, i) => i + 1)
    .filter((index) => !authoredCriterionTitleRe(deps.issueNumber, index).test(combined));
  if (missing.length > 0) {
    throw new Error(
      `author wrote no test.fails( naming #${deps.issueNumber}.${missing.join(`, #${deps.issueNumber}.`)}: ` +
        `missing criteri${missing.length === 1 ? "on" : "a"} ${missing.join(", ")} of ${criteria.length}`,
    );
  }

  for (const file of answer.files) deps.writeFile(file.path, file.content);
  return { files: answer.files, sessionId: round.sessionId };
}

export interface JudgeDeps {
  runTests: (paths: string[]) => TestRunResult;
  gate: () => GateVerdict;
}

export type BatchVerdict = { ok: true } | { ok: false; reason: string };

export function judgeAuthoredBatch(deps: JudgeDeps, paths: string[]): BatchVerdict {
  const tests = paths.filter((path) => path.endsWith(".test.ts"));
  const result = deps.runTests(tests);
  if (!result.collected) {
    return { ok: false, reason: `a test file failed to collect: ${result.collectionError ?? "no detail reported"}` };
  }
  if (result.failures.length > 0) {
    const names = result.failures.map((failure) => failure.name).join(", ");
    return {
      ok: false,
      reason:
        `${result.failures.length} test(s) are red under test.fails, which means they already pass: ` +
        `a vacuous test or one about work already done: ${names}`,
    };
  }
  const gate = deps.gate();
  return gate.ok ? { ok: true } : { ok: false, reason: `the gate is red on the authored batch:\n${gate.output}` };
}

export type LandOutcome = { verdict: "pushed" } | { verdict: "refused"; reason: string };

export type Landing = "push" | "commit";

export function landingFromEnv(env: NodeJS.ProcessEnv = process.env): Landing {
  return env.ACCEPTANCE_LANDING === "commit" ? "commit" : "push";
}

export interface CommitDeps {
  git: GitExec;
  paths: string[];
  commitMessage: string;
  landing: Landing;
}

export function commitAuthoredBatch(deps: CommitDeps): void {
  deps.git(["add", ...deps.paths]);
  deps.git(["commit", "-m", deps.commitMessage]);
  if (deps.landing === "push") {
    deps.git(["fetch", "origin", "main"]);
    deps.git(["rebase", "origin/main"]);
    deps.git(["push", "origin", "HEAD:main"]);
  }
}

export function authorRedNote(judgement: string): string {
  return [
    "The acceptance author's batch was still red after its one repair round, so nothing landed and this ticket is waiting on a human.",
    "",
    "```",
    gateOutputTail(judgement),
    "```",
  ].join("\n");
}

function authorDiedNote(why: string): string {
  return `The acceptance author died before landing anything, so this ticket is waiting on a human: ${why}`;
}

function haltLoudly(gh: GhExec, issueNumber: number, note: string, log: (line: string) => void): void {
  escalateToOwner(gh, issueNumber, process.env.GITHUB_REPOSITORY_OWNER);
  sayOnTicket(gh, issueNumber, note, log);
}

type Attempt = { ok: true; paths: string[] } | { ok: false; reason: string };

function batchPaths(batch: AuthoredBatch): string[] {
  return batch.files.map((file) => file.path);
}

async function authorWithOneRepair(deps: AuthorDeps, judge: JudgeDeps): Promise<Attempt> {
  const first = await authorAcceptanceTests(deps);
  const verdict = judgeAuthoredBatch(judge, batchPaths(first));
  if (verdict.ok) return { ok: true, paths: batchPaths(first) };
  if (first.sessionId === undefined) return { ok: false, reason: verdict.reason };

  const repaired = await repairAcceptanceTests(deps, first.sessionId, verdict.reason);
  const again = judgeAuthoredBatch(judge, batchPaths(repaired));
  return again.ok ? { ok: true, paths: batchPaths(repaired) } : { ok: false, reason: again.reason };
}

export interface RunAcceptanceDeps {
  gh: GhExec;
  exec: StageExec;
  writeFile: (path: string, content: string) => void;
  issueNumber: number;
  runTests?: (paths: string[]) => TestRunResult;
  gate?: () => GateVerdict;
  git?: GitExec;
  landing?: Landing;
  log?: (line: string) => void;
}

export async function runAcceptanceAuthor(deps: RunAcceptanceDeps): Promise<LandOutcome> {
  const ticket = readTicket(deps.gh, deps.issueNumber);
  const prdNumber = parentPrdNumber(ticket.body);
  const prd = prdNumber === undefined ? undefined : readTicket(deps.gh, prdNumber);
  const log = deps.log ?? ((line: string) => console.log(line));

  const attempt = await authorWithOneRepair(
    { exec: deps.exec, writeFile: deps.writeFile, issueNumber: deps.issueNumber, ticket, prdBody: prd?.body },
    {
      runTests: deps.runTests ?? ((tests) => runVitestJson(tests.join(" "), REPO_DIR)),
      gate: deps.gate ?? (() => gateVerdict(REPO_DIR)),
    },
  );
  if (!attempt.ok) {
    haltLoudly(deps.gh, deps.issueNumber, authorRedNote(attempt.reason), log);
    return { verdict: "refused", reason: attempt.reason };
  }

  commitAuthoredBatch({
    git: deps.git ?? ((args) => execGit(["-C", REPO_DIR, ...args])),
    paths: attempt.paths,
    commitMessage: authorCommitMessage(deps.issueNumber, attempt.paths),
    landing: deps.landing ?? "push",
  });
  return { verdict: "pushed" };
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
    extractCriteria(slice.body).forEach((criterion, i) => {
      if (testsForCriterion(sliceNumber, i + 1, deps.root).length > 0) existingTests.push({ sliceNumber, criterion });
    });
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

async function authorInProcess(issueNumber: number): Promise<LandOutcome> {
  try {
    return await runAcceptanceAuthor({
      gh: execGh,
      exec: execClaudeIn(REPO_DIR),
      writeFile: fsWriteFile,
      issueNumber,
      landing: landingFromEnv(),
    });
  } catch (err) {
    haltLoudly(execGh, issueNumber, authorDiedNote(reason(err)), console.error);
    throw err;
  }
}

async function authorForSliceInProcess(sliceNumber: number): Promise<void> {
  const outcome = await authorInProcess(sliceNumber);
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
    const outcome = await authorInProcess(Number(issueArg));
    if (outcome.verdict === "refused") {
      console.error(`refused: ${outcome.reason}`);
      process.exitCode = 1;
      return;
    }
    console.log(landingFromEnv() === "commit" ? "committed" : "pushed");
  } catch (err) {
    console.error(`acceptance authoring failed: ${reason(err)}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
