import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { handoffPath } from "./handoff-path";
import { reason } from "./reason";
import { createStreamJsonParser } from "./stream-json";
import { rejectedResponse, type StructuredOutput } from "./structured-output";

/**
 * One `claude` invocation, as its argv (not including the `claude` binary
 * itself), resolving to stdout as a string. The only seam through which a
 * stage spawns a model — every stage and the local-debug entrypoint go
 * through this, so injecting a fake here is what lets a test assert on
 * prompt substitution and argv shape without launching one.
 *
 * **Why this is a promise.** It was `(argv: string[]) => string` until a
 * streaming `execClaude` needed it not to be: a call that reports progress
 * while the model is still thinking has to read the child's stdout as it
 * arrives, and nothing that blocks until exit can do that. The `async`
 * here is load-bearing on that one implementation; every fake in the tests
 * is still a one-liner that resolves a canned response.
 */
export type StageExec = (argv: string[], stdin?: string) => Promise<string>;

/**
 * Linux caps a **single** argv element at `MAX_ARG_STRLEN` — 32 pages, 128 KiB
 * — independently of the much larger total-argv limit. A prompt handed to
 * `claude` as `-p <prompt>` is one element, so a stage whose prompt inlines
 * files hits this and dies on `spawn claude E2BIG`, an error naming neither
 * the prompt nor the size.
 *
 * Stages that inline files pass their prompt on stdin instead
 * (`promptViaStdin`). Every other stage is checked against this before the
 * spawn, so the failure is a named one rather than an errno.
 */
const MAX_ARG_STRLEN = 32 * 4096;

/**
 * The wire format this executor imposes, replacing whatever the caller
 * asked for. `--verbose` is not optional decoration: `stream-json` in print
 * mode is rejected without it.
 *
 * Imposed rather than merged because `StageExec`'s contract is "the model's
 * final text", not "the bytes the CLI printed" — how that text crosses the
 * pipe is this function's business, and every caller already gets the same
 * string back either way. `observations/auditor.ts`'s `SANDBOX_FLAGS` asks
 * for `--output-format text`; it is dropped here rather than edited there,
 * because that list is documented as ported verbatim from Lumaria and not
 * to be re-derived.
 */
const STREAM_FLAGS = ["--output-format", "stream-json", "--verbose"];

/**
 * The marker that tells this repo's own Claude Code hooks they are inside a
 * stage rather than a turn somebody is having (CONTEXT.md: *one agent process
 * in a pipeline run*). `.claude/hooks/gauntlet-hook.mjs` reads it and stays
 * silent.
 *
 * It exists because the turn-end venue is designed to make Claude keep
 * working — `decision: "block"` hands the failing checks back and asks for
 * another turn — and a stage is spawned to answer one question and stop.
 * #134's slicing died exactly there, eight minutes and $1.15 in, on a suite
 * failure the auditor had nothing to do with: the block spent the auditor's
 * last turn arguing about a red suite it had not caused, and the stage's
 * answer went with it.
 *
 * Structured output narrows what that costs — the answer now lands as a tool
 * call rather than as the final turn's text — but it does not make the block
 * harmless: a stage handed unrelated failing checks still spends model time
 * and tokens on them, and still has nowhere to put a fix, since the stage
 * edits nothing.
 *
 * A stage's checks are not skipped by this — they run in `verify.yml`, at the
 * venue that can actually fail a run. What is removed is a venue whose only
 * reader is a model that cannot act on it.
 */
const STAGE_SESSION_VAR = "WORKFLOW_STAGE";

/** `process.env` plus the stage marker, for the `claude` a stage spawns. */
function stageEnv(): NodeJS.ProcessEnv {
  return { ...process.env, [STAGE_SESSION_VAR]: "1" };
}

/**
 * The real StageExec: shells out to the `claude` CLI headlessly, in
 * print mode, with permission prompts skipped — there is no human on the
 * other end of a runner job to answer one. Requires
 * `CLAUDE_CODE_OAUTH_TOKEN` in the environment; the caller is responsible
 * for refusing before this runs when it's empty (the workflow's preflight
 * step in `.github/workflows/to-tickets.yml`).
 *
 * **Why this streams.** It used to be one `execFileSync` call, which meant
 * the runner log stayed empty for however long the model ran and then
 * printed everything at once — a stage mid-run and a stage hung looked
 * identical, and the only evidence a refused run left was the one-line
 * reason (#42). Now each event is rendered to stderr as it arrives, so the
 * Actions log shows which tool a stage is on. It also removes the 64MB
 * `maxBuffer` ceiling that used to turn a long session into an ENOBUFS
 * crash that discarded the response along with it: only the final text is
 * held, not the transcript.
 *
 * **`cwd` is which repository the model is looking at**, and it is a
 * parameter rather than an assumption because the two stopped being the same
 * directory under ADR-0055: a reusable lane runs from the machine checkout
 * and builds the *target* one, and a stage that holds Edit, Write and Bash —
 * lane 05's implementer is the one that does — would otherwise read and edit
 * the pipeline it is running rather than the repository it was dispatched
 * for. Omitted means "this process's own cwd", which is what every lane
 * running against its own checkout wants — a workstation run, and every
 * test that drives the real executor.
 */
