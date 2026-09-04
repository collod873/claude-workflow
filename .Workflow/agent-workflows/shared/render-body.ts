import { readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { IMMUTABLE_SET, touchesImmutableSet } from "./immutable-set";
import type { Plan, Slice } from "./plan-schema";
import { reason } from "./reason";
import { CHECK_MARKER_ATTEMPT_RE, CRITERIA_HEADING, parseCheckMarker } from "./ticket-shape";

const CRITERION_SHAPE =
  "a statement of what is observably true, then ` - check: ` and one backtick-quoted command, " +
  "on one line (e.g. ``- [ ] `foo` is exported - check: `npx vitest run bar.test.ts` ``)";

const REMOTE_TRACKER_RE = /\bgh\s+(?:api|issue|pr|run)\b|\bcurl\b|\bwget\b/i;

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
    return "checks the tracker instead of the tree; it can never be answered by a diff";
  }
  return undefined;
}

function assertCheckableCriteria(criteria: string[], label: string): void {
  for (const criterion of criteria) {
    const problem = criterionProblem(criterion);
    if (problem) {
      throw new Error(
        `${label}: acceptance criterion ${problem}: ${CRITERION_SHAPE}. Offending criterion: ${JSON.stringify(criterion)}`,
      );
    }
  }
}

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

export function validateClaimsAreMutable(plan: Plan): void {
  const problems: string[] = [];
  plan.forEach((slice, index) => {
    const claimed = slice.filesClaimed.filter((path) => touchesImmutableSet([path]));
    if (claimed.length > 0) {
      problems.push(
        `slice ${index + 1} ("${slice.title}") claims ${claimed.map((path) => JSON.stringify(path)).join(", ")}, ` +
          `which no pull request may touch (${IMMUTABLE_SET.join(", ")}), and lane 06 would refuse the ` +
          `implementation, so this ticket could never pass. Re-slice it to reach its goal without that file.`,
      );
    }
  });
  if (problems.length > 0) {
    throw new Error(problems.join("\n"));
  }
}

let topLevelCache: ReadonlySet<string> | undefined;
function repoTopLevel(): ReadonlySet<string> {
  topLevelCache ??= new Set(readdirSync(resolve(dirname(fileURLToPath(import.meta.url)), "../../..")));
  return topLevelCache;
}

const FILE_EXTENSION_RE = /\.(?:[jt]sx?|[mc]js|json|ya?ml|md|py|sh|toml|txt|lock)$/;

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

function isSegmentRunOf(token: string, claimed: string): boolean {
  const needle = token.replace(/\/+\**$/, "");
  const haystack = `/${claimed}`;
  return haystack.endsWith(`/${needle}`) || haystack.includes(`/${needle}/`);
}

function isResolvable(token: string, claimed: string[], roots: ReadonlySet<string>): boolean {
  const first = token.split("/")[0];
  return roots.has(first) || claimed.some((path) => isSegmentRunOf(token, path));
}

export function validatePathsAreRooted(plan: Plan, roots: ReadonlySet<string> = repoTopLevel()): void {
  const problems: string[] = [];
  plan.forEach((slice, index) => {
    const label = `slice ${index + 1} ("${slice.title}")`;
    const unrootedClaims = slice.filesClaimed.filter((path) => !roots.has(path.split("/")[0]));
    if (unrootedClaims.length > 0) {
      problems.push(
        `${label} claims ${unrootedClaims.map((path) => JSON.stringify(path)).join(", ")}, ` +
          `which name no top-level entry of the repository, and a claim is what the ticket's prose is ` +
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
