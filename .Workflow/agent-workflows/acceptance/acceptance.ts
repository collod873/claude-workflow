import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { z } from "zod";
import {
  affectedSlices,
  authoredCriterionTitleRe,
  testsForCriterion,
  type ExistingTestCriterion,
  type SliceRef,
} from "../shared/affected-tests";
import { laneBudget } from "../shared/lane-budget";
import { execGh, issueComments, type GhExec } from "../shared/gh";
import { subIssuesPath } from "../shared/gh-paths";
import { execGit, type GitExec } from "../shared/git";
import { sayOnTicket } from "../shared/implementation-landing";
import { ACCEPTING_LABEL, markLane, QUEUED_LABEL } from "../shared/labels";
import { reason } from "../shared/reason";
import { dispatchTicketReady, FRESH_EYES_RUNG, implementationBranch } from "../shared/ready-set";
import { strikesIn } from "../shared/strikes";
import { gateOutputTail, stopVenueVerdict, type GateVerdict } from "../shared/run-gauntlet";
import {
  currentLaneRun,
  execClaudeIn,
  runStageSessionWithinBudget,
  startLaneBudget,
  type LaneBudget,
  type StageExec,
  type StageSessionResult,
} from "../shared/stage";
import { structuredOutput } from "../shared/structured-output";
import { suiteLayout, type SuiteLayout } from "../shared/suite-layout";
import {
  CRITERIA_HEADING_RE,
  extractCriteria,
  extractFilesClaimed,
  parentPrdNumber,
  readTicket,
  type TicketRead,
} from "../shared/ticket-shape";
import { runVitestJson, type TestRunResult } from "../shared/vitest-json";
import { authorsPublishedSlice, issueEditFrom, PRD_LABEL, refiresAffectedSlices } from "./doors";

export const AUTHOR_MODEL = "claude-opus-5";

export const AUTHOR_PROMPT_PATH = ".Workflow/agent-workflows/acceptance/author/prompt.md";

export const AUTHOR_REPAIR_PROMPT_PATH = ".Workflow/agent-workflows/acceptance/author/repair.md";

const REPO_DIR = process.env.TARGET_WORKSPACE || process.cwd();

const MACHINE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

export const HOUSE_RULES_PATH = ".Workflow/agent-workflows/acceptance/author/house-rules.md";

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
  suite?: SuiteLayout;
  houseRules?: string;
  priorAttempts?: string;
}

export const NO_EARLIER_ATTEMPT = "(none: this is the first run against this ticket)";