export const execClaudeIn =
  (cwd?: string): StageExec =>
  (argv, stdin) =>
  new Promise((resolve, reject) => {
    const parser = createStreamJsonParser((line) => process.stderr.write(`${line}\n`));
    const child = spawn("claude", [...withoutOutputFormat(argv), ...STREAM_FLAGS], {
      stdio: ["pipe", "pipe", "pipe"],
      env: stageEnv(),
      cwd,
    });

    // A child that is already gone has no read end on this pipe, and the write
    // below lands as EPIPE — a `claude` that died on a bad token, or one that
    // answered and exited while the parent was still writing, which is a race
    // rather than a rare case: the suite hits it whenever the machine is busy
    // enough (#134, reproduced on two cores). `stdin` has no default error
    // handler, so that arrives as an unhandled `'error'` event, and an
    // unhandled `'error'` event is a *process crash* — the stage dies on a
    // Node stack trace instead of the named failure every other death here
    // produces. Kept rather than swallowed: a prompt that never landed is why
    // the response is missing, and the rejection below says so.
    let stdinError: Error | undefined;
    child.stdin.on("error", (err: Error) => {
      stdinError = err;
    });

    // `claude -p` with no positional prompt reads one from stdin, which is the
    // only way past MAX_ARG_STRLEN for a stage that inlines files.
    //
    // Closed either way, and immediately: the CLI waits for EOF before it
    // starts, so a pipe left open is a hang rather than a slow start. A stage
    // that passes its prompt on argv gets an empty stdin rather than a closed
    // fd, which the CLI treats identically — checked against the real binary
    // before this was written, in both directions.
    child.stdin.end(stdin ?? "", "utf8");

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => parser.push(chunk));

    // The child's own stderr is kept rather than inherited so it can be
    // named in the rejection — `execFileSync` used to fold it into the
    // thrown error, and a stage that dies with an empty reason is the
    // failure mode this whole change exists to remove. It is echoed as it
    // arrives too, so a run that hangs still shows whatever the CLI said.
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
      process.stderr.write(chunk);
    });

    child.on("error", (err) => reject(new Error(`could not spawn \`claude\`: ${err.message}`)));

    child.on("close", (code) => {
      const { text, isError, missingResult } = parser.end();
      // Only on the failing paths. A response that arrived is a response, and
      // a stub that answers without reading its stdin is the ordinary shape in
      // the suite, not something to report.
      const prompt = stdinError === undefined ? "" : ` (the prompt never reached it: ${stdinError.message})`;
      if (code !== 0) {
        reject(new Error(`\`claude\` exited ${code}${prompt}${tail(stderr)}`));
        return;
      }
      if (isError) {
        reject(new Error(`\`claude\` reported the run as failed${prompt}${tail(stderr)}`));
        return;
      }
      if (missingResult) {
        reject(new Error(`\`claude\` produced no result event${prompt}${tail(stderr)}`));
        return;
      }
      resolve(text);
    });
  });

/**
 * Drops a caller-supplied `--output-format <value>` pair, so `STREAM_FLAGS`
 * is the only one on the argv. A CLI handed the flag twice is free to
 * honour either, and a stage whose response arrived in a format its parser
 * didn't expect would fail somewhere far from the cause.
 */
function withoutOutputFormat(argv: string[]): string[] {
  const kept: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--output-format") {
      i += 1; // also skip its value
      continue;
    }
    kept.push(argv[i]);
  }
  return kept;
}

/** The last of the child's stderr, for a rejection that would otherwise name only an exit code. */
function tail(stderr: string, limit = 2000): string {
  const trimmed = stderr.trim();
  if (trimmed === "") return "";
  const kept = trimmed.length <= limit ? trimmed : `…${trimmed.slice(-limit)}`;
  return `: ${kept}`;
}

const PLACEHOLDER = /\{\{(\w+)\}\}/g;

