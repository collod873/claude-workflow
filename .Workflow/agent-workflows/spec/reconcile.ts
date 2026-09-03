import { z } from "zod";
import { countCriteria } from "../shared/ticket-shape";
import { runStage, type StageExec } from "../shared/stage";
import { structuredOutput } from "../shared/structured-output";
import type { Resolution } from "./critic";
import { SPEC_AUTHOR_ALLOWED_TOOLS } from "./author-contract";
import { specFormat } from "./spec-format";

export const SPEC_RECONCILE_MODEL = "claude-opus-5";

const PROMPT_PATH = ".Workflow/agent-workflows/spec/reconcile/prompt.md";

export interface SpecReconcileInput {
  title: string;
  body: string;
  resolutions: Resolution[];
}

export const SPEC_RECONCILE_OUTPUT = structuredOutput(z.string().min(1), "body");

function formatResolution(resolution: Resolution): string {
  return `Decision: ${resolution.decision}\nReason: ${resolution.reason}`;
}

const ASSUMPTIONS_HEADING = "## Assumptions";

function assumptionLine(resolution: Resolution): string {
  return `- **${resolution.decision}** ${resolution.reason}`;
}

function withoutAssumptions(body: string): string[] {
  const lines = body.split("\n");
  const start = lines.findIndex((line) => line.trim() === ASSUMPTIONS_HEADING);
  if (start === -1) return lines;

  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^##\s/.test(line));
  return [...lines.slice(0, start), ...(end === -1 ? [] : rest.slice(end))];
}

function withAssumptions(body: string, resolutions: Resolution[]): string {
  const kept = withoutAssumptions(body);
  while (kept.length > 0 && kept[kept.length - 1].trim() === "") kept.pop();

  return [...kept, "", ASSUMPTIONS_HEADING, "", ...resolutions.map(assumptionLine)].join("\n");
}

export async function runSpecReconciler(
  exec: StageExec,
  input: SpecReconcileInput,
): Promise<string> {
  const body = await runStage(
    PROMPT_PATH,
    {
      TITLE: input.title,
      BODY: input.body,
      RESOLUTIONS: input.resolutions.map(formatResolution).join("\n\n---\n\n"),
      SPEC_FORMAT: specFormat(),
    },
    exec,
    SPEC_RECONCILE_OUTPUT,
    {
      model: SPEC_RECONCILE_MODEL,
      allowedTools: SPEC_AUTHOR_ALLOWED_TOOLS,
      promptViaStdin: true,
      stage: "reconcile",
    },
  );

  const before = countCriteria(input.body) ?? 0;
  const after = countCriteria(body) ?? 0;
  if (after < before) {
    throw new Error(
      `reconciler returned ${after} acceptance criteria, fewer than the ${before} it was handed — ` +
        "refusing to write a rewrite that dropped one",
    );
  }

  return withAssumptions(body, input.resolutions);
}
