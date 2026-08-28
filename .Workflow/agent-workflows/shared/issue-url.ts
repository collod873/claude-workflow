/**
 * The one reader of what `gh issue create` prints.
 *
 * `gh` answers a create with the new issue's URL on stdout and nothing else, so every lane that
 * files an issue has to turn that line back into a number. Four of them had grown their own
 * identical copy — `shared/publish-sub-issues.ts`, `spec/amend.ts`, `review/review.ts` and
 * `review/publish-findings.ts`, each with the same regex under one of two names — and lane 02's
 * publish would have been the fifth. `DESIGN.md` §06's rule is that a check defined twice drifts;
 * this is that rule applied to a parse.
 *
 * The anchor is deliberate. `\/issues\/(\d+)\s*$` matches the trailing path segment only, so a URL
 * that happens to carry digits earlier — an org or repo named for a number — cannot be read as the
 * issue number, and a create whose output is empty or an error line fails loudly rather than
 * yielding `NaN` for a caller to write into a payload.
 */

const ISSUE_URL_RE = /\/issues\/(\d+)\s*$/;

/**
 * The issue number in `createOutput`, or a throw naming what was being filed.
 *
 * `context` rides into the error message because the callers file in loops — 26 sub-issues, one
 * issue per surviving review finding — and "could not parse an issue number" with no subject is
 * unactionable in a runner log.
 */
export function parseIssueNumber(createOutput: string, context?: string): number {
  const match = createOutput.trim().match(ISSUE_URL_RE);
  if (!match) {
    const subject = context === undefined ? "" : ` for ${JSON.stringify(context)}`;
    throw new Error(
      `could not parse an issue number from "gh issue create" output${subject}: ${JSON.stringify(createOutput)}`,
    );
  }
  return Number(match[1]);
}
