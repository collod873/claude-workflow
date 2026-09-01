import { pathToFileURL } from "node:url";
import { execGit, type GitExec } from "../shared/git";
import { syncNotesRef } from "../shared/notes-sync";
import { normalizeNewlines } from "../shared/ticket-shape";
import { parseFindingMarker } from "../ratify/finding-marker";
import type { RatificationRecord } from "./ratification-schema";
import { writeRatificationNote } from "./ratification";

/**
 * **Ratified = merged.** This is where that becomes memory: the moment a
 * ratifier pull request (`ratify/land.ts`'s `openRatifierPr`) merges, the
 * standards it landed are recorded as `ratified`, each carrying the
 * `landedAs` the revert detector keys on.
 *
 * There is no checkbox to read any more. #296 deleted the release-PR channel
 * and with it the parse that turned a box into a verdict; what survives is
 * this module's notes-write path, now fed by the pull request's own hidden
 * markers rather than by an owner's ticks. The owner's lever is a revert, and
 * only a revert.
 *
 * A merge is still the only close this reads anything from: a ratifier pull
 * request closed without merging landed nothing, so nothing is written and
 * `refs/notes/ratifications` is never touched. That is the unchanged rule.
 */

export interface EntrypointInput {
  /** For the log line only — not read by any decision this module makes. */
  prNumber?: number;
  /** `github.event.pull_request.merged`. */
  merged: boolean;
  /** `github.event.pull_request.body` — one section per landed finding, each carrying its marker. */
  body: string | null | undefined;
  /** The commit these records key to — `github.event.pull_request.merge_commit_sha`. */
  commit: string;
  /** The repo the ratification note is written and pushed into. */
  repoDir: string;
  git?: GitExec;
  log?: (line: string) => void;
}

export interface EntrypointOutcome {
  /** `false` when the PR closed without merging — nothing was read or written. */
  ran: boolean;
  /** How many sections carried a parseable finding marker, present whenever `ran` is true. */
  recordCount?: number;
}

/**
 * Turns a merged ratifier pull request's body into one `ratified` record per
 * landed finding.
 *
 * A line carrying no marker, or a marker that fails to parse, yields no
 * record — `parseFindingMarker` already declines to trust a hand-edited body,
 * and this reader declines to guess a finding on its behalf. A marker with no
 * `landedAs` yields no record either: without it there is nothing for the
 * revert detector to ever look for, so a record claiming ratification would
 * be memory nobody could act on.
 */
export function parseLandedFindings(body: string, prNumber: number | undefined): RatificationRecord[] {
  const records: RatificationRecord[] = [];

  for (const line of normalizeNewlines(body).split("\n")) {
    const marker = parseFindingMarker(line);
    if (!marker?.landedAs) continue;

    records.push({
      finding: marker.finding,
      sites: marker.sites,
      decision: "ratified",
      reason: `landed as "${marker.landedAs}" in ratifier PR #${prNumber ?? "?"}`,
      landedAs: marker.landedAs,
    });
  }

  return records;
}

/**
 * The connector. A merged pull request with no parseable marker writes
 * nothing: `syncNotesRef` (and the push it makes) only ever runs when there
 * is at least one record to publish.
 */
export function runRatification(input: EntrypointInput): EntrypointOutcome {
  const git = input.git ?? execGit;
  const log = input.log ?? ((line: string) => console.log(line));
  const { merged, commit, repoDir, prNumber } = input;

  if (!merged) {
    log(`#${prNumber ?? "?"} closed without merging — nothing was ratified.`);
    return { ran: false };
  }

  const records = parseLandedFindings(input.body ?? "", prNumber);

  if (records.length === 0) {
    log(`#${prNumber ?? "?"} merged with no landed findings to record.`);
    return { ran: true, recordCount: 0 };
  }

  syncNotesRef({
    git,
    repoDir,
    ref: "ratifications",
    apply: () => writeRatificationNote({ git, repoDir, commit, records }),
  });

  log(`#${prNumber ?? "?"} ratified ${records.length} finding(s) at ${commit}.`);
  return { ran: true, recordCount: records.length };
}

async function main(): Promise<void> {
  const prNumberRaw = process.env.PR_NUMBER;
  const prNumber = prNumberRaw ? Number(prNumberRaw) : undefined;
  const merged = process.env.PR_MERGED === "true";
  const commit = process.env.MERGE_COMMIT_SHA ?? "";

  if (merged && !commit) {
    console.error("MERGE_COMMIT_SHA must be set for a merged PR");
    process.exit(1);
  }

  // `TARGET_WORKSPACE` is the reusable workflow's target checkout (ADR-0055).
  const outcome = runRatification({
    prNumber,
    merged,
    body: process.env.PR_BODY,
    commit,
    repoDir: process.env.TARGET_WORKSPACE ?? process.cwd(),
  });

  console.log(
    outcome.ran ? `ran (records=${outcome.recordCount ?? 0})` : "PR closed without merging — nothing ratified",
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
