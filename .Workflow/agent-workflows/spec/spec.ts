import { pathToFileURL } from "node:url";
import { z } from "zod";
import { execGh, type GhExec } from "../shared/gh";
import { reason } from "../shared/reason";
import { execClaude, runStage, type StageExec } from "../shared/stage";
import { structuredOutput } from "../shared/structured-output";
import { runSpecCritic, type Resolution } from "./critic";
import { collectMapContext } from "./collectors/map";
import { collectSheetContext } from "./collectors/sheet";
import {
  applyGate,
  gateCount,
  unfiledMarks,
  type GateOutcome,
  type MarkedDecision,
} from "./open-questions";
import {
  publishSpec,
  readPublishedSpec,
  readSourceMarker,
  readSpecBody,
  updateSpec,
  withoutSourceMarker,
  type PublishedSpec,
  type SpecSource,
} from "./publish";
import { runSpecReconciler } from "./reconcile";
import { answeringComments, postOpenQuestions } from "./rounds";
import { applySweep, runSpecSweep } from "./sweep";

// Re-exported rather than wired into this file's own chain: ADR-0079's
// amendment path fires on `spec/gap`, an existing PRD's re-entry, never on
// the fresh-draft trigger this file's `SpecTrigger` union enumerates. Kept
// reachable from here anyway, since this is the module a caller already
// imports for lane 02.
export { runSpecAmendment, type SpecAmendmentResult, type SpecGapReport } from "./amend";

/**
 * Lane 02 — Spec. First stage: the spec author, which turns a Decided
 * context into a `PRD:` issue payload. Second stage: the critic (ADR-0062,
 * amended by the sweep-and-pen redesign), reading the author's own draft in
 * the same chain and resolving what it finds on its own authority. This
 * file is what folds those resolutions — and the sheet's own unfiled
 * load-bearing marks — into the draft's `body`, through `reconcile.ts`'s
 * reconciler, before the spec is ever published. Both stages are dispatched
 * by trigger over the author's collector per trigger (an accepted sheet, or
 * a closed map — ADR-0058); the critic reads only the author's output, not
 * the trigger.
 *
 * **The lane has a second entrance, and it starts at the critic.** A spec
 * written by `/to-spec` in a live session is filed by the owner's own hand
 * and arrives already drafted — so ADR-0085 gives it `runSpecCritique`
 * below, which reads the published issue and runs the *back half* of this
 * chain against it. One Opus stage where the cold doors cost two, because
 * the expensive half already happened in the session with the owner in it.
 * Both doors reach the same `gateCount` and the same `applyGate`, which is
 * the only thing lane 03 fires on.
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
 *
 * `decisions` is the *collector's*, not the model's: the sheet's own marked
 * decisions, riding out on the author's return value so that `runSpecAuthor`
 * can find its own unfiled marks — ADR-0061's arithmetic — without reading
 * the source issue a second time (a second read is a second chance for the
 * two to disagree). It is `[]` for every door that carries no marks — the
 * map collector, and a `DecidedContext` handed to `runSpecAuthor` already
 * assembled.
 */
export interface SpecAuthorOutput {
  title: string;
  body: string;
  openQuestions: string[];
  decisions: MarkedDecision[];
}

export const SPEC_AUTHOR_OUTPUT = structuredOutput(
  z.object({
    title: z.string().min(1),
    body: z.string().min(1),
    openQuestions: z.array(z.string().min(1)),
  }),
);

/**
 * The two triggers `runSpecAuthor` dispatches over — one per surviving row of
 * ADR-0058's table, each naming exactly what its collector needs and
 * nothing more. `kind` is what tells `runSpecAuthor` a `DecidedContext` was
 * *not* handed to it directly (see `isDecidedContext` below), so it doubles
 * as the discriminant a `switch` narrows on.
 *
 * ADR-0058's third row lost its collector, not its door (ADR-0085). A
 * collector exists to hand a package to a model that is not in the room, and
 * the session door now writes the spec in the room — so there is nothing to
 * assemble, and the door enters this lane at `runSpecCritique` rather than
 * here.
 */
export type SpecTrigger =
  | { kind: "sheet"; gh: GhExec; issueNumber: number }
  | { kind: "map"; gh: GhExec; issueNumber: number; repoRoot?: string };

/** A `DecidedContext` carries `ownerWords`; no `SpecTrigger` variant does. */
function isDecidedContext(input: DecidedContext | SpecTrigger): input is DecidedContext {
  return "ownerWords" in input;
}

