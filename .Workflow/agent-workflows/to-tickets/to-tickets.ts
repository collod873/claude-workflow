import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { runEntrypoint } from "../shared/entrypoint";
import { execGh, type GhExec } from "../shared/gh";
import { writeFailure } from "../shared/handoff-path";
import {
  AUDIT_OUTPUT,
  Plan,
  SLICE_OUTPUT,
  measurePlan,
  type AuditOutput,
} from "../shared/plan-schema";
import type { PublishedIssue } from "../shared/publish-sub-issues";
import { reason } from "../shared/reason";
import { checkpointPath, execClaudeIn, rawResponsePath, runStage, type StageExec } from "../shared/stage";
import type { StructuredOutput } from "../shared/structured-output";
import { validatePlan } from "../shared/validate-graph";
import { sliceAndPublish } from "./slice-and-publish";
import { SEAM_SWEEP_OUTPUT, type SeamManifest } from "./seam-sweep/schema";

export function validatePlanFile(filePath: string): Plan {
  const plan = Plan.parse(JSON.parse(readFileSync(filePath, "utf8")));
  validatePlan(plan);
  return plan;
}

interface StageDef {
  run: (issueNumber: string, exec: StageExec, gh: GhExec) => Promise<unknown>;
}

interface TypedStageConfig<T> {
  promptPath: string;
  output: StructuredOutput<T>;
  buildVars: (issueNumber: string) => Record<string, string>;
  validate?: (output: T) => void;
  measure?: (output: T) => string;
}

async function runTypedStage<T>(
  stage: string,
  config: TypedStageConfig<T>,
  issueNumber: string,
  exec: StageExec,
): Promise<T> {
  const value = await runStage(config.promptPath, config.buildVars(issueNumber), exec, config.output, {
    stage,
  });
  config.validate?.(value);
  if (config.measure) {
    console.log(`${stage}: ${config.measure(value)}`);
  }
  return value;
}

function typedStage<T>(name: string, config: TypedStageConfig<T>): StageDef {
  return {
    run: async (issueNumber, exec) => {
      const output = await runTypedStage(name, config, issueNumber, exec);
      console.log(`${name}: wrote a schema-valid output`);
      console.log(JSON.stringify(output, null, 2));
      return output;
    },
  };
}

const VOCABULARY_PATH = ".Workflow/agent-workflows/to-tickets/vocabulary.md";

export function vocabulary(): string {
  let page: string;
  try {
    page = readFileSync(VOCABULARY_PATH, "utf8");
  } catch (err) {
    throw new Error(`the lane's vocabulary at ${VOCABULARY_PATH} could not be read: ${reason(err)}`);
  }

  const [, entries] = page.split(/^---$/m);
  if (!entries?.trim()) {
    throw new Error(
      `${VOCABULARY_PATH} has no entries below its \`---\` rule; everything above it is prose a stage must not be given`,
    );
  }
  return entries.trim();
}

const TICKET_FORMAT_PATH = "docs/agents/ticket-format.md";

