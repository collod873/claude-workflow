import { readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { IMMUTABLE_SET, touchesImmutableSet } from "./immutable-set";
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
 * A check command built to read the tracker or the network rather than the
 * tree — `gh api`, `gh issue`, `gh pr`, `gh run`, `curl`, `wget`. Every one of
 * these answers from GitHub's remote state (or some other remote entirely),
 * never from the working directory `bin/close-ticket` hands the command, so
 * it returns the same verdict before the ticket's diff exists and after it
 * merges. #201's fourth criterion — `gh api
 * repos/…/contents/tests/acceptance` — is the case this caught: three of
 * four criteria passed against the merge, and this one could not have passed
 * against any diff, because it was never reading the diff.
 *
 * This is deliberately narrower than "reaches outside the repository".
 * #220's own criteria grep `/home/collin/.agents/skills/drain/SKILL.md`, an
 * absolute path outside this repo, because the artifact under test lives
 * there — a `grep` against that path still reads local disk, and can
 * observe exactly what that ticket's own work produced. Refusing every
 * absolute path, or `gh` outright, would have bounced that ticket along with
 * #201's. See [ADR-0096](../../../docs/adr/0096-a-check-marker-is-refused-for-reading-the-tracker-instead-of.md).
 */
const REMOTE_TRACKER_RE = /\bgh\s+(?:api|issue|pr|run)\b|\bcurl\b|\bwget\b/i;

/**
 * Why `criterion` cannot be published, or `undefined` when it can.
 *
 * Three refusals, and only three. **No well-formed `check:` marker**: the
 * whole verification story downstream is `close-ticket` running that
 * command, so a criterion without one is a criterion nothing will ever check
 * — which is how 26 tickets closed on `0 of N criteria verified` (#183,
 * #215). **More than one line**: the two readers of a published body
 * disagree about a wrapped criterion — `ticket-shape.ts`'s `extractCriteria`
 * is line-shaped and reads the first line only, while `bin/ticket_shape.py`'s
 * `criteria_blocks` folds the continuations in — and a claim that means two
 * different things to the lane that builds it and the script that closes it
 * is not worth publishing. The slicer has no reason to wrap:
 * `SLICE_CAPS.acceptanceCriteria` caps an entry at 200 characters.
 * **A remote-observing check** (`REMOTE_TRACKER_RE`): a criterion that
 * parses and runs headlessly but can never be answered by a diff, which is
 * how #201's fourth criterion survived every existing gate (#223).
 */
function criterionProblem(criterion: string): string | undefined {
  if (/\n/.test(criterion)) {
    return "spans more than one line";
  }
  const command = parseCheckMarker(criterion);
  if (command === undefined) {
    return CHECK_MARKER_ATTEMPT_RE.test(criterion)
      ? "carries a `check:` marker that does not parse"
      : "names no `check:` marker";
  }
  if (REMOTE_TRACKER_RE.test(command)) {
    return "checks the tracker instead of the tree — it can never be answered by a diff";
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
 * Refuses a slice that claims a file no pull request may ever touch.
 *
 * ADR-0010 — *every gate fires at the earliest venue that can run it* — and this one was firing at
 * the last. `IMMUTABLE_SET` was read in exactly one place, the Immutability job in `verify.yml`,
 * which runs after a slice has been published, had acceptance tests authored against it, and been
 * implemented by a paid model. #272 claimed `vitest.config.ts`, so lane 04 wrote an acceptance test
 * that *required* the edit and lane 06 refused the pull request that made it: a ticket no
 * implementer could ever satisfy, discovered forty minutes and one model run too late, and
 * unsatisfiable identically on every retry.
 *
 * The claim is the earliest place the contradiction is visible — it is the slicer's own statement
 * of what the ticket will change, available before a single `gh` write. Read from the same
 * `touchesImmutableSet` the Immutability job reads, so the two can never disagree about what the
 * set contains; a claim naming an immutable path is the ticket admitting up front that it cannot
 * pass its own verification.
 *
 * Reports every offending slice rather than the first, for the reason `validateCriteriaShape`
 * gives: one re-fired slicer run should fix the whole plan.
 */
export function validateClaimsAreMutable(plan: Plan): void {
  const problems: string[] = [];
  plan.forEach((slice, index) => {
    const claimed = slice.filesClaimed.filter((path) => touchesImmutableSet([path]));
    if (claimed.length > 0) {
      problems.push(
        `slice ${index + 1} ("${slice.title}") claims ${claimed.map((path) => JSON.stringify(path)).join(", ")}, ` +
          `which no pull request may touch (${IMMUTABLE_SET.join(", ")}) — lane 06 would refuse the ` +
          `implementation, so this ticket could never pass. Re-slice it to reach its goal without that file.`,
      );
    }
  });
  if (problems.length > 0) {
    throw new Error(problems.join("\n"));
  }
}

/**
 * The repository's own top level, read once from this file's position in it — `shared/` is three
 * levels down in every checkout of this repo and in every repo it is installed into, which is the
 * same anchor `affected-tests.ts` uses. Memoised because a plan asks this question once per path
 * token and the answer cannot change inside a run.
 */
let topLevelCache: ReadonlySet<string> | undefined;
function repoTopLevel(): ReadonlySet<string> {
  topLevelCache ??= new Set(readdirSync(resolve(dirname(fileURLToPath(import.meta.url)), "../../..")));
  return topLevelCache;
}

/**
 * The extensions that make a token a file rather than a sentence. Deliberately a closed list: the
 * alternative — "a dot near the end" — reads `output.parse`, `StageOptions.stage`, `e.g.` and
 * `package.json#scripts.test` as filenames and refuses tickets over prose.
 */
const FILE_EXTENSION_RE = /\.(?:[jt]sx?|[mc]js|json|ya?ml|md|py|sh|toml|txt|lock)$/;

/**
 * Every path-shaped token in a piece of a ticket's prose.
 *
 * A token counts as a path when it carries a directory (`a/b.ts`, `checkpoints/`) or, with no
 * directory at all, ends in one of the extensions above (`stage.ts`). Markdown link targets and
 * URLs are removed first: `](0034-….md)` and `https://github.com/…/x.md` are references to
 * documents, not instructions about where a file lives, and reading them as paths is the one
 * false-positive shape this gate would otherwise produce.
 */
function pathTokens(text: string): string[] {
  const prose = text.replace(/\]\([^)]*\)/g, "]").replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, " ");
  return prose
    .split(/[^A-Za-z0-9_.\-/@*]+/)
    .map((token) => token.replace(/\.+$/, ""))
    .filter((token) => !token.startsWith("-") && !token.startsWith("@"))
    .filter((token) => {
      const withoutTrailingSlash = token.replace(/\/+\**$/, "");
      if (withoutTrailingSlash.length === 0) return false;
      const last = withoutTrailingSlash.slice(withoutTrailingSlash.lastIndexOf("/") + 1);
      const named = FILE_EXTENSION_RE.test(last) && /[\w-]\.[^.]*$/.test(last);
      return token.includes("/") ? token.endsWith("/") || named : named;
    });
}