/**
 * One collector run, normalized: the Decided context the author reads, plus
 * whatever marked decisions the trigger's own source carried.
 *
 * Only the sheet has marks. The map's collector returns a bare
 * `DecidedContext` and gets `[]` here rather than being widened to carry an
 * empty list it has nothing to fill — ADR-0058 keeps the difference between
 * triggers inside the collectors, and this is the one line where the two
 * shapes meet.
 */
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

/**
 * Runs the spec author on one Decided context, then the critic on the
 * author's own draft (ADR-0062: "the critic runs in the same chain, before
 * publication"), folds what the critic resolved — and the sheet's own
 * unfiled load-bearing marks — into the draft's body, and returns the PRD
 * payload the three together produce.
 *
 * Takes either a `DecidedContext` already assembled, or a `SpecTrigger` to
 * assemble one from first — the one entrypoint every trigger dispatches
 * through (ADR-0058: "one prompt, a collector per trigger"), so a caller
 * that already holds a `DecidedContext` never has to name which trigger
 * produced it.
 *
 * **The sweep runs first, on the collected context, and its findings
 * replace `rulings` before the author ever reads it** (`sweep.ts`): a
 * collector only ever carries what its own source happened to cite, and the
 * sweep is what goes and reads the record for whatever that source missed.
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
  const marks = unfiledMarks(collected.decisions, draft.openQuestions);
  const resolutions = [...critique.resolutions, ...marks.map(unfiledMarkResolution)];

  // A run with nothing to fold in spends no reconciler stage (ADR-0100's
  // guard, carried over rather than rediscovered) — `title` and `body` come
  // back untouched.
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
 * The tail of lane 02's chain (ADR-0062): runs `runSpecAuthor` — draft, critic and reconciler
 * already folded into one `body` — publishes the result, then gates on it.
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
 * `postOpenQuestions` comments the numbered questions on the issue, so an
 * answering comment is what `rounds.ts`'s `roundFor` counts toward the
 * next, uncapped, re-run — every load-bearing guess the sheet marked has
 * already been folded into the draft's own `## Assumptions` by
 * `runSpecAuthor`, so what remains here is only what the author itself
 * could not settle.
 *
 * Takes the same `DecidedContext | SpecTrigger` union `runSpecAuthor` does,
 * plus the `gh` every write needs — kept a separate parameter from the
 * trigger's own so a caller holding an already-assembled `DecidedContext`,
 * which carries no `gh` at all, can still be published.
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

  const { count, outcome } = gateSpec(gh, issueNumber, draft.openQuestions);

  return { ...draft, issueNumber, published: target.mode === "publish", gateCount: count, outcome };
}

/**
 * The gate itself, and the one place either door reaches it (ADR-0085): count, apply, and comment
 * the questions when the count held.
 *
 * Shared as a function rather than as a rule both doors are trusted to follow, because "the label
 * is not a second implementation of the gate" is the whole reason firing on `prd` does not undo
 * ADR-0062. `gateCount` and `applyGate` are called from here, once each, by both.
 *
 * Takes no `decisions` — ADR-0061's arithmetic still runs, but earlier: `runSpecAuthor` already
 * folded every unfiled mark into the draft's body as a stated assumption before this is ever
 * called, so a mark reaching here would double-count a guess that is no longer silent.
 */
function gateSpec(
  gh: GhExec,
  issueNumber: number,
  openQuestions: string[],
): { count: number; outcome: GateOutcome } {
  const count = gateCount(openQuestions);
  return { count, outcome: applySpecGate(gh, issueNumber, count, openQuestions) };
}

/**
 * The half of the gate that writes: `sliceable` and the dispatch at zero, the numbered round at
 * anything else.
 *
 * Split out from the count (ADR-0100) because the critique door now has work to do *between* the
 * two — the count decides whether the body is re-authored, and the re-authored body is what
 * `sliceable` must be applied to. Both doors still reach `applyGate` through here exactly once, so
 * the split moved where the count is taken and nothing about what the gate does with it.
 */
function applySpecGate(
  gh: GhExec,
  issueNumber: number,
  count: number,
  openQuestions: string[],
): GateOutcome {
  const outcome = applyGate(gh, issueNumber, count);

  if (outcome === "held") {
    postOpenQuestions(gh, issueNumber, openQuestions);
  }

  return outcome;
}

/**
 * What an unfiled sheet mark becomes for the reconciler: a stated assumption saying the sheet's
 * own recommendation was followed, with the reason nobody filed a ruling for it. Names the mark
 * so the owner can find it in `## Assumptions` the same way `CONTEXT.md`'s **Assumption mark**
 * names what it moves.
 */
