/**
 * The write half of the fixture lane: an `issue create` spelled the way every write in this repo
 * is spelled — an argv literal at the call site of a raw executor, with no named helper for a
 * guard to allowlist (#181). Reached from `lane.ts` only through a call, so the deriver has to
 * follow the edge rather than sweep the directory.
 */

/** The raw-argv shape of `shared/gh.ts`'s `execGh`, restated here so the fixture imports nothing. */
export type Exec = (argv: string[]) => string;

/** Files the finding. `issues: write`, and neither workflow in this fixture is asked twice. */
export function fileFinding(gh: Exec, title: string): string {
  return gh(["issue", "create", "--title", title, "--body", "filed by the fixture lane"]).trim();
}
