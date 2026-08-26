import { pathToFileURL } from "node:url";
import { execGit, type GitExec } from "../shared/git";
import { syncNotesRef } from "../shared/notes-sync";
import { normalizeNewlines } from "../shared/ticket-shape";
import type { RatificationRecord } from "./ratification-schema";
import { writeRatificationNote } from "./ratification";
import { parseFindingMarker } from "./run-release";

/**
 * The ratification connector (spec #63 §Solution move 5, "the release PR's
 * checklist ratifies itself"): fires once a release PR (`run-release.ts`'s
 * `composeRelease`) closes, and turns the owner's checkbox decisions back
 * into `RatificationRecord`s — the same memory `filterByRatificationMemory`
 * (./ratification.ts) reads on the *next* release to decide whether a
 * declined finding has earned another look.
 *
 * A merge is the only close this module reads anything from: a release PR
 * closed without merging carried no decision at all — every box on it is
 * exactly as undecided as before the PR opened — so nothing is written and
 * `refs/notes/ratifications` is never touched.
 */

/**
 * One checklist line, capturing whether its box is checked. Deliberately not
 * `ticket-shape.ts`'s `CRITERIA_ITEM_RE`: that pattern only needs to know a
 * line *is* a checkbox item to count it, while this reader needs the checked
 * state itself, so it carries its own capture group rather than widening a
 * shared one two callers would then have to agree stays compatible.
 */
const CHECKLIST_ITEM_RE = /^[ \t]*-[ \t]*\[([ xX])\]/;

export interface EntrypointInput {
  /** For the log line only — not read by any decision this module makes. */
  prNumber?: number;
  /** `github.event.pull_request.merged`. */
  merged: boolean;
  /** `github.event.pull_request.body` — the release PR's checklist, one item per prose finding. */
  body: string | null | undefined;
  /** The commit these decisions are recorded against — `github.event.pull_request.merge_commit_sha`. */
  commit: string;
  /** The repo the ratification note is written and pushed into. */
  repoDir: string;
  git?: GitExec;
  log?: (line: string) => void;
}

export interface EntrypointOutcome {
  /** `false` when the PR closed without merging — nothing was read or written. */
  ran: boolean;
  /** How many checklist items carried a parseable finding marker, present whenever `ran` is true. */
  recordCount?: number;
}

/**
 * Turns a release PR's checklist item into the `RatificationRecord` its
 * checkbox state means: checked is `ratified`, unchecked is `declined`
 * carrying the marker's own site list — `filterByRatificationMemory`'s
 * "carry the site list; that is what distinguishes 'recurred again' from
 * 'grew'" applies to what a decision remembers, not just what re-proposes
 * one, so a `declined` record's `sites` here is exactly what the release run
 * proposed, not re-derived from anything this module reads itself.
 *
 * A line with no checkbox, or a checkbox whose marker fails to parse (a
 * hand-edited or otherwise foreign checklist line), yields no record —
 * `parseFindingMarker` already declines to trust those, and this reader
 * declines to guess a `finding`/`sites` pair on its behalf.
 */
function parseChecklist(body: string, prNumber: number | undefined): RatificationRecord[] {
  const records: RatificationRecord[] = [];

  for (const line of normalizeNewlines(body).split("\n")) {
    const checkbox = CHECKLIST_ITEM_RE.exec(line);
    if (!checkbox) continue;

    const marker = parseFindingMarker(line);
    if (!marker) continue;

    const checked = checkbox[1].trim().length > 0;
    records.push({
      finding: marker.finding,
      sites: marker.sites,
      decision: checked ? "ratified" : "declined",
      reason: checked
        ? `checked off in release PR #${prNumber ?? "?"}`
        : `left unchecked in release PR #${prNumber ?? "?"}`,
    });
  }

  return records;
}

/**
 * The connector. A merged PR with no parseable checklist item writes
 * nothing — the same "an empty batch costs nothing beyond the reads above"
 * shape `runRelease` (./run-release.ts) already holds for the opening half
 * of this same pipeline, applied here to its closing half: `syncNotesRef`
 * (and the push it makes) only ever runs when there is at least one record
 * to publish.
 */
export function runRatification(input: EntrypointInput): EntrypointOutcome {
  const git = input.git ?? execGit;
  const log = input.log ?? ((line: string) => console.log(line));
  const { merged, commit, repoDir, prNumber } = input;

  if (!merged) {
    log(`#${prNumber ?? "?"} closed without merging — nothing to ratify.`);
    return { ran: false };
  }

  const records = parseChecklist(input.body ?? "", prNumber);

  if (records.length === 0) {
    log(`#${prNumber ?? "?"} merged with no checklist findings to ratify.`);
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

  const outcome = runRatification({
    prNumber,
    merged,
    body: process.env.PR_BODY,
    commit,
    repoDir: process.cwd(),
  });

  console.log(
    outcome.ran ? `ran (records=${outcome.recordCount ?? 0})` : "PR closed without merging — nothing ratified",
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
