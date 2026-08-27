/**
 * Narrows a caught `unknown` down to the string every failure report needs:
 * an `Error`'s message, or the value's own `String()` conversion when it
 * isn't one. `catch` blocks type their binding as `unknown`, and every
 * stage that reports a failure needs this same narrowing — one copy here
 * instead of one hand-rolled ternary per call site.
 *
 * **Plus the child's stdout, when the failure came from one.** `execFileSync`
 * folds a child's *stderr* into the `Error`'s message and leaves its stdout on
 * a separate field, which is the wrong half for any tool that reports through
 * stdout — and the two this estate leans on hardest both do. `bin/gauntlet`
 * prints *which check failed* there, so a `pre-push` hook refusing a push
 * surfaced as `error: failed to push some refs` and not one word about why;
 * finding the cause meant re-running the gate by hand somewhere else. A report
 * that omits the half saying what went wrong is the same defect as no report,
 * and it is expensive in exactly the places there is no one to ask.
 */
export function reason(err: unknown): string {
  const message = errorMessage(err);
  const output = childStdout(err);
  return output === undefined ? message : `${message}\n${output}`;
}

/**
 * The narrowing alone, without the child's stdout — for the callers that
 * **match on** a failure rather than report it.
 *
 * The two jobs looked like one until `reason` grew the stdout half. A report
 * wants every scrap of what went wrong; a classifier wants the smallest string
 * that can carry its signal, because everything else in the haystack is
 * something that might one day look like a match. `notes-sync`'s
 * `isRejection` is the case in hand: it tells a retryable `! [rejected]` race
 * apart from failures that must surface, git writes that line to stderr, and
 * `execFileSync` already folds stderr into the message — so widening it to a
 * hook's stdout could only ever cause a false match on a failure that deserved
 * to be seen.
 */
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * How much of a child's stdout a report keeps. These strings reach GitHub issue
 * comments, which are cut off at 65536 characters — a truncated report is
 * survivable, a comment the API refuses outright is not. The tail rather than
 * the head, because a check runner prints its findings last.
 */
const STDOUT_TAIL = 4000;

/**
 * The child process stdout carried on a caught `execFileSync`/`spawnSync`
 * error, trimmed and capped, or `undefined` when there is none to add — which
 * is every error a test fake throws, so this changes nothing about how a fake
 * failure reads.
 *
 * `Uint8Array` rather than `Buffer`: a seam that forgot `encoding` hands back
 * bytes, and `Buffer` extends `Uint8Array`, so this covers both without this
 * module having to reach for a Node global.
 */
function childStdout(err: unknown): string | undefined {
  const raw = (err as { stdout?: unknown } | null | undefined)?.stdout;
  const text =
    typeof raw === "string" ? raw : raw instanceof Uint8Array ? new TextDecoder().decode(raw) : "";

  const trimmed = text.trim();
  if (trimmed === "") return undefined;
  return trimmed.length > STDOUT_TAIL ? `…\n${trimmed.slice(-STDOUT_TAIL)}` : trimmed;
}
