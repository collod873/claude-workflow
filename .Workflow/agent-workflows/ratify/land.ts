import type { GhExec } from "../shared/gh";
import type { GitExec } from "../shared/git";
import { IMMUTABLE_SET, touchesImmutableSet } from "../shared/immutable-set";
import { dispatchVerify } from "../shared/verify-dispatch";
import type { Observation } from "../shared/observation-schema";
import { encodeFindingMarker } from "../shared/finding-marker";
import { LAST_RATIFIER_REF, LEGACY_RATIFIER_REF, readRatifierBase } from "../shared/ratifier-base";
import { MACHINERY_TRAILER_LINE } from "../shared/ratification-scope";

export { LAST_RATIFIER_REF, LEGACY_RATIFIER_REF, readRatifierBase };

export const RATIFIER_PR_TITLE = "Ratified: standards from this batch";

export const RATIFIER_CRITERION =
  "Every enabled eslint rule resolves to a definition and every CODING_STANDARDS.md entry parses to the three-line shape";

export function advanceRatifierRef(git: GitExec, repoDir: string, head: string): void {
  git(["-C", repoDir, "update-ref", LAST_RATIFIER_REF, head]);
}

export function commitWorkingTree(
  git: GitExec,
  repoDir: string,
  parent: string,
  subject: string,
): string | null {
  git(["-C", repoDir, "add", "-A"]);
  const tree = git(["-C", repoDir, "write-tree"]).trim();

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

export function restoreWorkingTree(git: GitExec, repoDir: string): void {
  git(["-C", repoDir, "checkout-index", "-a", "-f"]);
  git(["-C", repoDir, "clean", "-fd"]);
}

export function changedFilesBetween(git: GitExec, repoDir: string, base: string, head: string): string[] {
  return git(["-C", repoDir, "diff", "--name-only", `${base}..${head}`])
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export interface LandedFinding {
  observation: Observation;
  landedAs: string;
  reason: string;
  verdict: string;
}

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
  head: string;
  base: string;
  landed: LandedFinding[];
  changedFiles: string[];
}

export function refuseImmutableSetBatch(changedFiles: string[]): void {
  if (!touchesImmutableSet(changedFiles)) return;
  throw new Error(
    `this batch touches the immutable set — ${changedFiles.join(", ")}. ` +
      "A ratifier pull request may never edit vitest.config.ts or .github/",
  );
}

export function alignImmutableSetWithTrunk(options: {
  git: GitExec;
  repoDir: string;
  tip: string;
  remote: string;
  trunk: string;
}): string {
  const { git, repoDir, tip, remote, trunk } = options;
  const paths = [...IMMUTABLE_SET];

  git(["-C", repoDir, "fetch", remote, trunk]);
  git(["-C", repoDir, "rm", "-r", "-q", "-f", "--ignore-unmatch", "--", ...paths]);

  for (const path of paths) {
    try {
      git(["-C", repoDir, "checkout", "FETCH_HEAD", "--", path]);
    } catch {
    }
  }

  return commitWorkingTree(git, repoDir, tip, TRUNK_IMMUTABLE_SET_SUBJECT) ?? tip;
}

const TRUNK_IMMUTABLE_SET_SUBJECT = "Carry trunk's immutable set, which this batch may not edit";

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
  refuseImmutableSetBatch(changedFiles);

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
