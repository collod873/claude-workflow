import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { regenerateAdrIndex } from "../shared/adr-index";
import { suiteTestFiles } from "../shared/affected-tests";
import { changedPaths } from "../shared/changed-paths";
import { execGh, ticketComments, type GhExec, type TicketComment } from "../shared/gh";
import { execGit, type GitExec } from "../shared/git";
import { escalateToOwner } from "../shared/needs-human";
import { implementationBranch, TICKET_READY_DISPATCH_ACTION } from "../shared/ready-set";
import { reason } from "../shared/reason";
import { gateVerdict, type GateVerdict } from "../shared/run-gauntlet";
import { execClaudeIn, runStageSession, type StageExec, type StageSessionResult } from "../shared/stage";
import { renderStandardsSection, readStandards } from "../shared/standards";
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
  deriveAnswer,
  gateRedNote,
  ImplementerReply,
  landAnswer,
  releaseFailedClaim,
  sayOnTicket,
  staleClaimTakeoverNote,
  type ImplementerAnswer,
  type ImplementOutcome,
} from "../shared/implementation-landing";
import { VERIFY_DISPATCH_EVENT_TYPE } from "../shared/verify-dispatch";
import { assembleBrief, gatherBriefContext, listAdrFiles, walkSourceFiles, type FailingTestFile } from "./brief";
import { recordOutOfBrief } from "./out-of-brief";

export {
  CLAIM_TIMEOUT_MINUTES,
  staleClaimTakeoverNote,
  worktreeChanges,
  type ImplementOutcome,
} from "../shared/implementation-landing";
export { type FailingTestFile } from "./brief";

export const IMPLEMENTER_MODEL = "claude-sonnet-5";

export const IMPLEMENTER_PROMPT_PATH = ".Workflow/agent-workflows/implement/implementer/prompt.md";

export const REPAIR_PROMPT_PATH = ".Workflow/agent-workflows/implement/implementer/repair.md";

export const IMPLEMENTER_DENIED_TOOLS = [
  "Bash(git stash:*)",
  "Bash(git checkout:*)",
  "Bash(git switch:*)",
  "Bash(git restore:*)",
  "Bash(git reset:*)",
  "Bash(git commit:*)",
  "Bash(git push:*)",
  "Bash(git rebase:*)",
  "Bash(git clean:*)",
  "Bash(git mv:*)",
  "Bash(gh:*)",
  "WebFetch",
  "WebSearch",
  "Agent",
  "Task",
  "ScheduleWakeup",
];

export const GATE_OUTPUT_TAIL_CHARS = 12_000;

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

export const IMPLEMENTER_OUTPUT = structuredOutput(ImplementerReply);

export function runImplementer(exec: StageExec, brief: string): Promise<StageSessionResult<ImplementerReply>> {
  return runStageSession(IMPLEMENTER_PROMPT_PATH, { BRIEF: brief }, exec, IMPLEMENTER_OUTPUT, {
    model: IMPLEMENTER_MODEL,
    promptViaStdin: true,
    disallowedTools: IMPLEMENTER_DENIED_TOOLS,
    stage: "implementer",
  });
}

export function gateOutputTail(output: string): string {
  return output.length > GATE_OUTPUT_TAIL_CHARS ? output.slice(-GATE_OUTPUT_TAIL_CHARS) : output;
}

export function runRepair(exec: StageExec, sessionId: string, gateOutput: string): Promise<StageSessionResult<ImplementerReply>> {
  return runStageSession(REPAIR_PROMPT_PATH, { GATE_OUTPUT: gateOutputTail(gateOutput) }, exec, IMPLEMENTER_OUTPUT, {
    model: IMPLEMENTER_MODEL,
    promptViaStdin: true,
    disallowedTools: IMPLEMENTER_DENIED_TOOLS,
    resume: sessionId,
    stage: "implementer-repair",
  });
}

export interface ImplementerSession {
  stage: string;
  turns?: number;
  gauntletRuns?: number;
}

export function sessionsNote(sessions: ImplementerSession[]): string {
  const lines = sessions.map(
    (session) => `- ${session.stage}: ${turnsPhrase(session.turns)}, ${gauntletPhrase(session.gauntletRuns)}`,
  );
  return ["Implementer sessions", ...lines].join("\n");
}

function turnsPhrase(turns: number | undefined): string {
  return turns === undefined ? "turns unknown" : `${turns} turns`;
}