/**
 * Where a checkpoint (`<stage>.json`) is written and read from — a run's own
 * directory, distinct from `handoffPath()`'s (a *failure* surface, and one
 * every lane shares whether or not it checkpoints). `CHECKPOINTS_DIR`
 * mirrors `FAILURE_REASON_PATH`'s shape for the same reason: a runner job and
 * a local debug run need to agree on where it is without either hardcoding
 * the other's path, and a test needs to point it somewhere private without
 * touching this repo's own checkout.
 */
const DEFAULT_CHECKPOINTS_DIR = ".Workflow/agent-workflows/checkpoints";

function checkpointsDir(): string {
  return process.env.CHECKPOINTS_DIR || DEFAULT_CHECKPOINTS_DIR;
}

/**
 * `<stage>.json` under the checkpoints dir. Exported so a lane can read a
 * sibling stage's checkpoint directly — `to-tickets.ts`'s `readPriorHandoff`
 * reads the upstream stage's file this way, the same file that stage's own
 * `runStage` call last wrote.
 */
export function checkpointPath(stage: string): string {
  return join(checkpointsDir(), `${stage}.json`);
}

/**
 * Where a stage's rejected raw response is kept: beside the handoff file,
 * named for the stage. A sibling rather than the handoff path itself
 * because that one file is the failure *reason*, which the workflow's
 * `if: failure()` reporter reads and comments — a raw model response
 * written there would be the comment.
 */
export function rawResponsePath(stage: string): string {
  return join(dirname(handoffPath()), `${stage}-raw-response.txt`);
}

/**
 * What a checkpoint is keyed on: this stage's fully substituted prompt,
 * paired with the commit it ran against, hashed down to one string. A retry
 * against the same commit with the same prompt reuses the answer; a new
 * commit, or a prompt an edit changed, is a miss rather than a stale hit.
 *
 * `undefined` when the commit can't be named — no `git`, or a directory
 * that isn't a checkout — which the caller treats as "uncomputable" and
 * spawns rather than guess at a key nothing could ever match twice.
 */
function checkpointKey(prompt: string): string | undefined {
  let sha: string;
  try {
    sha = execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
      // The "no checkout" case is this function's documented `undefined`, not an error anyone
      // needs told about — but `execFileSync` echoes the child's stderr on top of capturing it,
      // so without this the caller prints `fatal: not a git repository` and then handles it.
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {
    return undefined;
  }
  return createHash("sha256").update(sha).update("\0").update(prompt).digest("hex");
}

/** What a checkpoint file holds on disk: the key it's good for, and the model's raw response — exactly what `exec` returned, so a read re-validates through the same `output.parse` a live call would. */
interface CheckpointEnvelope {
  key: string;
  response: string;
}

function isCheckpointEnvelope(value: unknown): value is CheckpointEnvelope {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { key: unknown }).key === "string" &&
    typeof (value as { response: unknown }).response === "string"
  );
}

/**
 * A stage's checkpointed answer, re-validated through `output.parse` — or
 * `undefined` for every way this fails open: no checkpoints dir yet, a
 * checkpoint that can't be read or isn't valid JSON, one shaped wrong, one
 * keyed for a different prompt or commit, or a commit that can't be named at
 * all. Fail-open by design — in an unattended pipeline a checkpoint this
 * can't confidently reuse still has to let the stage run, not refuse it
 * (CONTEXT.md: *fail-open*).
 *
 * A checkpoint that *does* match is not trusted blindly either: `parse` runs
 * the same schema a live response goes through, so a hand-edited or
 * corrupted-but-still-JSON file still has to pass it — and a refusal there
 * fails open like every other, rather than throwing. Re-validation exists to
 * catch a checkpoint whose shape no longer fits the stage that would reuse it,
 * which is what a schema change between a run and its retry produces; if that
 * rejection killed the run instead of spawning the model, widening a schema
 * would wedge every retry until someone deleted the file by hand — the exact
 * failure checkpoints are here to prevent.
 */
function loadCheckpoint<T>(stage: string, prompt: string, output: StructuredOutput<T>): T | undefined {
  const key = checkpointKey(prompt);
  if (key === undefined) return undefined;

  let raw: string;
  try {
    raw = readFileSync(checkpointPath(stage), "utf8");
  } catch {
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }

  if (!isCheckpointEnvelope(parsed) || parsed.key !== key) return undefined;

  try {
    return output.parse(parsed.response);
  } catch {
    return undefined;
  }
}

