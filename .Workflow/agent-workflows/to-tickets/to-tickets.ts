import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";
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

/**
 * Local-debug entrypoint for the plan half of the pipeline: reads a plan as
 * JSON, checks it against the `Plan` schema, then runs graph validation
 * against it. Exits 0 on a well-formed plan; exits nonzero, printing the
 * offending slice and writing the failure surface, otherwise. There is no
 * repair path — a rejected plan is a failed run.
 *
 * **It takes a plan, not a transcript.** It used to be handed a stage's whole
 * raw response and dig the `<output>` block out of it. There is no such block
 * now, and nothing to dig: a stage's answer arrives already extracted, so
 * what this reads is the JSON array a stage wrote to the handoff path.
 */
export function validatePlanFile(filePath: string): Plan {
  const plan = Plan.parse(JSON.parse(readFileSync(filePath, "utf8")));
  validatePlan(plan);
  return plan;
}

/**
 * One entry in `STAGES` (below): everything `main()` needs to run a stage by
 * name, erased down to one non-generic shape so every stage — however
 * differently it's built — can sit in the same record and be dispatched
 * through the same call.
 *
 * **Type-erasure decision.** The drafted design instead kept a generic
 * `StageDef<T>` (`validate?: (output: T) => void`, among other `T`-typed
 * fields) and stored instances of it directly in the record. That doesn't
 * compile: `validate`'s parameter makes `StageDef<T>` contravariant in `T`,
 * so under `strictFunctionTypes` neither `StageDef<SeamManifest>` nor
 * `StageDef<Plan>` is assignable to the `StageDef<unknown>` a shared record
 * needs to hold both under (`TS2322`, on the seam-sweep entry too, which
 * never even sets `validate` — the incompatibility is in the optional
 * property's declared *type*, not any particular use of it).
 *
 * Lifting `validate` out of the interface and into the runner — a side
 * table `Record<StageName, (output: unknown) => void>` keyed independently —
 * was the other option on the table, and was rejected: it only relocates the
 * variance problem rather than removing it. Every `(output: T) => void` a
 * stage supplies still has to be assigned into that table's
 * `(output: unknown) => void` slot, which is the exact same contravariant
 * assignment `StageDef<T>` failed on, just moved one level out.
 *
 * What's actually chosen here is a **per-stage `run` thunk**: each stage's
 * `T` is closed over inside a closure built once, by a small generic
 * factory (`typedStage`, and the bespoke closure `AUDIT_AND_PUBLISH_RUN`
 * below it), and only that closure's *non-generic* signature —
 * `(issueNumber, exec, gh) => unknown` — ever appears in `StageDef` or
 * `STAGES`. Nothing outside a closure ever sees its `T`, so there is no
 * assignment between differently-parameterized types for the type checker
 * to reject. `runNamedStage` (below) already returned `unknown` and only
 * ever took a `TypedStageName` narrower than the full stage set — that was
 * already half of this erasure, at the export boundary; this closes the
 * other half, inside.
 */
interface StageDef {
  /**
   * Runs the stage end to end and resolves to its result, erased to
   * `unknown` — a typed stage's parsed output, or (for
   * `audit-and-publish`) the published sub-issues. `gh` is threaded through
   * every entry uniformly, for one dispatch that doesn't need to know which
   * stages use it; a typed stage's closure simply never calls it.
   *
   * The promise is `StageExec`'s (see `../shared/stage`), carried up: a
   * streaming model call cannot be awaited synchronously, and every frame
   * between it and `main()` is this one. `unknown` inside it is still
   * non-generic, so the erasure argument above is untouched — a
   * `Promise<SeamManifest>` and a `Promise<Plan>` unify under
   * `Promise<unknown>` exactly as their unwrapped forms did.
   */
  run: (issueNumber: string, exec: StageExec, gh: GhExec) => Promise<unknown>;
}

/**
 * What a schema-checked, prompt-driven stage needs to run: a committed
 * prompt, the structured-output contract its answer must satisfy, how to build
 * the `{{VAR}}` substitution map for its prompt from the CLI's `--issue`
 * value, and any validation beyond the schema (e.g. graph shape) that must
 * also pass before the stage's output is handed off. `T`-generic by design
 * — see the erasure decision above for why this type, unlike `StageDef`,
 * is allowed to stay generic: a `TypedStageConfig<T>` is only ever consumed
 * by the one `typedStage<T>(...)` call that closes over it, never stored
 * anywhere its `T` would need to unify with another stage's.
 */