export function priorAttemptsNote(comments: string[]): string {
  const strikes = strikesIn(comments);
  if (strikes.length === 0) return NO_EARLIER_ATTEMPT;
  return [
    "Earlier runs authored against this same ticket and died before landing a batch. What each one",
    "ended on, oldest first:",
    "",
    ...strikes.map((strike, index) => `${index + 1}. ${strike.signature}`),
  ].join("\n");
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

export function suiteOf(deps: Pick<AuthorDeps, "suite">): SuiteLayout {
  const suite = deps.suite ?? suiteLayout(REPO_DIR);
  if (suite.roots.length === 0) {
    throw new Error(`${REPO_DIR} collects no tests at all, so an acceptance test written there would never run`);
  }
  return suite;
}

function isTestPath(path: string, suffixes: string[]): boolean {
  return suffixes.some((suffix) => path.endsWith(suffix));
}

const HOOKS_DIR = ".claude/hooks/";

const NOT_A_LIFECYCLE_HOOK = new Set(["_hook.py", "_harness.py", "stub_gh.py", "conftest.py", "dispatch.py", "gauntlet.sh"]);

function lifecycleHookStub(path: string): string | undefined {
  if (!path.startsWith(HOOKS_DIR)) return undefined;
  const name = path.slice(HOOKS_DIR.length);
  if (name.includes("/") || NOT_A_LIFECYCLE_HOOK.has(name) || name.startsWith("test_")) return undefined;
  return name.endsWith(".py") || name.endsWith(".sh") ? path : undefined;
}

function busiest(counts: Map<string, number>, fallback: string): string {
  let best = fallback;
  for (const [name, count] of counts) if (count > (counts.get(best) ?? 0)) best = name;
  return best;
}

export function exampleSubject(suite: SuiteLayout, name = "gate-size"): { subject: string; test: string } {
  const perRoot = new Map<string, number>();
  const perSuffix = new Map<string, number>();
  for (const root of suite.roots) perRoot.set(root, suite.files.filter((file) => file.startsWith(`${root}/`)).length);
  for (const suffix of suite.suffixes) perSuffix.set(suffix, suite.files.filter((file) => file.endsWith(suffix)).length);

  const root = busiest(perRoot, suite.roots[0]);
  const suffix = busiest(perSuffix, suite.suffixes[0]);
  return {
    subject: `${root}/${name}${suffix.replace(/^\.(?:test|spec)/, "")}`,
    test: `${root}/${name}${suffix}`,
  };
}

function houseRules(): string {
  if (resolve(REPO_DIR) !== MACHINE_ROOT) return "";
  try {
    return readFileSync(join(MACHINE_ROOT, HOUSE_RULES_PATH), "utf8");
  } catch {
    return "";
  }
}

export interface AuthoredBatch {
  files: AuthoredFile[];
  sessionId?: string;
}

export async function authorAcceptanceTests(
  deps: AuthorDeps,
  budget: LaneBudget = startLaneBudget(laneBudget("acceptance")),
): Promise<AuthoredBatch> {
  const criteria = extractCriteria(deps.ticket.body);
  if (criteria.length === 0) {
    throw new Error(
      `issue #${deps.issueNumber} declares no acceptance criteria under ${CRITERIA_HEADING_RE.source}`,
    );
  }

  const suite = suiteOf(deps);
  const example = exampleSubject(suite);
  const round = await runStageSessionWithinBudget(
    AUTHOR_PROMPT_PATH,
    {
      ISSUE_NUMBER: String(deps.issueNumber),
      ISSUE_TITLE: deps.ticket.title,
      ISSUE_BODY: deps.ticket.body,
      PRD_BODY: deps.prdBody ?? "(no parent PRD)",
      CRITERIA: renderCriteria(criteria),
      CRITERIA_COUNT: String(criteria.length),
      CLAIMED_FILES: renderFiles(extractFilesClaimed(deps.ticket.body), deps.readFile ?? readIfPresent, NO_CLAIMED_FILES),
      SUITE_ROOTS: suite.roots.map((root) => `\`${root}/**\``).join(", "),
      TEST_SUFFIXES: suite.suffixes.map((suffix) => `\`${suffix}\``).join(", "),
      EXAMPLE_SUBJECT_PATH: example.subject,
      EXAMPLE_TEST_PATH: example.test,
      HOUSE_RULES: deps.houseRules ?? houseRules(),
      PRIOR_ATTEMPTS: deps.priorAttempts ?? NO_EARLIER_ATTEMPT,
    },
    deps.exec,
    AUTHOR_OUTPUT,
    {
      budget,
      model: AUTHOR_MODEL,
      promptViaStdin: true,
      stage: deps.priorAttempts === undefined ? "author" : "author-fresh-eyes",
    },
  );
  return acceptRound(deps, criteria, round);
}

export async function repairAcceptanceTests(
  deps: AuthorDeps,
  sessionId: string,
  judgement: string,
  budget: LaneBudget = startLaneBudget(laneBudget("acceptance")),
): Promise<AuthoredBatch> {
  const criteria = extractCriteria(deps.ticket.body);
  const round = await runStageSessionWithinBudget(
    AUTHOR_REPAIR_PROMPT_PATH,
    {
      ISSUE_NUMBER: String(deps.issueNumber),
      CRITERIA_COUNT: String(criteria.length),
      JUDGEMENT: gateOutputTail(judgement),
    },
    deps.exec,
    AUTHOR_OUTPUT,
    { budget, model: AUTHOR_MODEL, promptViaStdin: true, resume: sessionId, stage: "author-repair" },
  );
  return acceptRound(deps, criteria, round);
}

function acceptRound(deps: AuthorDeps, criteria: string[], round: StageSessionResult<AuthorAnswer>): AuthoredBatch {
  const answer = round.value;
  const { roots, suffixes } = suiteOf(deps);
  for (const file of answer.files) {
    if (!roots.some((root) => file.path.startsWith(`${root}/`))) {
      throw new Error(`author wrote outside ${roots.join("/, ")}/: ${file.path}`);
    }
    const stub = lifecycleHookStub(file.path);
    if (stub !== undefined) {
      throw new Error(
        `author wrote ${stub}, a stub for a subject the test runs as a process; house rule ` +
          `(${HOUSE_RULES_PATH}): a .claude/hooks/*.py or *.sh lifecycle hook gets no stub, ` +
          "the test spawns it from a .proc.test.ts and the missing file is the honest failure",
      );
    }
  }
  if (!answer.files.some((file) => isTestPath(file.path, suffixes))) {
    throw new Error(
      `author wrote no test file for #${deps.issueNumber}: looked for a path ending in ${suffixes.join(", ")}`,
    );
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
  gate: (paths: string[]) => GateVerdict;
}

export type BatchVerdict = { ok: true } | { ok: false; reason: string };

export function judgeAuthoredBatch(deps: JudgeDeps, paths: string[], suffixes: string[]): BatchVerdict {
  const tests = paths.filter((path) => isTestPath(path, suffixes));
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
  const gate = deps.gate(paths);
  return gate.ok ? { ok: true } : { ok: false, reason: `the gate is red on the authored batch:\n${gate.output}` };
}

export function turnVenueVerdict(paths: string[], root: string = REPO_DIR): GateVerdict {
  for (const path of paths) {
    const verdict = stopVenueVerdict(root, path);
    if (!verdict.ok) return verdict;
  }
  return { ok: true };
}

export type LandOutcome = { verdict: "pushed" } | { verdict: "refused"; reason: string };

export interface CommitDeps {
  git: GitExec;
  paths: string[];
  commitMessage: string;
  branch: string;
  log?: (line: string) => void;
}

function branchExistsOnOrigin(git: GitExec, branch: string): boolean {
  return git(["ls-remote", "--heads", "origin", branch]).trim().length > 0;
}

export function commitAuthoredBatch(deps: CommitDeps): void {
  const log = deps.log ?? ((line: string) => console.log(line));

  if (branchExistsOnOrigin(deps.git, deps.branch)) {
    log(`${deps.branch} is already on origin, so this batch is committed on top of it`);
    deps.git(["fetch", "origin", deps.branch]);
    deps.git(["checkout", "-B", deps.branch, `origin/${deps.branch}`]);
  } else {
    deps.git(["checkout", "-B", deps.branch]);
  }

  deps.git(["add", ...deps.paths]);
  deps.git(["commit", "-m", deps.commitMessage]);
  deps.git(["push", "origin", `HEAD:${deps.branch}`]);
}

function pushFailedNote(branch: string): string {
  return (
    `The authored tests were judged green, but pushing them to \`${branch}\` failed, so nothing ` +
    "landed. This run counts as a strike; the ladder says what runs next."
  );
}

export function authorRedNote(judgement: string): string {
  return [
    "The acceptance author's batch was still red after its one repair round, so nothing landed. This run counts as a strike; the ladder says what runs next.",
    "",
    "```",
    gateOutputTail(judgement),
    "```",
  ].join("\n");
}

function authorDiedNote(why: string): string {
  return `The acceptance author died before landing anything, so this run counts as a strike and the ladder says what runs next: ${why}`;
}

function haltLoudly(gh: GhExec, issueNumber: number, note: string, log: (line: string) => void): void {
  markLane(gh, issueNumber, QUEUED_LABEL);
  sayOnTicket(gh, issueNumber, note, log);
}

type Attempt = { ok: true; paths: string[] } | { ok: false; reason: string };

function batchPaths(batch: AuthoredBatch): string[] {
  return batch.files.map((file) => file.path);
}

async function authorWithOneRepair(deps: AuthorDeps, judge: JudgeDeps, budget: LaneBudget): Promise<Attempt> {
  const { suffixes } = suiteOf(deps);
  const first = await authorAcceptanceTests(deps, budget);
  const verdict = judgeAuthoredBatch(judge, batchPaths(first), suffixes);
  if (verdict.ok) return { ok: true, paths: batchPaths(first) };
  if (first.sessionId === undefined) return { ok: false, reason: verdict.reason };

  const repaired = await repairAcceptanceTests(deps, first.sessionId, verdict.reason, budget);
  const again = judgeAuthoredBatch(judge, batchPaths(repaired), suffixes);
  return again.ok ? { ok: true, paths: batchPaths(repaired) } : { ok: false, reason: again.reason };
}

export interface RunAcceptanceDeps {
  gh: GhExec;
  exec: StageExec;
  writeFile: (path: string, content: string) => void;
  issueNumber: number;
  runTests?: (paths: string[]) => TestRunResult;
  gate?: (paths: string[]) => GateVerdict;
  git?: GitExec;
  ready?: boolean;
  log?: (line: string) => void;
  suite?: SuiteLayout;
  rung?: string;
}

export async function runAcceptanceAuthor(deps: RunAcceptanceDeps): Promise<LandOutcome> {
  markLane(deps.gh, deps.issueNumber, ACCEPTING_LABEL);
  const ticket = readTicket(deps.gh, deps.issueNumber);
  const prdNumber = parentPrdNumber(ticket.body);
  const prd = prdNumber === undefined ? undefined : readTicket(deps.gh, prdNumber);
  const log = deps.log ?? ((line: string) => console.log(line));
  const budget = startLaneBudget(laneBudget("acceptance"), { gh: deps.gh, ticket: deps.issueNumber, run: currentLaneRun() });

  const priorAttempts =
    deps.rung === FRESH_EYES_RUNG ? priorAttemptsNote(issueComments(deps.gh, deps.issueNumber)) : undefined;
  if (priorAttempts !== undefined) log("this ticket carries a strike, so the author is handed what the earlier runs died on");

  const attempt = await authorWithOneRepair(
    { exec: deps.exec, writeFile: deps.writeFile, issueNumber: deps.issueNumber, ticket, prdBody: prd?.body, suite: deps.suite, priorAttempts },
    {
      runTests: deps.runTests ?? ((tests) => runVitestJson(tests.join(" "), REPO_DIR)),
      gate: deps.gate ?? ((paths) => turnVenueVerdict(paths, REPO_DIR)),
    },
    budget,
  );
  if (!attempt.ok) {
    haltLoudly(deps.gh, deps.issueNumber, authorRedNote(attempt.reason), log);
    return { verdict: "refused", reason: attempt.reason };
  }

  const branch = implementationBranch(deps.issueNumber);
  try {
    commitAuthoredBatch({
      git: deps.git ?? ((args) => execGit(["-C", REPO_DIR, ...args])),
      paths: attempt.paths,
      commitMessage: authorCommitMessage(deps.issueNumber, attempt.paths),
      branch,
      log,
    });
  } catch (err) {
    haltLoudly(deps.gh, deps.issueNumber, pushFailedNote(branch), log);
    return { verdict: "refused", reason: reason(err) };
  }

  if (deps.ready ?? true) dispatchTicketReady(deps.gh, deps.issueNumber);
  return { verdict: "pushed" };
}

function readOpenSliceNumbers(gh: GhExec, prdNumber: number): number[] {
  const raw = gh(["api", subIssuesPath(prdNumber)]);
  const issues = JSON.parse(raw) as Array<{ number: number; state?: string }>;
  return issues.filter((issue) => issue.state !== "closed").map((issue) => issue.number);
}

export interface RefireDeps {
  gh: GhExec;
  prdNumber: number;
  bodyBeforeEdit: string | undefined;
  authorForSlice: (sliceNumber: number) => void | Promise<void>;
  root?: string;
}

export async function refireAcceptance(deps: RefireDeps): Promise<SliceRef[]> {
  if (deps.bodyBeforeEdit === undefined) return [];
  const prd = readTicket(deps.gh, deps.prdNumber);
  const sliceNumbers = readOpenSliceNumbers(deps.gh, deps.prdNumber);

  const existingTests: ExistingTestCriterion[] = [];
  for (const sliceNumber of sliceNumbers) {
    const slice = readTicket(deps.gh, sliceNumber);
    extractCriteria(slice.body).forEach((criterion, i) => {
      if (testsForCriterion(sliceNumber, i + 1, deps.root).length > 0) existingTests.push({ sliceNumber, criterion });
    });
  }

  const affected = affectedSlices({ before: deps.bodyBeforeEdit, after: prd.body }, existingTests);
  for (const { sliceNumber } of affected) await deps.authorForSlice(sliceNumber);
  return affected;
}

function authorCommitMessage(issueNumber: number, paths: string[]): string {
  return `test: author acceptance tests for #${issueNumber} from the spec alone

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

async function authorInProcess(issueNumber: number, rung?: string): Promise<LandOutcome> {
  try {
    return await runAcceptanceAuthor({
      gh: execGh,
      exec: execClaudeIn(REPO_DIR),
      writeFile: fsWriteFile,
      issueNumber,
      ready: process.env.READY === "1",
      rung,
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

function ownersPrdEdit(): boolean {
  return refiresAffectedSlices(
    issueEditFrom({
      eventName: process.env.EVENT_NAME || "",
      labels: process.env.EVENT_ISSUE_LABELS || "",
      sender: process.env.EVENT_SENDER || "",
      owner: process.env.GITHUB_REPOSITORY_OWNER || "",
    }),
  );
}

async function main(): Promise<void> {
  if (process.argv[2] === "--refire") {
    if (!ownersPrdEdit()) {
      console.log(`a ${process.env.EVENT_NAME} event is not the owner editing a \`${PRD_LABEL}\` issue; nothing to re-fire.`);
      return;
    }
    const prdArg = process.argv[3];
    if (!prdArg) {
      console.error("usage: acceptance.ts --refire <prd-issue-number>");
      process.exitCode = 1;
      return;
    }
    try {
      const affected = await refireAcceptance({
        gh: execGh,
        prdNumber: Number(prdArg),
        bodyBeforeEdit: process.env.PRD_BODY_BEFORE || undefined,
        authorForSlice: authorForSliceInProcess,
        root: REPO_DIR,
      });
      console.log(
        affected.length === 0
          ? "no open slice's test lost a criterion this edit removed; nothing re-fired"
          : `re-fired acceptance for ${affected.length} slice(s): ${affected.map((s) => s.sliceNumber).join(", ")}`,
      );
    } catch (err) {
      console.error(`acceptance re-entry failed: ${reason(err)}`);
      process.exitCode = 1;
    }
    return;
  }

  const eventAction = process.env.EVENT_ACTION || "";
  if (!authorsPublishedSlice(eventAction)) {
    console.log(`a \`${eventAction}\` event publishes no slice to author; nothing to do.`);
    return;
  }

  const issueArg = process.argv[2];
  if (!issueArg) {
    console.error("usage: acceptance.ts <issue-number>");
    process.exitCode = 1;
    return;
  }
  try {
    const outcome = await authorInProcess(Number(issueArg), process.env.RUNG || undefined);
    if (outcome.verdict === "refused") {
      console.error(`refused: ${outcome.reason}`);
      process.exitCode = 1;
      return;
    }
    console.log("pushed");
  } catch (err) {
    console.error(`acceptance authoring failed: ${reason(err)}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
