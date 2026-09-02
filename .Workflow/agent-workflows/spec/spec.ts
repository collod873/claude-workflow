import { pathToFileURL } from "node:url";
import { z } from "zod";
import { execGh, issueComments, type GhExec } from "../shared/gh";
import { reason } from "../shared/reason";
import { execClaudeIn, runStage, type StageExec } from "../shared/stage";
import { structuredOutput } from "../shared/structured-output";
import { readSheetMarker } from "../shape/marker";
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
import { applySweep, runSpecSweep } from "./sweep";

// Re-exported rather than wired into this file's own chain: ADR-0079's
// amendment path fires on `spec/gap`, an existing PRD's re-entry, never on
// the fresh-draft trigger this file's `SpecTrigger` union enumerates. Kept
// reachable from here anyway, since this is the module a caller already
// imports for lane 02.
export { runSpecAmendment, type SpecAmendmentResult, type SpecGapReport } from "./amend";

/**
 * Lane 02 — Spec, redesigned by #263. One hand label, `to-spec`, starts the lane whatever the
 * source: the owner applies it to an accepted idea carrying a decision sheet, or to a closed
 * Wayfinder map, the same gesture ADR-0059 already established for the map alone. The lane no
 * longer trusts which label fired to say which collector runs — `planSpecRun` reads the *issue*
 * a `to-spec` event names and picks the sheet collector when it finds a decision sheet on it,
 * the map collector otherwise. A second door, `prd`, still feeds the critic alone (ADR-0085): the
 * owner's own hand putting `prd` on a spec he already wrote in a live session.
 *
 * **Every run that gets as far as the gate dispatches.** #263 deletes the round counter, the
 * posted open-questions comment and the comment-triggered re-run: a run whose author or critic
 * left something unresolved used to hold, post the numbered questions, and wait on the owner's
 * answer to re-run. Now `gateSpec` labels the spec `sliceable` and asks for the dispatch
 * regardless of what `gateCount` reports — what a run could not settle reaches the owner as a
 * stated assumption in the spec's own body (folded in by the reconciler, `reconcile.ts`), never
 * as a question held open on the tracker.
 *
 * **A source whose spec already dispatched is refused before a model runs.** `planSpecRun`
 * searches the published specs for one recording this issue as its source and already carrying
 * `sliceable`, and throws before the collector, the sweep, the author or the critic ever spend
 * anything — a second `to-spec` on the same idea or map is a no-op, not a second spec.
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
 * The two collectors `runSpecAuthor` dispatches over — one per source kind `planSpecRun` can
 * detect on the issue a `to-spec` event names, each naming exactly what its collector needs and
 * nothing more. `kind` is what tells `runSpecAuthor` a `DecidedContext` was *not* handed to it
 * directly (see `isDecidedContext` below), so it doubles as the discriminant a `switch` narrows on.
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
      stage: "author",
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
  /** The `PRD:` issue this run published. */
  issueNumber: number;
  /** How much `open-questions.ts`'s `gateCount` found unresolved in the folded `openQuestions` — reported, never gated on. */
  gateCount: number;
  /** Always `"dispatched"` (#263) — `open-questions.ts`'s `applyGate` outcome. */
  outcome: GateOutcome;
}

/**
 * The tail of lane 02's cold door: runs `runSpecAuthor` — draft, critic and reconciler already
 * folded into one `body` — publishes the result as a new `PRD:` issue recording `target` as its
 * source, then gates on it.
 *
 * Publication is unconditional and comes first, which is ADR-0062's step 1 read literally: the
 * spec carries `prd` whatever the author or critic left unresolved. Since #263 the gate that
 * follows is unconditional too — `sliceable` and the dispatch, every time, whatever `gateCount`
 * reports — so publication no longer anticipates a "held" outcome that does not exist.
 *
 * Takes the same `DecidedContext | SpecTrigger` union `runSpecAuthor` does, plus the `gh` every
 * write needs and the `target` recording where this spec came from, kept separate from the
 * trigger's own so a caller holding an already-assembled `DecidedContext` can still be published.
 */
export async function runSpecPublication(
  exec: StageExec,
  gh: GhExec,
  target: SpecSource,
  input: DecidedContext | SpecTrigger,
): Promise<SpecPublicationResult> {
  const draft = await runSpecAuthor(exec, input);

  const issueNumber = publishSpec(gh, draft, target);
  const { count, outcome } = gateSpec(gh, issueNumber, draft.openQuestions);

  return { ...draft, issueNumber, gateCount: count, outcome };
}

/**
 * The gate itself, and the one place either door reaches it: count (for the log line), then apply
 * unconditionally.
 *
 * Shared as a function rather than as a rule both doors are trusted to follow — `gateCount` and
 * `applyGate` are called from here, once each, by both.
 *
 * Takes no `decisions` — ADR-0061's arithmetic still runs, but earlier: `runSpecAuthor` already
 * folded every unfiled mark into the draft's body as a stated assumption before this is ever
 * called, so a mark reaching here would double-count a guess that is no longer silent.
 */