interface TypedStageConfig<T> {
  promptPath: string;
  output: StructuredOutput<T>;
  buildVars: (issueNumber: string) => Record<string, string>;
  /** Throws to fail the stage; there is no repair path. */
  validate?: (output: T) => void;
  /**
   * One line about an accepted output's size, printed to the run log under
   * the stage's name. A plan-emitting stage measures its plan against the
   * `Slice` caps here (see `measurePlan`); a stage with nothing to measure
   * leaves it unset.
   */
  measure?: (output: T) => string;
}

/**
 * Shared plumbing every stage's `run` closure is built from: substitutes
 * `config`'s vars into its prompt, spawns it through the injected `exec`,
 * checkpointing under the stage's own name (`runStage`'s `options.stage`),
 * and runs any additional validation `config` declares. A bad spawn, a
 * response the schema refuses, or a failed validation all throw — there is
 * no repair path here; the caller reports and exits.
 *
 * A checkpoint hit skips the spawn but still runs `config.validate` and
 * `config.measure` against whatever it returned — a checkpointed answer gets
 * exactly the scrutiny a fresh one would, never less.
 */
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

/**
 * Builds a `StageDef` for a plain schema-checked stage: run it, log the
 * same success line every such stage has always logged, and return the
 * typed output — erased, from here out, to `unknown`. `gh` is accepted (for
 * a uniform `run` signature across every stage) but never called.
 */
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

/**
 * The six `CONTEXT.md` entries this lane works in, injected into all three
 * stage prompts as `{{VOCABULARY}}`.
 *
 * **Injected rather than read, which is the whole point of the file.** Each
 * prompt used to open with *"Read `CONTEXT.md` first"* — 13 KB of vocabulary
 * for arguing about the machine's design, fetched cold by three separate
 * headless sessions to reach the six entries a slicing actually uses (#149).
 * Worse, it fails open twice over: an instruction to read a file is something
 * a model can decline, and an unread document cannot be detected
 * ([ADR-0044](../../../docs/adr/0044-an-unread-document-cannot-be-detected-so-the-backwards-quest.md)).
 * Injection makes the vocabulary a precondition instead — `runStage`'s
 * substitution throws on a `{{VAR}}` no var covers, so a vocabulary file that
 * moved or vanished fails the stage before it spends model time rather than
 * quietly producing a plan written in the wrong words. See
 * [ADR-0082](../../../docs/adr/0082-a-lane-carries-the-vocabulary-it-works-in-rather-than-readin.md).
 *
 * It also has to be lane-owned rather than repo-owned, because this lane is
 * bound for other repos
 * ([ADR-0055](../../../docs/adr/0055-a-lane-ships-as-a-reusable-workflow-and-a-second-repo-carrie.md)):
 * a caller's `CONTEXT.md` is that repo's domain, not this pipeline's, and a
 * stage that read it would take a plumbing company's glossary as authority on
 * what a slice is.
 */
const VOCABULARY_PATH = ".Workflow/agent-workflows/to-tickets/vocabulary.md";

/**
 * Reads the lane's vocabulary — only the entries below the file's `---` rule.
 *
 * **The split is not cosmetic.** Everything above the rule explains the file
 * to a human reading it, and those sentences necessarily name `CONTEXT.md` —
 * the one document this whole arrangement exists to keep a stage away from.
 * Injecting the page whole would hand every stage a pointer to it, in a
 * paragraph arguing it is authoritative. So the human half stops at the rule.
 *
 * Both failures below name the file: "ENOENT" alone does not say which of a
 * stage's inputs went missing, and a page with no rule in it renders an
 * `undefined` vocabulary that no schema would catch — the stage would run,
 * on a prompt whose vocabulary section is empty.
 */
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
      `${VOCABULARY_PATH} has no entries below its \`---\` rule — everything above it is prose a stage must not be given`,
    );
  }
  return entries.trim();
}

/**
 * The one ticket-body contract every producer references rather than
 * restates — `docs/agents/ticket-format.md`. The slice stage is the one
 * place in this lane that drafts a ticket's shape, so it's the one stage
 * that takes it, injected as `{{TICKET_FORMAT}}` the same way `vocabulary()`
 * injects `{{VOCABULARY}}` above: an instruction to read a file is something
 * a model can decline, and `runStage`'s substitution throws on an
 * uncovered `{{VAR}}` before spending model time, which makes the contract a
 * precondition rather than a request (ADR-0044, ADR-0082).
 *
 * Only the spec-sub-issue variant travels — the core sections (`##
 * Acceptance criteria`, `## Files claimed`) plus the `### Spec sub-issue`
 * example, never the local-file, wayfinder, or question variants this lane
 * never publishes. Those extra variants would cost tokens and teach nothing:
 * this lane always runs against a real GitHub tracker
 * (`publish-issue-graph`), so it is always the spec-sub-issue shape.
 */
