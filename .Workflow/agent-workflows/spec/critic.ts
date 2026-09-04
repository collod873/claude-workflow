import { z } from "zod";
import { runStage, type StageExec } from "../shared/stage";
import { structuredOutput } from "../shared/structured-output";

export const SPEC_CRITIC_MODEL = "claude-opus-5";

const PROMPT_PATH = ".Workflow/agent-workflows/spec/critic/prompt.md";

export interface SpecCriticInput {
  title: string;
  body: string;
  answers?: string[];
}

const NO_ANSWERS = "Nothing has been answered; this is the first read of this spec.";

export interface Resolution {
  decision: string;
  reason: string;
}

export interface SpecCriticOutput {
  resolutions: Resolution[];
}

export const SPEC_CRITIC_OUTPUT = structuredOutput(
  z.object({
    resolutions: z.array(
      z.object({
        decision: z.string().min(1),
        reason: z.string().min(1),
      }),
    ),
  }),
);

export async function runSpecCritic(
  exec: StageExec,
  input: SpecCriticInput,
): Promise<SpecCriticOutput> {
  const answers = input.answers?.filter((answer) => answer.trim() !== "") ?? [];

  return runStage(
    PROMPT_PATH,
    {
      TITLE: input.title,
      BODY: input.body,
      ANSWERS: answers.length === 0 ? NO_ANSWERS : answers.join("\n\n---\n\n"),
    },
    exec,
    SPEC_CRITIC_OUTPUT,
    {
      model: SPEC_CRITIC_MODEL,
      promptViaStdin: true,
      stage: "critic",
    },
  );
}