function gateSpec(gh: GhExec, issueNumber: number, openQuestions: string[]): { count: number; outcome: GateOutcome } {
  const count = gateCount(openQuestions);
  return { count, outcome: applyGate(gh, issueNumber, count) };
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
  /** Always `"dispatched"` (#263). */
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
 * Whatever comments already sit on the issue ride along to the critic as context it may use in
 * reaching its own decision — never as something it is waiting to be told, and never filtered: with
 * the round loop gone (#263) nothing on this issue's comment list is this lane's own writing.
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
 * well carry one — a sheet spec re-labelled by hand, or one filed before this door's own guard
 * existed.
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
 * Which collector a source issue's own content calls for — the property #263 asks `planSpecRun` to
 * have instead of trusting the label that fired it: a decision sheet on the issue (`shape/marker.ts`'s
 * own marker, the same one `collectSheetContext` reads) means the sheet collector, anything else
 * means the map collector. There is no third kind on the cold door, so a map is what is left when a
 * sheet is absent rather than a thing detected of its own.
 */
function detectSourceKind(gh: GhExec, issueNumber: number): SpecSource["kind"] {
  const hasSheet = issueComments(gh, issueNumber).some((body) => readSheetMarker(body) !== undefined);
  return hasSheet ? "sheet" : "map";
}

interface RawSpecIssue {
  body?: string;
  labels?: Array<{ name?: string }>;
}

/**
 * Whether some published spec already records `sourceIssue` as its source and already carries
 * `sliceable` — #263's refusal, read off the tracker rather than off this run's own arguments, so a
 * second `to-spec` on the same idea or map is refused before the collector, the sweep, the author or
 * the critic spend anything at all.
 *
 * Searched by the `prd` label rather than by source, because the source lives inside each spec's own
 * `spec-source:v1` trailer (`publish.ts`) and there is no tracker query that reaches into a body.
 */
function alreadySliced(gh: GhExec, sourceIssue: number): boolean {
  const raw = gh(["issue", "list", "--label", PRD_LABEL, "--state", "all", "--limit", "200", "--json", "number,body,labels"]);
  const issues = JSON.parse(raw) as RawSpecIssue[];

  return issues.some((issue) => {
    const labels = (issue.labels ?? []).map((label) => label.name ?? "");
    if (!labels.includes(SLICEABLE_LABEL)) return false;
    return readSourceMarker(issue.body ?? "")?.issue === sourceIssue;
  });
}

/**
 * The event `spec.yml` hands this file, reduced to the two facts that pick a path: which door
 * fired, and the issue it names.
 *
 * `to-spec` is #263's single cold-door label, applied by hand to an accepted idea or a closed map
 * alike (ADR-0059's gesture, now the only one). `critique` is ADR-0085's warm door: the owner's own
 * hand putting `prd` on a spec he wrote in a session, which arrives already drafted and so files no
 * issue and runs no author.
 */
export type SpecInvocation = { trigger: "to-spec"; issueNumber: number } | { trigger: "critique"; issueNumber: number };

/**
 * Which of lane 02's two entrances this run takes, and — on the cold door — which collector the
 * source issue itself calls for.
 */
export type SpecPlan = { path: "author"; input: SpecTrigger; target: SpecSource } | { path: "critique"; issueNumber: number };

/**
 * Turns one invocation into the plan `main` carries out — the whole of the runner's
 * decision-making, kept out of `spec.yml` so it is testable without a runner and so the workflow
 * stays a trigger and an `npx tsx` line.
 *
 * On the cold door: refuses a source whose spec already dispatched (`alreadySliced`, before
 * anything spends a model), then reads the issue itself to pick sheet or map
 * (`detectSourceKind`) — never the label that fired this run, since one label now starts the lane
 * for both.
 */
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
    // `repoRoot` only means anything to the map collector (`collectMapContext`'s own default is
    // `process.cwd()`, read at the collector rather than here) — the sheet collector reads nothing
    // off disk, so passing it unconditionally would be a field the sheet variant carries and
    // ignores.
    input: kind === "map" ? { kind, gh, issueNumber: invocation.issueNumber, repoRoot } : { kind, gh, issueNumber: invocation.issueNumber },
    target: { kind, issue: invocation.issueNumber },
  };
}

/**
 * Reads `spec.yml`'s environment into a `SpecInvocation`.
 *
 * `SPEC_TRIGGER` is set by the workflow rather than re-derived here from `GITHUB_EVENT_NAME` and a
 * label: the workflow's `if:` has already decided which of the two fired, and re-deciding it from
 * the raw event would be a second copy of that condition that could disagree with the first. Both
 * doors fire on the same `issues: labeled` event and are told apart only by which label arrived.
 */
export function invocationFromEnv(env: NodeJS.ProcessEnv): SpecInvocation {
  const trigger = env.SPEC_TRIGGER;
  const issueNumber = Number(env.ISSUE_NUMBER);

  if (trigger !== "to-spec" && trigger !== "critique") {
    throw new Error(`SPEC_TRIGGER must be one of to-spec, critique — got ${JSON.stringify(trigger)}`);
  }
  if (!Number.isInteger(issueNumber) || issueNumber <= 0) {
    throw new Error(`ISSUE_NUMBER must be a positive integer — got ${JSON.stringify(env.ISSUE_NUMBER)}`);
  }

  return { trigger, issueNumber };
}

async function main(): Promise<void> {
  // Which checkout the author and the critic read the codebase in. `TARGET_WORKSPACE` is set only
  // by the reusable workflow (ADR-0055): there this process runs from the machine checkout, and a
  // spec written about the machine's own code is a spec about the wrong repository.
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
