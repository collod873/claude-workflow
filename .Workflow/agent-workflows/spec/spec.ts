import { z } from "zod";
import type { GhExec } from "../shared/gh";
import { runStage, type StageExec } from "../shared/stage";
import { structuredOutput } from "../shared/structured-output";
import { runSpecCritic } from "./critic";
import { collectInSessionContext } from "./collectors/in-session";
import { collectMapContext } from "./collectors/map";
import { collectSheetContext } from "./collectors/sheet";

/**
 * Lane 02 — Spec. First stage: the spec author, which turns a Decided
 * context into a `PRD:` issue payload. Second stage: the critic (ADR-0062),
 * reading the author's own draft in the same chain and folding what it finds
 * into `openQuestions` — never into `body`, which is the author's alone.
 * Both are dispatched by trigger over the author's collector per trigger (an
 * accepted sheet, a closed map, or the owner in a live session — ADR-0058);
 * the critic reads only the author's output, not the trigger.
 */

/** §3: being subtly wrong is expensive and invisible. Low volume, high consequence. */
const SPEC_AUTHOR_MODEL = "claude-opus-5";

/**
 * The only three tools the spec author may reach, enforced by the CLI
 * (ADR-0060): it may read the repository without limit, but must reach no
 * second source of intent — no `Bash`, no web, no subagent spawner, nothing
 * that could see an issue tracker, a transcript, or someone else's spec but
 * the Decided context its collector assembled. `spec.test.ts` asserts this
 * list reaches the argv as `--allowedTools`, because a prompt-only
 * prohibition would leave nothing that looked different.
 */
export const SPEC_AUTHOR_ALLOWED_TOOLS = ["Read", "Grep", "Glob"];

const PROMPT_PATH = ".Workflow/agent-workflows/spec/author/prompt.md";

/**
 * `CONTEXT.md`'s **Decided context**: the owner's words verbatim, the
 * decisions with their reasons, the rulings already filed, the boundaries,
 * and the guesses still open. One shape, however a trigger's collector
 * assembled it — the difference between triggers belongs in the collector,
 * never in the author (ADR-0058).
 */
export interface DecidedContext {
  /** The owner's own words, never paraphrased. */
  ownerWords: string;
  /** The decisions on record, each with its reason. */
  decisions: string;
  /** The rulings already filed — ADR paths and what they settled. */
  rulings: string;
  /** The boundaries already drawn for this idea. */
  boundaries: string;
  /** What is still open — guesses nobody has confirmed. */
  openGuesses: string;
}

/**
 * What the spec author hands back: a `PRD:` issue ready to post, plus what
 * it had to ask rather than invent. `openQuestions` is empty when nothing
 * needed guessing — `CONTEXT.md`'s **Open question**, numbered by position
 * when this is rendered.
 */
export interface SpecAuthorOutput {
  title: string;
  body: string;
  openQuestions: string[];
}

export const SPEC_AUTHOR_OUTPUT = structuredOutput(
  z.object({
    title: z.string().min(1),
    body: z.string().min(1),
    openQuestions: z.array(z.string().min(1)),
  }),
);

/**
 * The three triggers `runSpecAuthor` dispatches over — one event per row of
 * ADR-0058's table, each naming exactly what its collector needs and
 * nothing more. `kind` is what tells `runSpecAuthor` a `DecidedContext` was
 * *not* handed to it directly (see `isDecidedContext` below), so it doubles
 * as the discriminant a `switch` narrows on.
 */
export type SpecTrigger =
  | { kind: "sheet"; gh: GhExec; issueNumber: number }
  | { kind: "map"; gh: GhExec; issueNumber: number; repoRoot?: string }
  | { kind: "in-session"; conversation: string };

/** A `DecidedContext` carries `ownerWords`; no `SpecTrigger` variant does. */
function isDecidedContext(input: DecidedContext | SpecTrigger): input is DecidedContext {
  return "ownerWords" in input;
}

function collect(trigger: SpecTrigger): DecidedContext {
  switch (trigger.kind) {
    case "sheet":
      return collectSheetContext(trigger.gh, trigger.issueNumber);
    case "map":
      return collectMapContext(trigger.gh, trigger.issueNumber, trigger.repoRoot);
    case "in-session":
      return collectInSessionContext(trigger.conversation);
  }
}

/**
 * Runs the spec author on one Decided context, then the critic on the
 * author's own draft (ADR-0062: "the critic runs in the same chain, before
 * publication"), and returns the PRD payload the two together produce.
 *
 * Takes either a `DecidedContext` already assembled, or a `SpecTrigger` to
 * assemble one from first — the one entrypoint every trigger dispatches
 * through (ADR-0058: "one prompt, a collector per trigger"), so a caller
 * that already holds a `DecidedContext` never has to name which trigger
 * produced it.
 *
 * On stdin rather than argv: the Decided context's fields — decisions,
 * rulings, an accepted sheet's own prose — carry no upper bound by
 * construction, the same reasoning `shape.ts`'s shaper documents for its own
 * inlined files.
 */
export async function runSpecAuthor(
  exec: StageExec,
  input: DecidedContext | SpecTrigger,
): Promise<SpecAuthorOutput> {
  const context = isDecidedContext(input) ? input : collect(input);
  const draft = await runStage(
    PROMPT_PATH,
    {
      OWNER_WORDS: context.ownerWords,
      DECISIONS: context.decisions,
      RULINGS: context.rulings,
      BOUNDARIES: context.boundaries,
      OPEN_GUESSES: context.openGuesses,
    },
    exec,
    SPEC_AUTHOR_OUTPUT,
    {
      model: SPEC_AUTHOR_MODEL,
      allowedTools: SPEC_AUTHOR_ALLOWED_TOOLS,
      promptViaStdin: true,
    },
  );

  const critique = await runSpecCritic(exec, { title: draft.title, body: draft.body });

  // The critic only ever adds to `openQuestions`; `title` and `body` are the
  // author's alone, carried through unchanged (ADR-0062: the critic
  // "proposes no fixes").
  return {
    title: draft.title,
    body: draft.body,
    openQuestions: [...draft.openQuestions, ...critique.findings],
  };
}