/**
 * Persists a stage's accepted response as its checkpoint, keyed on the same
 * prompt+commit pair a later run would recompute. Silently skipped — never
 * thrown — when the commit can't be named, or when the write itself fails
 * (an unwritable checkpoints dir, a path a stray directory is squatting on):
 * fail-open cuts both ways, and a stage whose *answer* is good must not fail
 * on the write of a cache entry nothing downstream needs to succeed.
 */
function writeCheckpoint(stage: string, prompt: string, response: string): void {
  const key = checkpointKey(prompt);
  if (key === undefined) return;
  try {
    const path = checkpointPath(stage);
    mkdirSync(dirname(path), { recursive: true });
    const envelope: CheckpointEnvelope = { key, response };
    writeFileSync(path, JSON.stringify(envelope), "utf8");
  } catch {
    // Fail open — see above.
  }
}

/**
 * Runs the part of a stage that can reject the model's response, and — if
 * it does — writes that response to `rawResponsePath(stage)` before
 * rethrowing with the path named. An error that carries no response — a dead
 * CLI, a bad spawn — is rethrown untouched.
 *
 * This exists because #42 could not be diagnosed from the run that raised
 * it. Run 32677530530 spent two minutes of real model time and left exactly
 * one line, `response has 2 <output> blocks`; the response those blocks were
 * counted in died with the stack, so the only way to see what the model
 * actually sent was to spend the two minutes again locally and hope the
 * failure recurred. A stage that refuses a response and discards it is the
 * shape #41 names — a mechanism that fails without telling anyone — and the
 * cost lands on whoever has to reproduce it rather than on the run that
 * already had the evidence in hand.
 *
 * Only the rejection paths write: a stage that succeeds leaves no file, so
 * the presence of one is itself the signal.
 */
async function preservingRaw<R>(stage: string, work: () => Promise<R>): Promise<R> {
  try {
    return await work();
  } catch (err) {
    const raw = rejectedResponse(err);
    if (raw === undefined) throw err;
    const path = rawResponsePath(stage);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, raw, "utf8");
    throw new Error(`${reason(err)} — the model's raw response is saved at ${path}`);
  }
}

/** Per-stage overrides of how the model is invoked. */
export interface StageOptions {
  /**
   * The model id this stage runs on, when it is not the session default —
   * each lane is assigned a tier, and a stage whose tier is cheaper than the
   * default has to say so or it silently costs more than the lane was
   * budgeted for. Omitted means "whatever the CLI defaults
   * to", which is what every to-tickets stage wants.
   */
  model?: string;
  /**
   * Tools this stage may not use, passed to the CLI's `--disallowedTools`.
   *
   * Exists for
   * [ADR-0030](../../../docs/adr/0030-the-shaper-is-given-a-prepared-context-and-no-search-tools.md),
   * which takes lane 01's shaper off search entirely: *with no search tools,
   * "never free-roams" is a fact about what the stage can do rather than a
   * line it was asked to honour.* A prohibition written in a prompt is
   * something a model can talk itself past; a deny list is not.
   *
   * **Its ceiling, stated rather than assumed.** This names tools, so a tool
   * the CLI gains after this list was written is reachable by a stage that
   * denies everything on it. The list is therefore checked by a test against
   * the stage that depends on it, and the honest claim is "denies the tools
   * that exist", not "denies all tools".
   */
  disallowedTools?: string[];
  /**
   * The only tools this stage may use, passed to the CLI's `--allowedTools`.
   *
   * Exists for
   * [ADR-0060](../../../docs/adr/0060-the-spec-author-reads-the-repo-through-an-allow-list-and-can.md),
   * which binds the spec author to `Read`, `Grep` and `Glob` and nothing
   * else: it has to keep three tools rather than deny everything, and an
   * enumeration of everything else would silently regain a fourth reach the
   * CLI adds later. An allow list fails closed instead — a tool that does not
   * exist yet is not on it, so the failure mode of being out of date is a
   * stage that cannot do something, not one that silently can.
   *
   * Mutually exclusive with `disallowedTools`: one names *these and no
   * others*, the other names *everything but these* — a stage means one or
   * the other, never both, and `runStage` refuses a call that sets both
   * rather than send the CLI two conflicting claims about the same toolbelt.
   */
  allowedTools?: string[];
  /**
   * Hand the prompt to the CLI on stdin rather than as `-p <prompt>`.
   *
   * Required for any stage whose prompt inlines file contents: a single argv
   * element is capped at `MAX_ARG_STRLEN` (128 KiB), and lane 01's shaper
   * injects `CONTEXT.md`, `CODING_STANDARDS.md` and a reading list ADR-0030
   * deliberately left uncapped — so the prompt has no upper bound by
   * construction, not merely no measured one. Without this the stage dies on
   * `spawn claude E2BIG`, which names neither the prompt nor the size, and it
   * does so only for the ideas whose reading lists happened to be long.
   */
  promptViaStdin?: boolean;
  /**
   * This stage's identity for checkpointing and raw-response preservation —
   * both are keyed on it. Required: #274 made every `runStage` call site name
   * its stage explicitly (`lane-stage-names.test.ts` pins the ten it
   * migrated), so there is no longer a call site left for an omitted name to
   * quietly opt out of either mechanism.
   */
  stage: string;
}

