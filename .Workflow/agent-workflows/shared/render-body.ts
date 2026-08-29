import type { Plan, Slice } from "./plan-schema";
import { reason } from "./reason";
import { CHECK_MARKER_ATTEMPT_RE, CRITERIA_HEADING, parseCheckMarker } from "./ticket-shape";

/**
 * What a criterion has to look like for `bin/close-ticket` to be able to run
 * it — quoted here because this string is what a failing slicer run shows the
 * person reading the log, and "malformed" on its own tells them nothing.
 */
const CRITERION_SHAPE =
  "a statement of what is observably true, then ` — check: ` and one backtick-quoted command, " +
  "on one line (e.g. ``- [ ] `foo` is exported — check: `npx vitest run bar.test.ts` ``)";

/**
 * Why `criterion` cannot be published, or `undefined` when it can.
 *
 * Two refusals, and only two. **No well-formed `check:` marker**: the whole
 * verification story downstream is `close-ticket` running that command, so a
 * criterion without one is a criterion nothing will ever check — which is how
 * 26 tickets closed on `0 of N criteria verified` (#183, #215). **More than
 * one line**: the two readers of a published body disagree about a wrapped
 * criterion — `ticket-shape.ts`'s `extractCriteria` is line-shaped and reads
 * the first line only, while `bin/ticket_shape.py`'s `criteria_blocks` folds
 * the continuations in — and a claim that means two different things to the
 * lane that builds it and the script that closes it is not worth publishing.
 * The slicer has no reason to wrap: `SLICE_CAPS.acceptanceCriteria` caps an
 * entry at 200 characters.
 */
function criterionProblem(criterion: string): string | undefined {
  if (/\n/.test(criterion)) {
    return "spans more than one line";
  }
  if (parseCheckMarker(criterion) === undefined) {
    return CHECK_MARKER_ATTEMPT_RE.test(criterion)
      ? "carries a `check:` marker that does not parse"
      : "names no `check:` marker";
  }
  return undefined;
}

/**
 * Refuses a slice whose acceptance criteria could not be verified by the
 * script that closes them, naming the first offender and the shape it missed.
 *
 * Throwing is the right severity because the alternative already happened:
 * publish the ticket anyway, and it reaches an implementer, a reviewer and a
 * close, each of which reads criteria it cannot run and says nothing. A model
 * that emits the wrong shape gets a red run it can be re-fired against; a
 * ticket that emits the wrong shape gets closed as delivered.
 */
function assertCheckableCriteria(criteria: string[], label: string): void {
  for (const criterion of criteria) {
    const problem = criterionProblem(criterion);
    if (problem) {
      throw new Error(
        `${label}: acceptance criterion ${problem} — ${CRITERION_SHAPE}. Offending criterion: ${JSON.stringify(criterion)}`,
      );
    }
  }
}

/**
 * The same refusal over a whole plan, before a single issue is created.
 *
 * `renderBody` refuses too, but it renders inside the create loop — a plan
 * whose ninth slice is unpublishable would already have created eight issues
 * by the time it threw. Called from `slice-and-publish.ts` beside
 * `validatePlan`, this keeps the cost of the refusal at zero `gh` calls, and
 * reports every offending slice rather than the first one, so a re-fired
 * slicer run fixes the plan in one pass instead of one slice per run.
 */
export function validateCriteriaShape(plan: Plan): void {
  const problems: string[] = [];
  plan.forEach((slice, index) => {
    try {
      assertCheckableCriteria(slice.acceptanceCriteria, `slice ${index + 1} ("${slice.title}")`);
    } catch (err) {
      problems.push(reason(err));
    }
  });
  if (problems.length > 0) {
    throw new Error(problems.join("\n"));
  }
}

/**
 * Renders one slice as a published ticket body: four fixed headings —
 * `Parent PRD`, `What to build`, `Acceptance criteria`, `Files claimed` — in
 * that order, followed by the seam manifest lines this slice consumes (if
 * any), which are prose it read, never a file it claims. Carries no
 * `Closes` directive: closing a ticket belongs to whatever implements it,
 * closing the PRD belongs to the merged PR.
 *
 * The criteria heading comes from `ticket-shape.ts` rather than being
 * spelled here, because the close gate reads that heading back months later
 * to decide whether the ticket's close is honest. Spelled twice, a rename on
 * this side would make every close refuse for a reason nobody could see: the
 * reader reporting "no acceptance criteria" about a ticket that plainly has
 * some.
 *
 * The criteria themselves are held to the same standard as the heading, for
 * the same reason and since #215: what is written here is what `close-ticket`
 * has to parse, so a criterion it could not run never reaches the tracker.
 */
export function renderBody(slice: Slice, prdNumber: number): string {
  assertCheckableCriteria(slice.acceptanceCriteria, `slice "${slice.title}"`);

  const criteria = slice.acceptanceCriteria.map((item) => `- [ ] ${item}`).join("\n");

  const files =
    slice.filesClaimed.length > 0
      ? slice.filesClaimed.map((path) => `- ${path}`).join("\n")
      : "- None — no files.";

  const seams =
    slice.seamsConsumed.length > 0
      ? `\n\n## Seams consumed\n\n${slice.seamsConsumed.join("\n")}`
      : "";

  return `## Parent PRD
#${prdNumber}

## What to build
${slice.whatToBuild}

${CRITERIA_HEADING}
${criteria}

## Files claimed
${files}${seams}
`;
}
