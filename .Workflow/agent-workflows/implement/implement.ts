import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { suiteTestFiles } from "../shared/affected-tests";
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
import { recordOutOfBrief } from "./out-of-brief";

export {
  CLAIM_TIMEOUT_MINUTES,
  ImplementerAnswer,
  staleClaimTakeoverNote,
  worktreeChanges,
  type ImplementOutcome,
} from "../shared/implementation-landing";

export const IMPLEMENTER_MODEL = "claude-sonnet-5";

export const IMPLEMENTER_PROMPT_PATH = ".Workflow/agent-workflows/implement/implementer/prompt.md";

export const IMPLEMENT_DISPATCH_EVENT_TYPE = TICKET_READY_DISPATCH_ACTION;

export { VERIFY_DISPATCH_EVENT_TYPE };

const SEAMS_HEADING_RE = /^##[ \t]+Seams consumed[ \t]*$/m;

export function extractSeamsConsumed(body: string): string[] {
  const section = sectionText(normalizeNewlines(body), SEAMS_HEADING_RE);
  return section
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

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

export interface FailingTestFile {
  path: string;
  content: string;
}

export interface BriefInputs {
  ticketBody: string;
  seamManifestLines: string[];
  moduleContext: string;
  failingTests: FailingTestFile[];
}

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
    "## Acceptance test(s) to turn on",
    tests,
  ].join("\n\n");
}

export const IMPLEMENTER_OUTPUT = structuredOutput(ImplementerAnswer);

export function runImplementer(exec: StageExec, brief: string): Promise<ImplementerAnswer> {
  return runStage(IMPLEMENTER_PROMPT_PATH, { BRIEF: brief }, exec, IMPLEMENTER_OUTPUT, {
    model: IMPLEMENTER_MODEL,
    promptViaStdin: true,
    stage: "implementer",
  });
}

export const ANSWER_PATH_ENV = "IMPLEMENT_ANSWER_PATH";

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
  failingTests: () => FailingTestFile[];
  log?: (line: string) => void;
  now?: Date;
  env?: Record<string, string | undefined>;
}

export async function runImplement(deps: ImplementDeps): Promise<ImplementOutcome> {
  const log = deps.log ?? ((line: string) => console.log(line));

  const branch = implementationBranch(deps.issueNumber);
  const claim = claimImplementationBranch(deps.gh, deps.git, branch, log, deps.now ?? new Date());
  if (!claim.claimed) return { outcome: "already-claimed" };

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

async function buildAndOpen(deps: ImplementDeps, branch: string, log: (line: string) => void): Promise<ImplementOutcome> {
  const stateRead = JSON.parse(deps.gh(["issue", "view", String(deps.issueNumber), "--json", "state"])) as {
    state?: string;
  };
  if (stateRead.state === "CLOSED") {
    log(`refusing #${deps.issueNumber}: the ticket is already closed; a stale dispatch builds nothing`);
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

function sliceMarker(issueNumber: number): RegExp {
  return new RegExp(`^\\s*(?:test|it)\\.fails\\([^\\n]*#${issueNumber}\\b`, "m");
}

export function findFailingTestFiles(
  issueNumber: number,
  readFile: (path: string) => string,
  repoDir: string = process.cwd(),
): FailingTestFile[] {
  const marker = sliceMarker(issueNumber);
  const files: FailingTestFile[] = [];
  for (const absolute of suiteTestFiles(repoDir)) {
    const path = relative(repoDir, absolute).split(sep).join("/");
    const content = readFile(path);
    if (marker.test(content)) files.push({ path, content });
  }
  return files;
}

async function main(): Promise<void> {
  const issueArg = process.argv[2];
  if (!issueArg) {
    console.error("usage: implement.ts <issue-number>");
    process.exitCode = 1;
    return;
  }
  const issueNumber = Number(issueArg);

  const repoDir = process.env.TARGET_WORKSPACE || process.cwd();
  const inRepo = (path: string) => resolve(repoDir, path);
  const readInRepo = (path: string) => readFileSync(inRepo(path), "utf8");

  try {
    const result = await runImplement({
      gh: execGh,
      exec: execClaudeIn(repoDir),
      git: (args) => execGit(["-C", repoDir, ...args]),
      readFile: readInRepo,
      fileExists: (path) => existsSync(inRepo(path)),
      writeFile: (path, content) => fsWriteFile(inRepo(path), content),
      issueNumber,
      failingTests: () => findFailingTestFiles(issueNumber, readInRepo, repoDir),
    });
    if (result.outcome === "already-claimed") {
      console.log(`#${issueNumber} is already claimed; nothing to do.`);
      return;
    }
    if (result.outcome === "ticket-closed") {
      console.log(`#${issueNumber} is already closed; refused the stale dispatch.`);
      return;
    }
    if (result.outcome === "nothing-to-build") {
      console.log(`#${issueNumber} needed no changes; nothing to build.`);
      return;
    }
    if (result.outcome === "rebase-conflict") {
      console.log(`#${issueNumber} conflicted rebasing onto trunk: ${result.paths.join(", ")}; escalated.`);
      return;
    }
    if (result.outcome === "fails-rule-refused") {
      console.error(`#${issueNumber} was refused before its push: ${result.reason}`);
      process.exitCode = 1;
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
