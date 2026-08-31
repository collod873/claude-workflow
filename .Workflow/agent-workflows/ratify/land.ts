import type { GhExec } from "../shared/gh";
import type { GitExec } from "../shared/git";
import { touchesImmutableSet } from "../shared/immutable-set";
import { dispatchVerify } from "../implement/implement";
import type { Observation } from "../observations/observation-schema";
import { encodeFindingMarker } from "./finding-marker";
import { MACHINERY_TRAILER_LINE } from "./scope";

/**
 * The title every ratifier pull request opens with — one batch, one review
 * artifact (the surviving half of #36's "one review, not N issues"). It is
 * the only thing distinguishing this pull request from an ordinary
 * implementation one, so `ratify-release.yml`'s job-level `if` spells it too
 * and `run-ratification.test.ts` asserts the two still agree.
 */
export const RATIFIER_PR_TITLE = "Ratified: standards from this batch";

/**
 * The one criterion string every ratifier dispatch sends, verbatim.
 *
 * Lane 06 selects the acceptance tests to run by fixed-string search over
 * `tests/acceptance/` (`shared/affected-tests.ts`, `testsForCriteria`), and an
 * empty selection is a hard failure (`verify.yml`). A ratifier pull request
 * carries no ticket and therefore no ticket's criteria, so one standing
 * acceptance test carries this exact sentence and is what every ratifier
 * batch is judged against. Change this string and that test stops being
 * selected — which is why the test asserts the string itself.
 */
export const RATIFIER_CRITERION =
  "Every enabled eslint rule resolves to a definition and every CODING_STANDARDS.md entry parses to the three-line shape";

/**
 * The plain ref recording where the last ratifier run stopped — read as the
 * scope's `base`, absent before the first run (which `computeRatificationScope`
 * already treats as "scope from the repo root").
 *
 * **Advanced on every completed run, not only when a pull request opens.** A
 * rejected finding writes a `declined` record, so re-reading old scope would
 * only re-filter the same findings out again; advancing keeps scope bounded
 * and costs nothing a rejection did not already decide.
 *
 * A plain ref rather than a notes ref, for the reason its predecessor gave:
 * this is one fact about the pipeline's own state, with no commit to key it
 * to other than the value it points at.
 */
export const LAST_RATIFIER_REF = "refs/ratifier/last";

/** The ref the deleted release channel used, read once to seed `LAST_RATIFIER_REF` and then deleted. */
export const LEGACY_RATIFIER_REF = "refs/release/last";

