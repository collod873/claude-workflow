import { pathToFileURL } from "node:url";
import { changedPaths } from "../shared/changed-paths";
import { holdingClaim, releaseFailedClaim } from "../shared/claim";
import { laneBudget } from "../shared/lane-budget";
import { execGh, ticketComments, type GhExec, type TicketComment } from "../shared/gh";
import { gateGrowth } from "../shared/gate-files";
import { deriveAnswer, ImplementerReply, landUnderGate, sayOnTicket, type ImplementOutcome } from "../shared/implementation-landing";
import { IMMUTABLE_SET } from "../shared/immutable-set";
import { escalateToOwner } from "../shared/needs-human";
import { implementationBranch } from "../shared/ready-set";
import { reason } from "../shared/reason";
import { gateOutputTail, MACHINE_ROOT, type GateVerdict } from "../shared/run-gauntlet";
import {
  currentLaneRun,
  execClaudeIn,
  runStageSessionWithinBudget,
  startLaneBudget,
  type LaneBudget,
  type StageExec,
} from "../shared/stage";
import { readStandards, renderStandardsSection } from "../shared/standards";
import { structuredOutput } from "../shared/structured-output";
import { targetCheckout, type TargetCheckout } from "../shared/target-checkout";
import { readTicket } from "../shared/ticket-shape";

export const MECHANIC_MODEL = "claude-opus-5";

export const MECHANIC_PROMPT_PATH = ".Workflow/agent-workflows/mechanic/prompt.md";

export const MECHANIC_REPAIR_PROMPT_PATH = ".Workflow/agent-workflows/implement/implementer/repair.md";

export const MECHANIC_DENIED_TOOLS = [
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
  "Bash(gh api:*)",
  "Bash(gh issue create:*)",
  "Bash(gh issue edit:*)",
  "Bash(gh issue close:*)",
  "Bash(gh issue comment:*)",
  "Bash(gh pr:*)",
  "Bash(gh run cancel:*)",
  "Bash(gh run rerun:*)",
  "Bash(gh workflow:*)",
  "Bash(gh label:*)",
  "Bash(gh secret:*)",
  "WebFetch",
  "WebSearch",
  "ScheduleWakeup",
];

export const MECHANIC_FENCE: readonly string[] = ["CODING_STANDARDS.md", ".claude/contract.json", ...IMMUTABLE_SET];