function unfiledMarkResolution(decision: MarkedDecision): Resolution {
  return {
    decision: `\`${decision.mark}\` follows the sheet's own recommendation, with no ADR filed for it.`,
    reason: `The sheet decided \`${decision.mark}\` and filed no ruling for it, and the draft asks about none of it.`,
  };
}

/** What `runSpecCritique` hands back: the spec it read, what the critic resolved, and what the gate did. */
export interface SpecCritiqueResult {
  /** The already-published spec this run critiqued. */
  issueNumber: number;
  /** What the critic resolved — always folded into the body when non-empty, never left for the owner. */
  resolutions: Resolution[];
  /** `gateCount` over this door's own open questions — always `0`, since the critic never leaves one. */
  gateCount: number;
  /** `"dispatched"` at zero, `"held"` otherwise. */
  outcome: GateOutcome;
  /**
   * Whether ADR-0100's reconciler ran and rewrote the issue body.
   *
   * Reported rather than inferred from the count, because the rewrite is this door's one silent
   * write: a run that spent a second Opus stage and edited the spec looks exactly like one that
   * cleared on its first round unless the log says which it was.
   */
  rewritten: boolean;
}

/**
 * The critic-only entry into lane 02 (ADR-0085) — the back half of `runSpecPublication`'s chain,
 * run against a spec that arrived already written.
 *
 * `/to-spec` in a live session files a `prd` issue through `bin/file-issue` and stops there: no
 * critic, no reconciliation, no `sliceable`, no dispatch, and nothing anywhere knowing it is stuck,
 * because no dispatch was ever owed. This is the path that reaches the gate from that door. The
 * issue's own title and body are the draft — there is no collector and no author, because the
 * expensive half already happened in the session with the owner in it.
 *
 * Whatever answering comments already sit on the issue ride along to the critic as context it may
 * use in reaching its own decision — never as something it is waiting to be told.
 *
 * **Then what the critic resolved is written back into the body** (ADR-0100, amended by the
 * sweep-and-pen redesign; `reconcile.ts`'s module docstring is the home for why this door in
 * particular needs it). `reconcileSpec` below is what lands it, and it lands it before the gate
 * applies anything, so no reader can see `sliceable` on a stale body.
 *
 * **This door never holds.** The critic no longer leaves a finding for anyone to answer — every
 * ambiguity it raises, it resolves — so there is nothing left for `gateCount` to count and the run
 * always dispatches.
 */
export async function runSpecCritique(
  exec: StageExec,
  gh: GhExec,
  issueNumber: number,
): Promise<SpecCritiqueResult> {
  const spec = readPublishedSpec(gh, issueNumber);
  const answers = answeringComments(gh, issueNumber);
  const critique = await runSpecCritic(exec, {
    title: spec.title,
    body: spec.body,
    answers,
  });

  const rewritten = critique.resolutions.length > 0;
  if (rewritten) {
    await reconcileSpec(exec, gh, issueNumber, spec, critique.resolutions);
  }

  const outcome = applySpecGate(gh, issueNumber, 0, []);

  return { issueNumber, resolutions: critique.resolutions, gateCount: 0, outcome, rewritten };
}

/**
 * ADR-0100's re-authoring, amended by the sweep-and-pen redesign: one stage over the body and the
 * critic's own resolutions, written straight back to the issue it came from.
 *
 * Reached only when the critic resolved at least one thing, which is the caller's test rather than
 * this function's — an empty resolutions list means the draft held up, so there is nothing to fold
 * in and no stage to spend. The rewrite is deliberately not re-critiqued either: a fresh finding
 * would re-open a spec this door has already resolved, with the same critic that just resolved it.
 *
 * The title goes back unchanged and the `spec-source:v1` trailer is re-appended from the body this
 * run read, because neither is the reconciler's to change and a spec that reaches this door may
 * well carry one — a sheet spec re-labelled by hand, or an `answer` whose trailer `planSpecRun`
 * could not read.
 */
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

/**
 * The event `spec.yml` hands this file, reduced to the two facts that pick a path: which trigger
 * fired, and the issue it names.
 *
 * `sheet` arrives as ADR-0083's `repository_dispatch` after the accept has written its marker;
 * `map` arrives as the owner's `to-spec` click (ADR-0059); `answer` is a comment on a spec that is
 * already published, which is ADR-0062's re-run. `critique` is ADR-0085's second door: the owner's
 * own hand putting `prd` on a spec he wrote in a session, which arrives already drafted and so
 * files no issue and runs no author.
 */