/**
 * Runs one stage and returns its typed answer: reads `promptPath`,
 * substitutes every `{{VAR}}` placeholder in it with `vars[VAR]`, builds the
 * `claude` argv for a single headless print-mode call — `output`'s JSON
 * Schema among the flags — and validates what comes back through
 * `output.parse`.
 *
 * **Every stage goes through the structured-output path.** There is no
 * untyped variant, deliberately: a stage that answered in prose would be a
 * stage whose answer nothing checks, which is the failure this seam was
 * rebuilt to remove. `--json-schema` reaching the argv is therefore a
 * property of `runStage` itself rather than of each call site remembering to
 * ask, and `stage.test.ts` pins it there.
 *
 * Throws, without calling `exec`, when the template references a
 * placeholder `vars` doesn't cover — a stage prompt with an unresolved
 * `{{VAR}}` is a wiring bug to catch here, not a partially-substituted
 * prompt to hand to a model.
 *
 * **Checkpointing.** Before spawning, a checkpoint keyed on this stage's
 * substituted prompt and the current commit is looked up; a match skips
 * `exec` entirely and returns the checkpointed answer re-validated through
 * `output.parse`. A miss — for any reason, see `loadCheckpoint` — spawns as
 * usual, and an accepted answer is checkpointed for the next call to find. A
 * rejected response is preserved the same way it always was
 * (`preservingRaw`), just relocated here from its one caller.
 */
export async function runStage<T>(
  promptPath: string,
  vars: Record<string, string>,
  exec: StageExec,
  output: StructuredOutput<T>,
  options: StageOptions,
): Promise<T> {
  if (options.allowedTools?.length && options.disallowedTools?.length) {
    throw new Error(
      "StageOptions set both allowedTools and disallowedTools — pick one: allowedTools says " +
        "'these and no others', disallowedTools says 'everything but these'",
    );
  }

  const template = readFileSync(promptPath, "utf8");
  const prompt = substitute(promptPath, template, vars);

  const stage = options.stage;
  const cached = loadCheckpoint(stage, prompt, output);
  if (cached !== undefined) return cached;

  const model = options.model ? ["--model", options.model] : [];
  const denied = options.disallowedTools?.length
    ? ["--disallowedTools", options.disallowedTools.join(",")]
    : [];
  const allowed = options.allowedTools?.length
    ? ["--allowedTools", options.allowedTools.join(",")]
    : [];
  const flags = [
    "--dangerously-skip-permissions",
    "--json-schema",
    output.jsonSchema,
    ...model,
    ...denied,
    ...allowed,
  ];

  const spawnAndParse = async (): Promise<T> => {
    let responseText: string;
    if (options.promptViaStdin) {
      responseText = await exec(["-p", ...flags], prompt);
    } else {
      // Named rather than left to errno. A stage that outgrows the argv limit
      // should be told to set `promptViaStdin`, not handed an ENOENT-shaped
      // failure from `spawn` that mentions nothing about its prompt.
      if (Buffer.byteLength(prompt, "utf8") > MAX_ARG_STRLEN) {
        throw new Error(
          `${promptPath} renders to ${Buffer.byteLength(prompt, "utf8")} bytes, over the ${MAX_ARG_STRLEN}-byte ` +
            "limit on a single argv element — this stage needs `promptViaStdin`",
        );
      }
      responseText = await exec(["-p", prompt, ...flags]);
    }
    const value = output.parse(responseText);
    writeCheckpoint(stage, prompt, responseText);
    return value;
  };

  return preservingRaw(stage, spawnAndParse);
}

function substitute(promptPath: string, template: string, vars: Record<string, string>): string {
  return template.replace(PLACEHOLDER, (match, name: string) => {
    if (!(name in vars)) {
      throw new Error(`${promptPath} references {{${name}}}, which no var was supplied for`);
    }
    return vars[name];
  });
}
