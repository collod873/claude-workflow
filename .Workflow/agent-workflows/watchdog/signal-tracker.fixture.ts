/**
 * @fixture Reached only from the suites, by design.
 */
export function answerTracker(args: string[], issues: readonly object[]): string | undefined {
  if (args[0] === "issue" && args[1] === "list") return JSON.stringify(issues);
  if (args[0] === "issue" && args[1] === "create") return "https://github.com/owner/repo/issues/42\n";
  return undefined;
}

/**
 * @fixture Reached only from the suites, by design.
 */
export function answerTrackerOrThrow(args: string[], issues: readonly object[]): string {
  const answered = answerTracker(args, issues);
  if (answered !== undefined) return answered;
  throw new Error(`fake gh: unhandled argv: ${JSON.stringify(args)}`);
}
