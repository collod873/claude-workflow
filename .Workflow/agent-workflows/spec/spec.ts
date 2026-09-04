import { pathToFileURL } from "node:url";
import { z } from "zod";
import { execGh, issueComments, type GhExec } from "../shared/gh";
import { reason } from "../shared/reason";
import { execClaudeIn, runStage, type StageExec } from "../shared/stage";
import { structuredOutput } from "../shared/structured-output";
import { readSheetMarker } from "../shared/marker";
import { SPEC_AUTHOR_ALLOWED_TOOLS, type DecidedContext, type SpecAuthorOutput } from "./author-contract";
import { runSpecCritic, type Resolution } from "./critic";
import { collectMapContext } from "./collectors/map";
import { collectSheetContext } from "./collectors/sheet";
import {
  applyGate,
  gateCount,
  SLICEABLE_LABEL,
  unfiledMarks,
  type GateOutcome,
  type MarkedDecision,
} from "./open-questions";
import {
  PRD_LABEL,
  publishSpec,
  readPublishedSpec,
  readSourceMarker,
  updateSpec,
  withoutSourceMarker,
  type PublishedSpec,
  type SpecSource,
} from "./publish";
import { runSpecReconciler } from "./reconcile";
import { specFormat } from "./spec-format";
import { validateSpecBody, type SpecBodyValidator } from "./validate-spec";
import { applySweep, runSpecSweep } from "./sweep";

const SPEC_AUTHOR_MODEL = "claude-opus-5";

export { SPEC_AUTHOR_ALLOWED_TOOLS, type DecidedContext, type SpecAuthorOutput } from "./author-contract";

const PROMPT_PATH = ".Workflow/agent-workflows/spec/author/prompt.md";

export const SPEC_AUTHOR_OUTPUT = structuredOutput(
  z.object({
    title: z.string().min(1),
    body: z.string().min(1),
    openQuestions: z.array(z.string().min(1)),
  }),
);

export type SpecTrigger =
  | { kind: "sheet"; gh: GhExec; issueNumber: number }
  | { kind: "map"; gh: GhExec; issueNumber: number; repoRoot?: string };

function isDecidedContext(input: DecidedContext | SpecTrigger): input is DecidedContext {
  return "ownerWords" in input;
}

function collect(trigger: SpecTrigger): { context: DecidedContext; decisions: MarkedDecision[] } {
  switch (trigger.kind) {
    case "sheet":
      return collectSheetContext(trigger.gh, trigger.issueNumber);
    case "map":
      return {
        context: collectMapContext(trigger.gh, trigger.issueNumber, trigger.repoRoot),
        decisions: [],
      };
  }
}

export async function runSpecAuthor(
  exec: StageExec,
  input: DecidedContext | SpecTrigger,
): Promise<SpecAuthorOutput> {
  const collected = isDecidedContext(input)
    ? { context: input, decisions: [] as MarkedDecision[] }
    : collect(input);
  const sweep = await runSpecSweep(exec, collected.context);
  const context = applySweep(collected.context, sweep);
  const draft = await runStage(
    PROMPT_PATH,
    {
      OWNER_WORDS: context.ownerWords,
      DECISIONS: context.decisions,
      RULINGS: context.rulings,
      BOUNDARIES: context.boundaries,
      OPEN_GUESSES: context.openGuesses,
      SPEC_FORMAT: specFormat(),
    },
    exec,
    SPEC_AUTHOR_OUTPUT,
    {
      model: SPEC_AUTHOR_MODEL,
      allowedTools: SPEC_AUTHOR_ALLOWED_TOOLS,
      promptViaStdin: true,
      stage: "author",
    },
  );

  const critique = await runSpecCritic(exec, { title: draft.title, body: draft.body });
  const marks = unfiledMarks(collected.decisions, draft.openQuestions);
  const resolutions = [...critique.resolutions, ...marks.map(unfiledMarkResolution)];

  const body =
    resolutions.length === 0
      ? draft.body
      : await runSpecReconciler(exec, { title: draft.title, body: draft.body, resolutions });

  return {
    title: draft.title,
    body,
    openQuestions: draft.openQuestions,
    decisions: collected.decisions,
  };
}

export interface SpecPublicationResult extends SpecAuthorOutput {
  issueNumber: number;
  gateCount: number;
  outcome: GateOutcome;
}

export async function runSpecPublication(
  exec: StageExec,
  gh: GhExec,
  target: SpecSource,
  input: DecidedContext | SpecTrigger,
  validate: SpecBodyValidator = validateSpecBody,
): Promise<SpecPublicationResult> {
  const draft = await runSpecAuthor(exec, input);

  const issueNumber = publishSpec(gh, draft, target, validate);
  const { count, outcome } = gateSpec(gh, issueNumber, draft.openQuestions);

  return { ...draft, issueNumber, gateCount: count, outcome };
}

function gateSpec(gh: GhExec, issueNumber: number, openQuestions: string[]): { count: number; outcome: GateOutcome } {
  const count = gateCount(openQuestions);
  return { count, outcome: applyGate(gh, issueNumber, count) };
}

