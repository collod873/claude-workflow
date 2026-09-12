import { dirname, join, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { suiteTestFiles } from "../shared/affected-tests";
import { changedPaths, describeAttempt } from "../shared/changed-paths";
import { execGh, ticketComments, type GhExec, type TicketComment } from "../shared/gh";
import { FRESH_EYES_RUNG, implementationBranch, TICKET_READY_DISPATCH_ACTION } from "../shared/ready-set";
import { reason } from "../shared/reason";
import { gateOutputTail, type GateVerdict } from "../shared/run-gauntlet";
import {
  currentLaneRun,
  execClaudeIn,
  runStageSessionWithinBudget,
  startLaneBudget,
  type LaneBudget,
  type StageExec,
  type StageSessionResult,
} from "../shared/stage";
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
import { holdingClaim, releaseFailedClaim } from "../shared/claim";
import { laneBudget } from "../shared/lane-budget";
import {
  deriveAnswer,
  ImplementerReply,
  landUnderGate,
  sayOnTicket,
  staleClaimTakeoverNote,
  type ImplementOutcome,
} from "../shared/implementation-landing";
import { targetCheckout, type TargetCheckout } from "../shared/target-checkout";
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

export const FRESH_EYES_MODEL = "claude-opus-5";

export const IMPLEMENTER_PROMPT_PATH = ".Workflow/agent-workflows/implement/implementer/prompt.md";

export const REPAIR_PROMPT_PATH = ".Workflow/agent-workflows/implement/implementer/repair.md";

export const FRESH_EYES_PROMPT_PATH = ".Workflow/agent-workflows/implement/implementer/fresh-eyes.md";

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

export function runImplementer(
  exec: StageExec,
  budget: LaneBudget,
  brief: string,
): Promise<StageSessionResult<ImplementerReply>> {
  return runStageSessionWithinBudget(IMPLEMENTER_PROMPT_PATH, { BRIEF: brief }, exec, IMPLEMENTER_OUTPUT, {
    budget,
    model: IMPLEMENTER_MODEL,
    promptViaStdin: true,
    disallowedTools: IMPLEMENTER_DENIED_TOOLS,
    stage: "implementer",
  });
}

export function runRepair(
  exec: StageExec,
  budget: LaneBudget,
  sessionId: string,
  gateOutput: string,
): Promise<StageSessionResult<ImplementerReply>> {
  return runStageSessionWithinBudget(REPAIR_PROMPT_PATH, { GATE_OUTPUT: gateOutputTail(gateOutput) }, exec, IMPLEMENTER_OUTPUT, {
    budget,
    model: IMPLEMENTER_MODEL,
    promptViaStdin: true,
    disallowedTools: IMPLEMENTER_DENIED_TOOLS,
    resume: sessionId,
    stage: "implementer-repair",
  });
}

export function runFreshEyes(
  exec: StageExec,
  budget: LaneBudget,
  brief: string,
  attempt: string,
  gateOutput: string,
): Promise<StageSessionResult<ImplementerReply>> {
  return runStageSessionWithinBudget(
    FRESH_EYES_PROMPT_PATH,
    { BRIEF: brief, ATTEMPT: attempt, GATE_OUTPUT: gateOutputTail(gateOutput) },
    exec,
    IMPLEMENTER_OUTPUT,
    {
      budget,
      model: FRESH_EYES_MODEL,
      promptViaStdin: true,
      disallowedTools: IMPLEMENTER_DENIED_TOOLS,
      stage: "implementer-fresh-eyes",
    },
  );
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

export { implementationBranch };

export interface ImplementDeps extends TargetCheckout {
  gh: GhExec;
  exec: StageExec;
  attempt: () => string;
  sourceFiles: () => string[];
  adrFiles: () => string[];
  issueNumber: number;
  failingTests: () => FailingTestFile[];
  standards: () => string;
  comments: () => TicketComment[];
  rung?: string;
  log?: (line: string) => void;
  now?: Date;
}

export function runImplement(deps: ImplementDeps): Promise<ImplementOutcome> {
  const log = deps.log ?? ((line: string) => console.log(line));
  const branch = implementationBranch(deps.issueNumber);
  const budget = startLaneBudget(laneBudget("implement"), { gh: deps.gh, ticket: deps.issueNumber, run: currentLaneRun() });
  return holdingClaim(deps.gh, deps.git, branch, log, deps.now ?? new Date(), (claim) => {
    if (claim.tookOverStaleClaim) sayOnTicket(deps.gh, deps.issueNumber, staleClaimTakeoverNote(branch), log);
    return buildAndOpen(deps, budget, branch, log);
  });
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

async function buildAndOpen(
  deps: ImplementDeps,
  budget: LaneBudget,
  branch: string,
  log: (line: string) => void,
): Promise<ImplementOutcome> {
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

  const sessions: ImplementerSession[] = [];
  const summaries: string[] = [];
  let reply: ImplementerReply = { summary: "", outOfBriefReads: [], declaredEdits: [] };
  let gate: GateVerdict = { ok: false, output: "" };

  if (deps.rung === FRESH_EYES_RUNG) {
    log("the tracker carries a strike against this ticket, so rung one is skipped and fresh eyes run first");
    gate = { ok: false, output: strikesAsGateOutput(deps.comments()) };
  } else {
    const first = await runImplementer(deps.exec, budget, brief);
    reply = first.value;
    gate = gateOnChanges(deps, log);
    sessions.push({ stage: "implementer", turns: first.turns, gauntletRuns: first.gauntletRuns });
    summaries.push(first.value.summary);

    if (!gate.ok && first.sessionId) {
      log(`resuming session ${first.sessionId} for the one repair round`);
      const repaired = await runRepair(deps.exec, budget, first.sessionId, gate.output);
      reply = {
        summary: repaired.value.summary,
        outOfBriefReads: [...first.value.outOfBriefReads, ...repaired.value.outOfBriefReads],
        declaredEdits: repaired.value.declaredEdits,
      };
      summaries.push(repaired.value.summary);
      sessions.push({ stage: "implementer-repair", turns: repaired.turns, gauntletRuns: repaired.gauntletRuns });
      gate = gateOnChanges(deps, log);
    }
  }

  if (!gate.ok) {
    log("the push gate is still red after rung one; running a fresh Opus session with a clean context");
    const attempt = [...summaries, deps.attempt()].join("\n\n");
    const freshEyes = await runFreshEyes(deps.exec, budget, brief, attempt, gate.output);
    reply = {
      summary: freshEyes.value.summary,
      outOfBriefReads: [...reply.outOfBriefReads, ...freshEyes.value.outOfBriefReads],
      declaredEdits: freshEyes.value.declaredEdits,
    };
    sessions.push({ stage: "implementer-fresh-eyes", turns: freshEyes.turns, gauntletRuns: freshEyes.gauntletRuns });
    gate = gateOnChanges(deps, log);
  }

  if (sessions.some((session) => session.turns !== undefined)) {
    const note = sessionsNote(sessions);
    sayOnTicket(deps.gh, deps.issueNumber, note, log);
    log(note);
  }

  const answer = deriveAnswer(deps.git, deps.readFile, deps.fileExists, reply);

  for (const module of answer.outOfBriefReads) {
    recordOutOfBrief(deps.gh, module);
  }

  return landUnderGate(deps, branch, deps.issueNumber, ticket, answer, "feat: implement", gate, log);
}

const STRIKE_SIGNATURE_RE = /<!-- strike-signature:(.*) -->/;

export function strikesAsGateOutput(comments: TicketComment[]): string {
  const signatures = comments.flatMap((comment) => {
    const match = STRIKE_SIGNATURE_RE.exec(comment.body);
    return match ? [match[1]] : [];
  });
  return [
    "No gate ran: every earlier run of this ticket died before reaching it. Their strikes, oldest first:",
    ...signatures.map((signature, index) => `${index + 1}. ${signature}`),
  ].join("\n");
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
  const checkout = targetCheckout(repoDir);

  try {
    const result = await runImplement({
      ...checkout,
      gh: execGh,
      exec: execClaudeIn(repoDir),
      attempt: () => describeAttempt(checkout.git),
      sourceFiles: () => walkSourceFiles(repoDir),
      adrFiles: () => listAdrFiles(repoDir),
      issueNumber,
      failingTests: () => findFailingTestFiles(issueNumber, checkout.readFile, repoDir),
      standards: () => readStandards(repoDir),
      comments: () => ticketComments(execGh, issueNumber),
      ...(process.env.RUNG ? { rung: process.env.RUNG } : {}),
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