const SKIPPED_TEST_RE = /^\+.*\b(?:it|test|describe)\.(?:skip|todo)\(|^\+.*\bx(?:it|test|describe)\(/m;

const STRIKE_MARKER_RE = /<!-- strike:v1 run=(\d+) conclusion=([a-z_]+) -->/;

const LOG_TAIL_LINES = 120;

export const MECHANIC_OUTPUT = structuredOutput(ImplementerReply);

export interface DeadRunLog {
  runId: number;
  conclusion: string;
  tail: string;
}

export function strikeRunIds(comments: TicketComment[]): Array<{ runId: number; conclusion: string }> {
  return comments.flatMap((comment) => {
    const match = STRIKE_MARKER_RE.exec(comment.body);
    return match ? [{ runId: Number(match[1]), conclusion: match[2] }] : [];
  });
}

export function logTail(raw: string): string {
  const lines = raw.split("\n");
  return lines.slice(Math.max(0, lines.length - LOG_TAIL_LINES)).join("\n");
}

export function fenceHits(paths: readonly string[]): string[] {
  return paths.filter((path) => MECHANIC_FENCE.some((entry) => path === entry || path.startsWith(entry)));
}

export function skipsATest(diff: string): boolean {
  return SKIPPED_TEST_RE.test(diff);
}

export function assembleMechanicBrief(input: {
  ticket: { title: string; body: string };
  comments: TicketComment[];
  deadRuns: DeadRunLog[];
  standards: string;
  machineRoot: string;
  targetRoot: string;
}): string {
  const comments = input.comments.map((comment) => `**${comment.author}** (${comment.createdAt}):\n\n${comment.body}`);
  const runs = input.deadRuns.map(
    (run) => `### Run ${run.runId} ended \`${run.conclusion}\`\n\n\`\`\`\n${run.tail}\n\`\`\``,
  );
  return [
    `## Ticket: ${input.ticket.title}`,
    "",
    input.ticket.body,
    "",
    "## Ticket comments, oldest first",
    "",
    comments.length > 0 ? comments.join("\n\n---\n\n") : "(none)",
    "",
    "## The dead runs' own logs, failed steps only",
    "",
    runs.length > 0 ? runs.join("\n\n") : "(no run log could be read; the strikes above are the record)",
    "",
    "## Where things are",
    "",
    `- The target checkout, where every edit lands: \`${input.targetRoot}\``,
    `- The machine checkout, readable for the lanes' own code: \`${input.machineRoot}\``,
    "",
    "## Fence",
    "",
    `Never edit: ${MECHANIC_FENCE.map((entry) => `\`${entry}\``).join(", ")}. Never skip a test.`,
    "",
    input.standards,
  ].join("\n");
}

export interface MechanicDeps extends TargetCheckout {
  gh: GhExec;
  exec: StageExec;
  readRunLog: (runId: number) => string;
  issueNumber: number;
  standards: () => string;
  comments: () => TicketComment[];
  machineRoot: string;
  targetRoot: string;
  log?: (line: string) => void;
  now?: Date;
}

export type MechanicOutcome = ImplementOutcome | { outcome: "fence-refused"; paths: string[] } | { outcome: "skip-refused" };

function gateOnChanges(deps: MechanicDeps, log: (line: string) => void): GateVerdict {
  if (changedPaths(deps.git).length === 0) {
    log("the checkout is unchanged; the push gate has nothing to judge");
    return { ok: true };
  }
  const verdict = deps.runGate();
  if (verdict.ok) return verdict;
  log("the push gate is red; running it once more before that counts");
  return deps.runGate();
}

export function fenceNote(paths: string[]): string {
  return [
    "The mechanic's answer was refused before its push: it edited what no rung may edit.",
    "",
    ...paths.map((path) => `- \`${path}\``),
    "",
    "A gate threshold, the standards, the contract and the immutable set are the owner's to move. Nothing was committed and the claim is released.",
  ].join("\n");
}

export const SKIP_NOTE =
  "The mechanic's answer was refused before its push: its diff skips a test. A red test is the record of what is still wrong; silencing it is the one move no rung may make. Nothing was committed and the claim is released.";

export function runMechanic(deps: MechanicDeps): Promise<MechanicOutcome> {
  const log = deps.log ?? ((line: string) => console.log(line));
  const branch = implementationBranch(deps.issueNumber);
  const budget = startLaneBudget(laneBudget("mechanic"), { gh: deps.gh, ticket: deps.issueNumber, run: currentLaneRun() });
  return holdingClaim(deps.gh, deps.git, branch, log, deps.now ?? new Date(), () => repairAndOpen(deps, budget, branch, log));
}

