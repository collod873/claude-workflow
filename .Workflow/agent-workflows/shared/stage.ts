import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createStreamJsonParser } from "./stream-json";

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
 * another turn — and a stage's contract is that its **last** message is the
 * `<output>` block. The two cannot both hold: `stream-json`'s result event
 * carries the final turn's text alone, so any block, for any reason, spends
 * the stage's answer on a reply to the hook. #134's slicing died exactly
 * there, eight minutes and $1.15 in, on a suite failure the auditor had
 * nothing to do with.
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
 */
export const execClaude: StageExec = (argv, stdin) =>
  new Promise((resolve, reject) => {
    const parser = createStreamJsonParser((line) => process.stderr.write(`${line}\n`));
    const child = spawn("claude", [...withoutOutputFormat(argv), ...STREAM_FLAGS], {
      stdio: ["pipe", "pipe", "pipe"],
      env: stageEnv(),
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
}

/**
 * Runs one stage: reads `promptPath`, substitutes every `{{VAR}}`
 * placeholder in it with `vars[VAR]`, builds the `claude` argv for a single
 * headless print-mode call, and returns raw stdout via the injected `exec`.
 *
 * Throws, without calling `exec`, when the template references a
 * placeholder `vars` doesn't cover — a stage prompt with an unresolved
 * `{{VAR}}` is a wiring bug to catch here, not a partially-substituted
 * prompt to hand to a model.
 */
export async function runStage(
  promptPath: string,
  vars: Record<string, string>,
  exec: StageExec,
  options: StageOptions = {},
): Promise<string> {
  const template = readFileSync(promptPath, "utf8");
  const prompt = substitute(promptPath, template, vars);
  const model = options.model ? ["--model", options.model] : [];
  const denied = options.disallowedTools?.length
    ? ["--disallowedTools", options.disallowedTools.join(",")]
    : [];
  const flags = ["--dangerously-skip-permissions", ...model, ...denied];

  if (options.promptViaStdin) {
    return exec(["-p", ...flags], prompt);
  }

  // Named rather than left to errno. A stage that outgrows the argv limit
  // should be told to set `promptViaStdin`, not handed an ENOENT-shaped
  // failure from `spawn` that mentions nothing about its prompt.
  if (Buffer.byteLength(prompt, "utf8") > MAX_ARG_STRLEN) {
    throw new Error(
      `${promptPath} renders to ${Buffer.byteLength(prompt, "utf8")} bytes, over the ${MAX_ARG_STRLEN}-byte ` +
        "limit on a single argv element — this stage needs `promptViaStdin`",
    );
  }

  return exec(["-p", prompt, ...flags]);
}

function substitute(promptPath: string, template: string, vars: Record<string, string>): string {
  return template.replace(PLACEHOLDER, (match, name: string) => {
    if (!(name in vars)) {
      throw new Error(`${promptPath} references {{${name}}}, which no var was supplied for`);
    }
    return vars[name];
  });
}
