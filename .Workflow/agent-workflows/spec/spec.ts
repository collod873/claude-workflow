import { pathToFileURL } from "node:url";
import { z } from "zod";
import { execGh, type GhExec } from "../shared/gh";
import { reason } from "../shared/reason";
import { execClaude, runStage, type StageExec } from "../shared/stage";
import { structuredOutput } from "../shared/structured-output";
import { runSpecCritic } from "./critic";
import { collectInSessionContext } from "./collectors/in-session";
import { collectMapContext } from "./collectors/map";
import { collectSheetContext } from "./collectors/sheet";
import { applyGate, gateCount, type GateOutcome } from "./open-questions";
import { publishSpec, readSourceMarker, readSpecBody, updateSpec, type SpecSource } from "./publish";
import { postOpenQuestions } from "./rounds";

// Re-exported rather than wired into this file's own chain: ADR-0079's
// amendment path fires on `spec/gap`, an existing PRD's re-entry, never on
// the fresh-draft trigger this file's `SpecTrigger` union enumerates. Kept
// reachable from here anyway, since this is the module a caller already
// imports for lane 02.
export { runSpecAmendment, type SpecAmendmentResult, type SpecGapReport } from "./amend";

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

/** What `runSpecPublication` hands back: the draft, where it landed, and what the gate did with it. */
export interface SpecPublicationResult extends SpecAuthorOutput {
  /** The `PRD:` issue this run published, or re-ran and rewrote. */
  issueNumber: number;
  /** `true` when this run filed the issue, `false` when it rewrote one that already existed. */
  published: boolean;
  /** The count `open-questions.ts`'s `gateCount` computed over the folded `openQuestions`. */
  gateCount: number;
  /** `"dispatched"` at zero, `"held"` otherwise — `open-questions.ts`'s `applyGate` outcome. */
  outcome: GateOutcome;
}

/**
 * Which issue this run's draft lands on.
 *
 * `publish` is a first run: no spec exists, and the source is recorded on the one this files so a
 * later re-run can find its way back to the collector. `rerun` is ADR-0062's answering round: the
 * spec exists, carries the owner's answers as comments, and must be rewritten rather than filed
 * again — its number is what `sliceable`, the dispatch, the round count and every comment already
 * hang off.
 */
export type SpecTarget =
  | { mode: "publish"; source: SpecSource | undefined }
  | { mode: "rerun"; issueNumber: number; source: SpecSource | undefined };

/**
 * The tail of lane 02's chain (ADR-0062): runs `runSpecAuthor` — draft plus
 * critic, already folded into one `openQuestions` list — publishes the result,
 * then gates on it.
 *
 * Publication comes first and is unconditional, which is ADR-0062's step 1 read
 * literally: the spec carries `prd` whatever its count, and "a spec that never
 * reaches zero never slices — that is the correct behaviour and it is visible:
 * the issue sits carrying `prd` without `sliceable`." A gate that decided
 * whether to publish would make the held case invisible, which is the one
 * outcome that is supposed to reach the owner.
 *
 * At a zero gate count: `applyGate` labels the spec `sliceable` and sends
 * the `repository_dispatch` lane 03 fires on. At any other count:
 * `postOpenQuestions` comments the numbered questions on the issue —
 * ADR-0062's "the only thing that reaches the owner" — so his answering
 * comment is what `rounds.ts`'s `roundFor` counts toward the next, uncapped,
 * re-run.
 *
 * Takes the same `DecidedContext | SpecTrigger` union `runSpecAuthor` does,
 * plus the `gh` every write needs — the trigger's own `gh` is not reused here,
 * because an `in-session` trigger carries none.
 */
export async function runSpecPublication(
  exec: StageExec,
  gh: GhExec,
  target: SpecTarget,
  input: DecidedContext | SpecTrigger,
): Promise<SpecPublicationResult> {
  const draft = await runSpecAuthor(exec, input);

  const issueNumber =
    target.mode === "publish" ? publishSpec(gh, draft, target.source) : target.issueNumber;
  if (target.mode === "rerun") {
    updateSpec(gh, issueNumber, draft, target.source);
  }

  const count = gateCount(draft.openQuestions);
  const outcome = applyGate(gh, issueNumber, count);

  if (outcome === "held") {
    postOpenQuestions(gh, issueNumber, draft.openQuestions);
  }

  return { ...draft, issueNumber, published: target.mode === "publish", gateCount: count, outcome };
}