async function repairAndOpen(deps: MechanicDeps, budget: LaneBudget, branch: string, log: (line: string) => void): Promise<MechanicOutcome> {
  const state = JSON.parse(deps.gh(["issue", "view", String(deps.issueNumber), "--json", "state"])) as { state?: string };
  if (state.state === "CLOSED") {
    log(`refusing #${deps.issueNumber}: the ticket is already closed; a stale dispatch repairs nothing`);
    releaseFailedClaim(deps.gh, branch, log);
    return { outcome: "ticket-closed" };
  }

  const ticket = readTicket(deps.gh, deps.issueNumber);
  const comments = deps.comments();
  const deadRuns: DeadRunLog[] = strikeRunIds(comments).map((strike) => ({
    ...strike,
    tail: logTail(deps.readRunLog(strike.runId)),
  }));
  const brief = assembleMechanicBrief({
    ticket,
    comments,
    deadRuns,
    standards: renderStandardsSection(deps.standards()),
    machineRoot: deps.machineRoot,
    targetRoot: deps.targetRoot,
  });

  const first = await runStageSessionWithinBudget(MECHANIC_PROMPT_PATH, { BRIEF: brief }, deps.exec, MECHANIC_OUTPUT, {
    budget,
    model: MECHANIC_MODEL,
    promptViaStdin: true,
    disallowedTools: MECHANIC_DENIED_TOOLS,
    stage: "mechanic",
  });
  let reply: ImplementerReply = first.value;
  let gate = gateOnChanges(deps, log);

  if (!gate.ok && first.sessionId) {
    log(`resuming session ${first.sessionId} for the one repair round`);
    const repaired = await runStageSessionWithinBudget(
      MECHANIC_REPAIR_PROMPT_PATH,
      { GATE_OUTPUT: gateOutputTail(gate.output) },
      deps.exec,
      MECHANIC_OUTPUT,
      { budget, model: MECHANIC_MODEL, promptViaStdin: true, disallowedTools: MECHANIC_DENIED_TOOLS, resume: first.sessionId, stage: "mechanic-repair" },
    );
    reply = {
      summary: repaired.value.summary,
      outOfBriefReads: [...first.value.outOfBriefReads, ...repaired.value.outOfBriefReads],
      declaredEdits: repaired.value.declaredEdits,
    };
    gate = gateOnChanges(deps, log);
  }

  const changed = changedPaths(deps.git);
  const hits = [...fenceHits(changed), ...gateGrowth(deps.git, changed)];
  if (hits.length > 0) {
    escalateToOwner(deps.gh, deps.issueNumber, process.env.GITHUB_REPOSITORY_OWNER);
    sayOnTicket(deps.gh, deps.issueNumber, fenceNote(hits), log);
    releaseFailedClaim(deps.gh, branch, log);
    return { outcome: "fence-refused", paths: hits };
  }
  if (skipsATest(deps.git(["diff"]))) {
    escalateToOwner(deps.gh, deps.issueNumber, process.env.GITHUB_REPOSITORY_OWNER);
    sayOnTicket(deps.gh, deps.issueNumber, SKIP_NOTE, log);
    releaseFailedClaim(deps.gh, branch, log);
    return { outcome: "skip-refused" };
  }

  const answer = deriveAnswer(deps.git, deps.readFile, deps.fileExists, reply);
  return landUnderGate(deps, branch, deps.issueNumber, ticket, answer, "fix: mechanic", gate, log);
}

function readFailedLog(runId: number): string {
  try {
    return execGh(["run", "view", String(runId), "--log-failed"]);
  } catch {
    return "";
  }
}

async function main(): Promise<void> {
  const issueArg = process.argv[2];
  if (!issueArg) {
    console.error("usage: mechanic.ts <issue-number>");
    process.exitCode = 1;
    return;
  }
  const issueNumber = Number(issueArg);
  const repoDir = process.env.TARGET_WORKSPACE || process.cwd();

  try {
    const result = await runMechanic({
      ...targetCheckout(repoDir),
      gh: execGh,
      exec: execClaudeIn(repoDir),
      readRunLog: readFailedLog,
      issueNumber,
      standards: () => readStandards(repoDir),
      comments: () => ticketComments(execGh, issueNumber),
      machineRoot: MACHINE_ROOT,
      targetRoot: repoDir,
    });
    if (result.outcome === "opened") {
      console.log(`opened ${result.pr}`);
      return;
    }
    if (result.outcome === "fence-refused" || result.outcome === "skip-refused" || result.outcome === "fails-rule-refused") {
      console.error(`mechanic failed: refused before its push: ${result.outcome}`);
      process.exitCode = 1;
      return;
    }
    console.log(`#${issueNumber}: ${result.outcome}`);
  } catch (err) {
    console.error(`mechanic failed: ${reason(err)}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