function unfiledMarkResolution(decision: MarkedDecision): Resolution {
  return {
    decision: `\`${decision.mark}\` follows the sheet's own recommendation, with no ADR filed for it.`,
    reason: `The sheet decided \`${decision.mark}\` and filed no ruling for it, and the draft asks about none of it.`,
  };
}

export interface SpecCritiqueResult {
  issueNumber: number;
  resolutions: Resolution[];
  gateCount: number;
  outcome: GateOutcome;
  rewritten: boolean;
}

export async function runSpecCritique(exec: StageExec, gh: GhExec, issueNumber: number): Promise<SpecCritiqueResult> {
  const spec = readPublishedSpec(gh, issueNumber);
  const answers = issueComments(gh, issueNumber);
  const critique = await runSpecCritic(exec, {
    title: spec.title,
    body: spec.body,
    answers,
  });

  const rewritten = critique.resolutions.length > 0;
  if (rewritten) {
    await reconcileSpec(exec, gh, issueNumber, spec, critique.resolutions);
  }

  const { outcome } = gateSpec(gh, issueNumber, []);

  return { issueNumber, resolutions: critique.resolutions, gateCount: 0, outcome, rewritten };
}

async function reconcileSpec(
  exec: StageExec,
  gh: GhExec,
  issueNumber: number,
  spec: PublishedSpec,
  resolutions: Resolution[],
): Promise<void> {
  const body = await runSpecReconciler(exec, {
    title: spec.title,
    body: withoutSourceMarker(spec.body),
    resolutions,
  });

  updateSpec(gh, issueNumber, { title: spec.title, body }, readSourceMarker(spec.body));
}

function detectSourceKind(gh: GhExec, issueNumber: number): SpecSource["kind"] {
  const hasSheet = issueComments(gh, issueNumber).some((body) => readSheetMarker(body) !== undefined);
  return hasSheet ? "sheet" : "map";
}

interface RawSpecIssue {
  body?: string;
  labels?: Array<{ name?: string }>;
}

function alreadySliced(gh: GhExec, sourceIssue: number): boolean {
  const raw = gh(["issue", "list", "--label", PRD_LABEL, "--state", "all", "--limit", "200", "--json", "number,body,labels"]);
  const issues = JSON.parse(raw) as RawSpecIssue[];

  return issues.some((issue) => {
    const labels = (issue.labels ?? []).map((label) => label.name ?? "");
    if (!labels.includes(SLICEABLE_LABEL)) return false;
    return readSourceMarker(issue.body ?? "")?.issue === sourceIssue;
  });
}

export type SpecInvocation = { trigger: "to-spec"; issueNumber: number } | { trigger: "critique"; issueNumber: number };

export type SpecPlan = { path: "author"; input: SpecTrigger; target: SpecSource } | { path: "critique"; issueNumber: number };

export function planSpecRun(gh: GhExec, invocation: SpecInvocation, repoRoot?: string): SpecPlan {
  if (invocation.trigger === "critique") {
    return { path: "critique", issueNumber: invocation.issueNumber };
  }

  if (alreadySliced(gh, invocation.issueNumber)) {
    throw new Error(`spec: issue #${invocation.issueNumber} already has a sliceable spec drafted from it`);
  }

  const kind = detectSourceKind(gh, invocation.issueNumber);
  return {
    path: "author",
    input: kind === "map" ? { kind, gh, issueNumber: invocation.issueNumber, repoRoot } : { kind, gh, issueNumber: invocation.issueNumber },
    target: { kind, issue: invocation.issueNumber },
  };
}

export function invocationFromEnv(env: NodeJS.ProcessEnv): SpecInvocation {
  const trigger = env.SPEC_TRIGGER;
  const issueNumber = Number(env.ISSUE_NUMBER);

  if (trigger !== "to-spec" && trigger !== "critique") {
    throw new Error(`SPEC_TRIGGER must be one of to-spec, critique; got ${JSON.stringify(trigger)}`);
  }
  if (!Number.isInteger(issueNumber) || issueNumber <= 0) {
    throw new Error(`ISSUE_NUMBER must be a positive integer; got ${JSON.stringify(env.ISSUE_NUMBER)}`);
  }

  return { trigger, issueNumber };
}

async function main(): Promise<void> {
  const repoDir = process.env.TARGET_WORKSPACE || process.cwd();

  try {
    const invocation = invocationFromEnv(process.env);
    const plan = planSpecRun(execGh, invocation, repoDir);

    if (plan.path === "critique") {
      const result = await runSpecCritique(execClaudeIn(repoDir), execGh, plan.issueNumber);
      console.log(
        `critiqued #${result.issueNumber}: ${result.outcome}` +
          `${result.rewritten ? ", body re-authored from the critic's resolutions" : ""}`,
      );
      return;
    }

    const result = await runSpecPublication(execClaudeIn(repoDir), execGh, plan.target, plan.input);

    console.log(
      `published #${result.issueNumber}: ${result.gateCount} open question(s) left, ${result.outcome}`,
    );
  } catch (err) {
    console.error(`spec failed: ${reason(err)}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