export function ticketFormat(): string {
  let page: string;
  try {
    page = readFileSync(TICKET_FORMAT_PATH, "utf8");
  } catch (err) {
    throw new Error(`the ticket contract at ${TICKET_FORMAT_PATH} could not be read: ${reason(err)}`);
  }

  const sections = page.split(/^### /m);
  const core = sections[0]?.trim();
  const specSubIssue = sections.find((section) => section.startsWith("Spec sub-issue"));
  if (!core || !specSubIssue) {
    throw new Error(
      `${TICKET_FORMAT_PATH} has no "### Spec sub-issue" variant, so the slicer's ticket contract would be empty`,
    );
  }
  return `${core}\n\n### ${specSubIssue.trim()}\n`;
}

const SEAM_SWEEP_CONFIG: TypedStageConfig<SeamManifest> = {
  promptPath: ".Workflow/agent-workflows/to-tickets/seam-sweep/prompt.md",
  output: SEAM_SWEEP_OUTPUT,
  buildVars: (issueNumber) => ({ ISSUE_NUMBER: issueNumber, VOCABULARY: vocabulary() }),
};

const SLICE_CONFIG: TypedStageConfig<Plan> = {
  promptPath: ".Workflow/agent-workflows/to-tickets/slice/prompt.md",
  output: SLICE_OUTPUT,
  buildVars: (issueNumber) => ({
    ISSUE_NUMBER: issueNumber,
    VOCABULARY: vocabulary(),
    TICKET_FORMAT: ticketFormat(),
    SEAM_MANIFEST: readPriorHandoff("seam-sweep", SEAM_SWEEP_OUTPUT),
  }),
  validate: validatePlan,
  measure: measurePlan,
};

function readPriorHandoff<T>(priorStage: string, priorOutput: StructuredOutput<T>): string {
  const path = checkpointPath(priorStage);
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (err) {
    throw new Error(`needs ${priorStage}'s checkpoint at ${path}, but it could not be read: ${reason(err)}`);
  }

  let envelope: { response?: unknown };
  try {
    envelope = JSON.parse(raw);
  } catch (err) {
    throw new Error(`needs ${priorStage}'s checkpoint at ${path}, but it is not valid JSON: ${reason(err)}`);
  }
  if (typeof envelope.response !== "string") {
    throw new Error(`needs ${priorStage}'s checkpoint at ${path}, but it has no response field`);
  }

  return JSON.stringify(priorOutput.parse(envelope.response));
}

const AUDIT_CONFIG: TypedStageConfig<AuditOutput> = {
  promptPath: ".Workflow/agent-workflows/to-tickets/audit/prompt.md",
  output: AUDIT_OUTPUT,
  buildVars: (issueNumber) => ({
    ISSUE_NUMBER: issueNumber,
    VOCABULARY: vocabulary(),
    PLAN: readPriorHandoff("slice", SLICE_OUTPUT),
  }),
  measure: (audited) => measurePlan(audited.slices),
};

const AUDIT_AND_PUBLISH_RUN: StageDef["run"] = async (issueNumber, exec, gh) => {
  const audited = await runTypedStage("audit-and-publish", AUDIT_CONFIG, issueNumber, exec);
  if (audited.notes) {
    console.log(audited.notes);
  }
  const published = keepingPlan(audited.slices, () =>
    sliceAndPublish(audited.slices, Number(issueNumber), gh),
  );
  console.log(
    `audit-and-publish: published ${published.length} sub-issue${published.length === 1 ? "" : "s"} under #${issueNumber}`,
  );
  return published;
};

function keepingPlan<R>(plan: Plan, work: () => R): R {
  try {
    return work();
  } catch (err) {
    const path = rawResponsePath("audit-and-publish");
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(plan, null, 2), "utf8");
    throw new Error(`${reason(err)}: the audited plan is saved at ${path}`);
  }
}

export const STAGES = {
  "seam-sweep": typedStage("seam-sweep", SEAM_SWEEP_CONFIG),
  slice: typedStage("slice", SLICE_CONFIG),
  "audit-and-publish": { run: AUDIT_AND_PUBLISH_RUN },
} satisfies Record<string, StageDef>;

export type StageName = keyof typeof STAGES;

function isStageName(value: string | undefined): value is StageName {
  return value !== undefined && Object.prototype.hasOwnProperty.call(STAGES, value);
}

export function runNamedStage(
  stageName: StageName,
  issueNumber: string,
  exec: StageExec,
  gh: GhExec,
): Promise<unknown> {
  return STAGES[stageName].run(issueNumber, exec, gh);
}

function usage(): never {
  console.error(
    "usage: to-tickets.ts --validate-plan <file>\n" + "       to-tickets.ts --stage <name> --issue <n>",
  );
  process.exit(1);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  const stageFlagIndex = args.indexOf("--stage");
  if (stageFlagIndex !== -1) {
    const stageName = args[stageFlagIndex + 1];
    const issueFlagIndex = args.indexOf("--issue");
    const issueNumber = issueFlagIndex === -1 ? undefined : args[issueFlagIndex + 1];

    if (!isStageName(stageName) || !issueNumber) {
      usage();
    }

    try {
      await runNamedStage(stageName, issueNumber, execClaudeIn(process.env.TARGET_WORKSPACE || process.cwd()), execGh);
    } catch (err) {
      const detail = reason(err);
      console.error(`${stageName} failed: ${detail}`);
      writeFailure(stageName, detail);
      process.exitCode = 1;
    }
    return;
  }

  const flagIndex = args.indexOf("--validate-plan");
  if (flagIndex === -1 || !args[flagIndex + 1]) {
    usage();
  }

  const filePath = args[flagIndex + 1];
  const plan = validatePlanFile(filePath);
  console.log(`plan is valid: ${plan.length} slice${plan.length === 1 ? "" : "s"}`);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  runEntrypoint("validate-plan", main);
}