/** Reads a plain ref, or `undefined` when it does not exist. */
export function readRef(git: GitExec, repoDir: string, ref: string): string | undefined {
  try {
    return git(["-C", repoDir, "rev-parse", "--verify", "--quiet", ref]).trim() || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Where this run scopes from: `refs/ratifier/last` if it exists, otherwise
 * whatever `refs/release/last` still points at.
 *
 * The seed is a read, not a copy — nothing here writes the new ref, because
 * the advance at the end of the run does that anyway and a seed written
 * before the run would claim a scope the run had not covered yet. The legacy
 * ref's deletion is `ratify.yml`'s, once the advance has published a real one.
 */
export function readRatifierBase(git: GitExec, repoDir: string): string | undefined {
  return readRef(git, repoDir, LAST_RATIFIER_REF) ?? readRef(git, repoDir, LEGACY_RATIFIER_REF);
}

/** Moves `refs/ratifier/last` to `head`. Local only — `ratify.yml` pushes it. */
export function advanceRatifierRef(git: GitExec, repoDir: string, head: string): void {
  git(["-C", repoDir, "update-ref", LAST_RATIFIER_REF, head]);
}

/**
 * Commits whatever the stage left in the working tree onto `parent`, without
 * moving `HEAD`.
 *
 * Plumbing rather than `checkout`/`commit` for the reason the deleted release
 * branch builder gave: this lane keeps running other commands — a lint run, a
 * detached trial worktree, the next finding's stage — in the very checkout it
 * is committing from, and moving `HEAD` out from under those is a side effect
 * nothing asked for. `git add -A` is what makes the index the answer, so the
 * next finding's `write-tree` reads this one's result as its own starting
 * point.
 *
 * Every commit carries `Machinery-Commit: true`. That is not decoration: it
 * is what keeps ADR-0017's invariant true under the new shape — the audit
 * lane's own scope filter (`./scope.ts`, `isMachineryCommit`) drops these
 * commits, so a ratifier landing can never feed the next audit's scope and a
 * landing never triggers another pass.
 */
export function commitWorkingTree(
  git: GitExec,
  repoDir: string,
  parent: string,
  subject: string,
): string | null {
  git(["-C", repoDir, "add", "-A"]);
  const tree = git(["-C", repoDir, "write-tree"]).trim();

  // A stage that answered a landing verdict and changed nothing has landed nothing, and an empty
  // commit would carry that fiction into the pull request — where the batch's own `changed_files`
  // would then be shorter than its body claims. Reported to the caller as "no commit", which is
  // the one honest reading of an unchanged tree.
  if (tree === git(["-C", repoDir, "rev-parse", `${parent}^{tree}`]).trim()) return null;

  return git([
    "-C",
    repoDir,
    "commit-tree",
    tree,
    "-p",
    parent,
    "-m",
    `${subject}\n\n${MACHINERY_TRAILER_LINE}\n`,
  ]).trim();
}

/**
 * Throws away everything the working tree gained since the last
 * `commitWorkingTree` — the demotion path's undo, and the reject verdict's.
 *
 * Restores tracked files from the index (which the last commit's `add -A`
 * left holding exactly that commit's tree) and removes what the stage newly
 * created. `git clean` without `-x` deliberately: `.gitignore`d paths are
 * `node_modules/`, the checkpoint dir and the trial worktree, none of which
 * belong to the finding being undone.
 */
export function restoreWorkingTree(git: GitExec, repoDir: string): void {
  git(["-C", repoDir, "checkout-index", "-a", "-f"]);
  git(["-C", repoDir, "clean", "-fd"]);
}

/** Every path that differs between `base` and `head` — the dispatch's `changed_files`. */
export function changedFilesBetween(git: GitExec, repoDir: string, base: string, head: string): string[] {
  return git(["-C", repoDir, "diff", "--name-only", `${base}..${head}`])
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/** One landed finding, as the pull request records it. */
export interface LandedFinding {
  observation: Observation;
  /** The entry Name or rule id — the revert detector's join key. */
  landedAs: string;
  /** The stage's own account of why this verdict. */
  reason: string;
  /** Which verdict actually landed, after any demotion the rule trial forced. */
  verdict: string;
}

/**
 * One section per finding: what landed, why, and the hidden marker the
 * merge-time record writer parses back out. The prose half restates the sites
 * because the marker is invisible in the rendered pull request and the owner
 * is the audience for the rest of the section.
 */
export function renderRatifierBody(landed: LandedFinding[]): string {
  const sections = landed.map((entry) => {
    const sites = entry.observation.sites.map((site) => `\`${site}\``).join(", ");
    return [
      `## ${entry.landedAs}`,
      "",
      entry.reason,
      "",
      `Landed as a **${entry.verdict}** verdict against: ${entry.observation.finding}`,
      "",
      `Sites: ${sites}`,
      "",
      encodeFindingMarker(entry.observation, entry.landedAs),
    ].join("\n");
  });

  return [
    "The audit lane's two-site gate cleared these findings; the ratifier turned each one into the",
    "standard below. **Ratified is merged** — lane 06 judges this pull request and lane 08 merges it",
    "like any other. To decline a standard, revert it: the revert detector writes the declined",
    "memory, and the finding stays suppressed until it grows a new site.",
    "",
    ...sections,
  ].join("\n");
}

export interface OpenRatifierPrOptions {
  gh: GhExec;
  /** The branch already pushed, carrying this batch's commits. */
  head: string;
  /** The branch this pull request merges into. */
  base: string;
  landed: LandedFinding[];
  /** Every path the batch changed, for the Immutability job's own string compare. */
  changedFiles: string[];
}

/**
 * Opens the batch's one pull request and rings the door every implementation
 * pull request already uses (`dispatchVerify`, ADR-0054).
 *
 * The dispatch is sent explicitly rather than left to the pull-request event:
 * events caused by the built-in `GITHUB_TOKEN` start no workflow runs, so the
 * pull request alone would be judged by nothing at all.
 *
 * Three refusals before any `gh` call, because a refusal is supposed to be
 * cheap and because a half-opened batch is worse than an unopened one:
 * an empty batch, a `head` that is not distinct from `base`, and — the line
 * that keeps this lane's door honest (#294's lesson) — any changed file that
 * prefix-matches the immutable set.
 */
export function openRatifierPr(options: OpenRatifierPrOptions): string {
  const { gh, head, base, landed, changedFiles } = options;

  if (landed.length === 0) {
    throw new Error("openRatifierPr: nothing landed — an empty batch opens no pull request");
  }
  if (!head || head === base) {
    throw new Error(`openRatifierPr: head must be a branch distinct from base, got head=${head} base=${base}`);
  }
  if (changedFiles.length === 0) {
    throw new Error("openRatifierPr: the batch changed no files, so lane 06 would have nothing to judge");
  }
  if (touchesImmutableSet(changedFiles)) {
    throw new Error(
      `openRatifierPr: this batch touches the immutable set — ${changedFiles.join(", ")}. ` +
        "A ratifier pull request may never edit tests/acceptance/, vitest.config.ts or .github/",
    );
  }

  const prUrl = gh([
    "pr",
    "create",
    "--title",
    RATIFIER_PR_TITLE,
    "--body",
    renderRatifierBody(landed),
    "--base",
    base,
    "--head",
    head,
  ]).trim();

  dispatchVerify(gh, { prUrl, changedFiles, criteria: [RATIFIER_CRITERION] });
  return prUrl;
}
