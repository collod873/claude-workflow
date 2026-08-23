/**
 * Narrows a caught `unknown` down to the string every failure report needs:
 * an `Error`'s message, or the value's own `String()` conversion when it
 * isn't one. `catch` blocks type their binding as `unknown`, and every
 * stage that reports a failure needs this same narrowing — one copy here
 * instead of one hand-rolled ternary per call site.
 */
export function reason(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