/**
 * The event `spec.yml` hands this file, reduced to the two facts that pick a collector: which
 * trigger fired, and the issue it names.
 *
 * `sheet` arrives as ADR-0083's `repository_dispatch` after the accept has written its marker;
 * `map` arrives as the owner's `to-spec` click (ADR-0059); `answer` is a comment on a spec that is
 * already published, which is ADR-0062's re-run and the only one of the three that does not file a
 * new issue.
 */
export type SpecInvocation =
  | { trigger: "sheet"; issueNumber: number }
  | { trigger: "map"; issueNumber: number }
  | { trigger: "answer"; issueNumber: number };

/**
 * Turns one invocation into the collector input and the publication target `runSpecPublication`
 * needs — the whole of the runner's decision-making, kept out of `spec.yml` so it is testable
 * without a runner and so the workflow stays a trigger and an `npx tsx` line.
 *
 * The re-run reads its source back off the spec's own body (`spec-source:v1`), because a comment
 * event knows only the spec's number and the collectors all read the *source* — the accepted idea
 * or the closed map — never the spec drafted from it. A spec carrying no readable source marker
 * cannot be re-run and says so: that is a spec published before the marker existed, or one written
 * from a live session, and guessing at its provenance would be exactly the re-derivation
 * `shape/marker.ts` exists to prevent.
 */
export function planSpecRun(
  gh: GhExec,
  invocation: SpecInvocation,
): { input: SpecTrigger; target: SpecTarget } {
  if (invocation.trigger !== "answer") {
    const source: SpecSource = { kind: invocation.trigger, issue: invocation.issueNumber };
    return {
      input: { kind: invocation.trigger, gh, issueNumber: invocation.issueNumber },
      target: { mode: "publish", source },
    };
  }

  const source = readSourceMarker(readSpecBody(gh, invocation.issueNumber));
  if (!source) {
    throw new Error(
      `spec #${invocation.issueNumber} records no readable spec-source marker, so there is no ` +
        `decided context to re-run it from — answer it in a live session, or re-run its source directly`,
    );
  }

  return {
    input: { kind: source.kind, gh, issueNumber: source.issue },
    target: { mode: "rerun", issueNumber: invocation.issueNumber, source },
  };
}

/**
 * Reads `spec.yml`'s environment into a `SpecInvocation`.
 *
 * `SPEC_TRIGGER` is set by the workflow rather than re-derived here from `GITHUB_EVENT_NAME` and a
 * label: the workflow's `if:` has already decided which of the three fired, and re-deciding it from
 * the raw event would be a second copy of that condition that could disagree with the first.
 */
export function invocationFromEnv(env: NodeJS.ProcessEnv): SpecInvocation {
  const trigger = env.SPEC_TRIGGER;
  const issueNumber = Number(env.ISSUE_NUMBER);

  if (trigger !== "sheet" && trigger !== "map" && trigger !== "answer") {
    throw new Error(`SPEC_TRIGGER must be one of sheet, map, answer — got ${JSON.stringify(trigger)}`);
  }
  if (!Number.isInteger(issueNumber) || issueNumber <= 0) {
    throw new Error(`ISSUE_NUMBER must be a positive integer — got ${JSON.stringify(env.ISSUE_NUMBER)}`);
  }

  return { trigger, issueNumber };
}

async function main(): Promise<void> {
  try {
    const invocation = invocationFromEnv(process.env);
    const { input, target } = planSpecRun(execGh, invocation);
    const result = await runSpecPublication(execClaude, execGh, target, input);

    console.log(
      `${result.published ? "published" : "re-ran"} #${result.issueNumber}: ` +
        `${result.gateCount} open question(s), ${result.outcome}`,
    );
  } catch (err) {
    console.error(`spec failed: ${reason(err)}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