/** `true` when `token` is a run of whole segments inside `claimed` — `shared/stage.ts` in `.Workflow/…/shared/stage.ts`. */
function isSegmentRunOf(token: string, claimed: string): boolean {
  const needle = token.replace(/\/+\**$/, "");
  const haystack = `/${claimed}`;
  return haystack.endsWith(`/${needle}`) || haystack.includes(`/${needle}/`);
}

/**
 * Whether a path a ticket names can be resolved from the ticket alone — rooted at the repository,
 * or spelled in full somewhere in `filesClaimed` and abbreviated here.
 */
function isResolvable(token: string, claimed: string[], roots: ReadonlySet<string>): boolean {
  const first = token.split("/")[0];
  return roots.has(first) || claimed.some((path) => isSegmentRunOf(token, path));
}

/**
 * Refuses a slice that names a path the ticket never roots —
 * [ADR-0118](../../../docs/adr/0118-a-ticket-roots-every-path-it-names-because-lane-04-and-lane.md).
 *
 * A ticket body is the entire coordination mechanism between lane 04 and lane 05: neither reads the
 * other's output, neither can ask a question, and neither runs first in a way that would surface a
 * disagreement. So a path the ticket leaves relative is not a small imprecision — it is a decision
 * handed to two blind readers, who make it independently and are not obliged to agree.
 *
 * #272 is the worked case (#278). Its `What to build` said the checkpoint is written as
 * `<stage>.json` **under `checkpoints/`**, and never said rooted where. Lane 04 read it as
 * `join(dirname(handoffPath()), "checkpoints")` and probed `<tmp>/checkpoints`; lane 05 read it as
 * `.Workflow/agent-workflows/checkpoints` and wrote there. Both readings are faithful to the
 * sentence. Three acceptance tests went red, and a red acceptance test has exactly one presentation
 * — *the implementation does not satisfy the test* — so the retry loop re-fires the one lane that
 * was not wrong, against a reading it was never given, forever.
 *
 * **The rule is resolvable from the ticket, not absolute.** A path is fine when its first segment
 * is a real top-level entry of the repository, and equally fine when `filesClaimed` spells it in
 * full and the prose abbreviates it — `shared/stage.ts` beside a claim of
 * `.Workflow/agent-workflows/shared/stage.ts` names one file and only one. What it refuses is a
 * path with no anchor anywhere in the body, which is the only shape a reader has to guess at.
 * Measured against the four tickets of PRD #271 as published: #274, #275 and #276 pass untouched,
 * and #272 is refused on `checkpoints/` alone.
 *
 * `filesClaimed` is held to the rooted half only, because it is what the prose anchors *to* — an
 * abbreviation there resolves to nothing, and a slice that genuinely introduces a new top-level
 * directory is rare enough to be worth stating in full.
 *
 * Reports every offending slice rather than the first, for the reason `validateCriteriaShape`
 * gives: one re-fired slicer run should fix the whole plan.
 */
export function validatePathsAreRooted(plan: Plan, roots: ReadonlySet<string> = repoTopLevel()): void {
  const problems: string[] = [];
  plan.forEach((slice, index) => {
    const label = `slice ${index + 1} ("${slice.title}")`;
    const unrootedClaims = slice.filesClaimed.filter((path) => !roots.has(path.split("/")[0]));
    if (unrootedClaims.length > 0) {
      problems.push(
        `${label} claims ${unrootedClaims.map((path) => JSON.stringify(path)).join(", ")}, ` +
          `which name no top-level entry of the repository — a claim is what the ticket's prose is ` +
          `rooted against, so it has to be the full path from the repository root.`,
      );
    }
    const prose = [slice.whatToBuild, ...slice.acceptanceCriteria];
    const unresolvable = [...new Set(prose.flatMap(pathTokens))].filter(
      (token) => !isResolvable(token, slice.filesClaimed, roots),
    );
    if (unresolvable.length > 0) {
      problems.push(
        `${label} names ${unresolvable.map((token) => JSON.stringify(token)).join(", ")} without saying rooted where. ` +
          `Lane 04 and lane 05 read this ticket independently and cannot ask each other, so an unrooted path ` +
          `is a decision handed to two blind readers (#272, #278). Spell it from the repository root, or claim ` +
          `the full path in filesClaimed.`,
      );
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