const TICKET_FORMAT_PATH = "docs/agents/ticket-format.md";

/**
 * Reads `docs/agents/ticket-format.md` and cuts it down to the core sections
 * plus the `### Spec sub-issue` variant — see `TICKET_FORMAT_PATH` above for
 * why only that slice of the doc travels.
 *
 * Splits on `### `, the variants' own heading marker: the first chunk is
 * everything before the first variant (the doc's title, the core `##`
 * sections, and `## Variants`'s own intro sentence), and the chunk starting
 * `Spec sub-issue` is the one variant this lane ever publishes.
 */
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
      `${TICKET_FORMAT_PATH} has no "### Spec sub-issue" variant — the slicer's ticket contract would be empty`,
    );
  }
  return `${core}\n\n### ${specSubIssue.trim()}\n`;
}

const SEAM_SWEEP_CONFIG: TypedStageConfig<SeamManifest> = {
  promptPath: ".Workflow/agent-workflows/to-tickets/seam-sweep/prompt.md",
  output: SEAM_SWEEP_OUTPUT,
  buildVars: (issueNumber) => ({ ISSUE_NUMBER: issueNumber, VOCABULARY: vocabulary() }),
};

/**
 * The slice stage consumes the seam manifest the seam-sweep stage's
 * checkpoint holds — read live here, at call time, through
 * `readPriorHandoff`, so this stage always sees whatever that stage's most
 * recent run left rather than a value captured at import time. Beyond
 * schema validation, a plan must also pass `validatePlan` (graph shape: no
 * self-reference, no cycle, no out-of-range edge, at least one unblocked
 * root) before it's handed off.
 */
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

/**
 * Reads the named upstream stage's checkpoint (`../shared/stage.ts`'s
 * `checkpointPath`) and re-validates it through that stage's own
 * `StructuredOutput`, for a stage (like slice, or audit-and-publish) whose
 * prompt needs the prior stage's answer as an input. Returns it re-serialised
 * as JSON — the same shape `{{VAR}}` substitution has always injected.
 *
 * **Reads the checkpoint, not the shared handoff.** A successful stage no
 * longer writes its accepted output to `handoffPath()` (see
 * `../shared/handoff-path.ts`) — that file is a failure surface now, nothing
 * else. Its checkpoint is the only place its answer still lives, which is
 * also what makes a retry cheap: `--stage slice` on a re-run finds the same
 * checkpoint here that a fresh `--stage seam-sweep` would have written, and
 * spawns nothing to get it.
 *
 * Wraps every read failure — missing file, invalid JSON, a response the
 * schema now refuses — with which stage needed it and where it looked,
 * since "ENOENT" alone doesn't say a prior stage never ran.
 */
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

/**
 * The third and last stage's schema-checked half: grades the slice stage's
 * plan against the same reference leaves it was drafted against —
 * granularity, edge correctness, merge/split candidates, balance — and
 * returns a plan in the same `Slice` shape, merged, split, re-edged, or
 * unchanged, alongside the grading notes that explain what it changed.
 * Graph shape is deliberately *not* re-checked here (no `validate`) because
 * `sliceAndPublish`, which this stage's plan is handed to next, already owns
 * that check before its first `gh` write — see `AUDIT_AND_PUBLISH_RUN` below.
 */
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

/**
 * The `audit-and-publish` entry's `run`: the one stage that doesn't fit
 * `typedStage` above. It threads a `GhExec` nothing else in this record
 * takes, hands the audited plan to `sliceAndPublish` — the deterministic
 * publisher's own validate → render → create → attach → wire → verify
 * pipeline — prints the auditor's grading notes to stdout (the Actions run
 * log, never a comment on the issue), and logs a distinct success line naming
 * how many sub-issues published. `sliceAndPublish`'s own `validatePlan` call
 * is what makes an audited plan that fails graph validation exit nonzero with
 * zero `gh` calls made — nothing here re-checks graph shape separately.
 *
 * Checkpointed like every other stage (`runTypedStage`'s `stage` arg), so a
 * retry after this alone failed — the other two stages' checkpoints still
 * matching the commit — spawns a model only here.
 */