export type SpecInvocation =
  | { trigger: "sheet"; issueNumber: number }
  | { trigger: "map"; issueNumber: number }
  | { trigger: "answer"; issueNumber: number }
  | { trigger: "critique"; issueNumber: number };

/**
 * Which of lane 02's two entrances this run takes.
 *
 * `author` is the cold path: a collector assembles a Decided context, the author drafts, the critic
 * reads the draft, and the result is published or rewritten. `critique` is ADR-0085's warm one: the
 * spec is already on the tracker, so there is nothing to collect and nothing to draft, and the run
 * starts at the critic.
 */
export type SpecPlan =
  | { path: "author"; input: SpecTrigger; target: SpecTarget }
  | { path: "critique"; issueNumber: number };

/**
 * Turns one invocation into the plan `main` carries out — the whole of the runner's
 * decision-making, kept out of `spec.yml` so it is testable without a runner and so the workflow
 * stays a trigger and an `npx tsx` line.
 *
 * The re-run reads its source back off the spec's own body (`spec-source:v1`), because a comment
 * event knows only the spec's number and the collectors all read the *source* — the accepted idea
 * or the closed map — never the spec drafted from it.
 *
 * **A spec carrying no readable source marker routes to the critic instead of throwing**
 * (ADR-0085). It used to throw, and the message was honest about the cold path's constraint and
 * wrong about this one: a spec written in a live session *is* its own source. The trailer exists
 * only because the collectors read the idea or the map rather than the spec drafted from them, and
 * this door has no such indirection. A spec published before the marker existed lands here too,
 * which is the right place for it — its body is on the tracker either way.
 */
export function planSpecRun(gh: GhExec, invocation: SpecInvocation): SpecPlan {
  if (invocation.trigger === "critique") {
    return { path: "critique", issueNumber: invocation.issueNumber };
  }

  if (invocation.trigger !== "answer") {
    const source: SpecSource = { kind: invocation.trigger, issue: invocation.issueNumber };
    return {
      path: "author",
      input: { kind: invocation.trigger, gh, issueNumber: invocation.issueNumber },
      target: { mode: "publish", source },
    };
  }

  const source = readSourceMarker(readSpecBody(gh, invocation.issueNumber));
  if (!source) {
    return { path: "critique", issueNumber: invocation.issueNumber };
  }

  return {
    path: "author",
    input: { kind: source.kind, gh, issueNumber: source.issue },
    target: { mode: "rerun", issueNumber: invocation.issueNumber, source },
  };
}

/**
 * Reads `spec.yml`'s environment into a `SpecInvocation`.
 *
 * `SPEC_TRIGGER` is set by the workflow rather than re-derived here from `GITHUB_EVENT_NAME` and a
 * label: the workflow's `if:` has already decided which of the four fired, and re-deciding it from
 * the raw event would be a second copy of that condition that could disagree with the first. That
 * matters more since ADR-0085, because two of the four are now the same `issues: labeled` event
 * and only the label tells them apart.
 */
export function invocationFromEnv(env: NodeJS.ProcessEnv): SpecInvocation {
  const trigger = env.SPEC_TRIGGER;
  const issueNumber = Number(env.ISSUE_NUMBER);

  if (
    trigger !== "sheet" &&
    trigger !== "map" &&
    trigger !== "answer" &&
    trigger !== "critique"
  ) {
    throw new Error(
      `SPEC_TRIGGER must be one of sheet, map, answer, critique — got ${JSON.stringify(trigger)}`,
    );
  }
  if (!Number.isInteger(issueNumber) || issueNumber <= 0) {
    throw new Error(`ISSUE_NUMBER must be a positive integer — got ${JSON.stringify(env.ISSUE_NUMBER)}`);
  }

  return { trigger, issueNumber };
}

async function main(): Promise<void> {
  try {
    const invocation = invocationFromEnv(process.env);
    const plan = planSpecRun(execGh, invocation);

    if (plan.path === "critique") {
      const result = await runSpecCritique(execClaude, execGh, plan.issueNumber);
      console.log(
        `critiqued #${result.issueNumber}: ${result.gateCount} open question(s), ${result.outcome}` +
          `${result.rewritten ? ", body re-authored from the critic's resolutions" : ""}`,
      );
      return;
    }

    const result = await runSpecPublication(execClaude, execGh, plan.target, plan.input);

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
