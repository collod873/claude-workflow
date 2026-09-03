/**
 * The tracker half every watchdog `gh` stand-in shares: `issue list` answers `issues` as the
 * tracker would, and `issue create` files issue #42. `undefined` for anything else, so a caller
 * composes it in with a plain `??` ahead of its own answers — the way `simulateClaimRef` in
 * `shared/gh.fake.ts` is composed — and keeps only the part that differs: which runs and jobs
 * the sweep sees.
 *
 * `bypass.test.ts`, `run-watchdog.test.ts`, `lost-dispatch.test.ts` and `missing-trailer.test.ts`
 * each model a different Actions history or corpus around the same tracker, so what they share is
 * exactly this and nothing above it. Not `createFakeGh`: that one models sub-issue publishing and
 * refuses `issue list` outright.
 *
 * @fixture Reached only from the suites, by design.
 */
export function answerTracker(args: string[], issues: readonly object[]): string | undefined {
  if (args[0] === "issue" && args[1] === "list") return JSON.stringify(issues);
  if (args[0] === "issue" && args[1] === "create") return "https://github.com/owner/repo/issues/42\n";
  return undefined;
}

/**
 * `answerTracker` as the last handler in a stand-in: the tracker's answer, or the throw every
 * watchdog fake ends on for an argv nothing modelled — so an unmodelled call fails the test loudly
 * rather than reading as an empty string.
 *
 * @fixture Reached only from the suites, by design.
 */
export function answerTrackerOrThrow(args: string[], issues: readonly object[]): string {
  const answered = answerTracker(args, issues);
  if (answered !== undefined) return answered;
  throw new Error(`fake gh: unhandled argv: ${JSON.stringify(args)}`);
}