const AUDIT_AND_PUBLISH_RUN: StageDef["run"] = async (issueNumber, exec, gh) => {
  const audited = await runTypedStage("audit-and-publish", AUDIT_CONFIG, issueNumber, exec);
  if (audited.notes) {
    console.log(audited.notes);
  }
  // A graph rejection is the one way left to lose an accepted plan: preserved
  // beside the checkpoint, the same bargain `preservingRaw` makes for a
  // refused response, so the plan this refuses is not simply gone.
  const published = keepingPlan(audited.slices, () =>
    sliceAndPublish(audited.slices, Number(issueNumber), gh),
  );
  console.log(
    `audit-and-publish: published ${published.length} sub-issue${published.length === 1 ? "" : "s"} under #${issueNumber}`,
  );
  return published;
};

/**
 * Runs the publish and, if it refuses the plan, writes that plan beside the
 * handoff before rethrowing with the path named — the same bargain
 * `preservingRaw` (`../shared/stage.ts`) makes for a refused response, for
 * the one rejection that happens after a response has already been accepted
 * and checkpointed.
 */
function keepingPlan<R>(plan: Plan, work: () => R): R {
  try {
    return work();
  } catch (err) {
    const path = rawResponsePath("audit-and-publish");
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(plan, null, 2), "utf8");
    throw new Error(`${reason(err)} — the audited plan is saved at ${path}`);
  }
}

/**
 * Every stage this entrypoint can run, keyed by the `--stage` name that
 * invokes it — the single place a stage is declared. `StageName`,
 * `STAGE_NAMES`, and `isStageName` all derive from this record's keys
 * below, rather than being maintained alongside it: adding a stage here (and
 * one matching step in `.github/workflows/to-tickets.yml` — see
 * `stage-registration.test.ts`) is the whole change.
 */
export const STAGES = {
  "seam-sweep": typedStage("seam-sweep", SEAM_SWEEP_CONFIG),
  slice: typedStage("slice", SLICE_CONFIG),
  "audit-and-publish": { run: AUDIT_AND_PUBLISH_RUN },
} satisfies Record<string, StageDef>;

export type StageName = keyof typeof STAGES;

export const STAGE_NAMES = Object.keys(STAGES) as StageName[];

function isStageName(value: string | undefined): value is StageName {
  return value !== undefined && Object.prototype.hasOwnProperty.call(STAGES, value);
}

/**
 * Runs one named stage end to end through its `STAGES` entry and returns its
 * result, erased to `unknown` — the caller (today, only `main()`'s `--stage`
 * branch) already knows what it asked for and only needs the exit-code and
 * logging behaviour, not the type back.
 */
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

    // One dispatch for every stage: STAGES.run() owns whatever a given
    // stage's success looks like (its own log line, and — for
    // audit-and-publish alone — the post-stage handoff to sliceAndPublish),
    // so nothing here branches on which stage this run.
    // The `await` is inside the `try` deliberately: a stage now returns a
    // promise, and a rejected promise that is merely returned rather than
    // awaited here would escape this catch entirely — the process would die
    // on an unhandled rejection having written no failure reason, and
    // `to-tickets.yml`'s reporter would comment "unknown stage" on every
    // real failure.
    try {
      // Which checkout the seam sweep, the slicer and the auditor read the codebase in.
      // `TARGET_WORKSPACE` is set only by the reusable workflow (ADR-0055): there this process runs
      // from the machine checkout, and tickets sliced against the machine's own code would be
      // tickets for the wrong repository.
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

// Only run when invoked directly (`npx tsx to-tickets.ts ...`), not when
// to-tickets.ts is imported for its exports (tests, future --stage modes).
// Built through pathToFileURL rather than a raw `file://${...}` template:
// import.meta.url is percent-encoded (spaces, etc.), and a repo checkout
// path is not guaranteed to be free of characters that encoding affects —
// this repo's own path has a space in it — so a naive string comparison
// silently never matches and main() never runs.
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((err: unknown) => {
    // A fallback for anything main() throws before its own mode-specific
    // handling runs — in practice, today, only a --validate-plan failure
    // reaches here, since the --stage branch catches and reports itself.
    // "validate-plan" is deliberately not a `STAGES` key: it names
    // to-tickets.ts's local-debug mode, not a pipeline stage the workflow
    // ever invokes with `--stage`, so it has nothing to be registered
    // alongside there.
    const detail = reason(err);
    console.error(`validate-plan failed: ${detail}`);
    writeFailure("validate-plan", detail);
    process.exitCode = 1;
  });
}