function gauntletPhrase(gauntletRuns: number | undefined): string {
  return gauntletRuns === undefined || gauntletRuns === 0
    ? "never ran bin/gauntlet"
    : `ran bin/gauntlet ${gauntletRuns} times`;
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
  removeFile: (path: string) => void;
  regenerateIndex: () => boolean;
  runGate: () => GateVerdict;
  sourceFiles: () => string[];
  adrFiles: () => string[];
  issueNumber: number;
  failingTests: () => FailingTestFile[];
  standards: () => string;
  comments: () => TicketComment[];
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

function gateOnChanges(deps: ImplementDeps, log: (line: string) => void): GateVerdict {
  if (changedPaths(deps.git).length === 0) {
    log("the checkout is unchanged; the push gate has nothing to judge");
    return { ok: true };
  }
  const verdict = deps.runGate();
  if (verdict.ok) {
    log("the push gate is green");
    return verdict;
  }
  log("the push gate is red; running it once more before that counts");
  const again = deps.runGate();
  log(again.ok ? "the push gate is green on its second run; the first was a flake" : "the push gate is red twice");
  return again;
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
  const failingTests = deps.failingTests();

  const brief = assembleBrief({
    ticketBody: ticket.body,
    seamManifestLines,
    moduleContext,
    standards: renderStandardsSection(deps.standards()),
    comments: deps.comments(),
    failingTests,
    ...gatherBriefContext({
      ticketBody: ticket.body,
      filesClaimed,
      readFile: deps.readFile,
      fileExists: deps.fileExists,
      sourceFiles: deps.sourceFiles,
      adrFiles: deps.adrFiles,
      failingTestPaths: failingTests.map((file) => file.path),
    }),
  });

  const first = await runImplementer(deps.exec, brief);
  let reply: ImplementerReply = first.value;
  let gate = gateOnChanges(deps, log);
  const sessions: ImplementerSession[] = [
    { stage: "implementer", turns: first.turns, gauntletRuns: first.gauntletRuns },
  ];

  if (!gate.ok && first.sessionId) {
    log(`resuming session ${first.sessionId} for the one repair round`);
    const repaired = await runRepair(deps.exec, first.sessionId, gate.output);
    reply = {
      summary: repaired.value.summary,
      outOfBriefReads: [...first.value.outOfBriefReads, ...repaired.value.outOfBriefReads],
    };
    sessions.push({ stage: "implementer-repair", turns: repaired.turns, gauntletRuns: repaired.gauntletRuns });
    gate = gateOnChanges(deps, log);
  }

  if (sessions.some((session) => session.turns !== undefined)) {
    const note = sessionsNote(sessions);
    sayOnTicket(deps.gh, deps.issueNumber, note, log);
    log(note);
  }

  const answer = deriveAnswer(deps.git, deps.readFile, deps.fileExists, reply);
  keepAnswer(deps.writeFile, deps.env ?? process.env, answer, log);

  for (const module of answer.outOfBriefReads) {
    recordOutOfBrief(deps.gh, module);
  }

  const outcome = await landAnswer(
    deps,
    branch,
    deps.issueNumber,
    ticket,
    answer,
    `Implement #${deps.issueNumber}\n\n${answer.summary}\n\nPart of #${deps.issueNumber}`,
    log,
    { rebaseOntoTrunk: true, skipPushHook: true },
  );

  if (!gate.ok && outcome.outcome === "opened") {
    escalateToOwner(deps.gh, deps.issueNumber, process.env.GITHUB_REPOSITORY_OWNER);
    sayOnTicket(deps.gh, deps.issueNumber, gateRedNote(gateOutputTail(gate.output)), log);
  }
  return outcome;
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
      removeFile: (path) => rmSync(inRepo(path), { force: true }),
      regenerateIndex: () => regenerateAdrIndex(repoDir),
      runGate: () => gateVerdict(repoDir),
      sourceFiles: () => walkSourceFiles(repoDir),
      adrFiles: () => listAdrFiles(repoDir),
      issueNumber,
      failingTests: () => findFailingTestFiles(issueNumber, readInRepo, repoDir),
      standards: () => readStandards(repoDir),
      comments: () => ticketComments(execGh, issueNumber),
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
    if (result.outcome === "immutable-refused") {
      console.log(`#${issueNumber} touched the immutable set: ${result.paths.join(", ")}; escalated.`);
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
