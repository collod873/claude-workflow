import type { GitExec } from "./git";
import type { Observation } from "./observation-schema";
import { RatificationRecord } from "./ratification-schema";

/**
 * The notes ref this module's read/write pair uses, unqualified so git
 * resolves it under `refs/notes/ratifications` (git.ts's `-C <dir>`
 * convention). Separate from `observations` (./notes.ts) because the two
 * hold different kinds of fact at different lifetimes: an observation is
 * evidence about a commit, a ratification record is a verdict a human made
 * about a finding — the second never goes stale just because the first
 * commit's files change, so it earns its own ref rather than sharing one.
 */
const NOTES_REF = "ratifications";

/** A record separator no JSON `RatificationRecord[]` payload can contain. */
const RECORD_SEP = "\x1e";

export interface WriteRatificationNoteOptions {
  git: GitExec;
  /** The repo to write into, threaded as `-C <repoDir>` — never baked into `git`'s closure. */
  repoDir: string;
  /** The commit the release that made these decisions happened at. */
  commit: string;
  records: RatificationRecord[];
}

/**
 * Writes `records` as one git note on `refs/notes/ratifications`, keyed to
 * `commit` — the same shape `writeObservationNote` (./notes.ts) uses for
 * observations. Overwrites (`-f`) whatever note already sits on that
 * commit, so a caller always hands this the full set of decisions made at
 * that release, never a delta to append.
 */
export function writeRatificationNote(options: WriteRatificationNoteOptions): void {
  const { git, repoDir, commit, records } = options;
  const message = JSON.stringify(RatificationRecord.array().parse(records));
  git(["-C", repoDir, "notes", `--ref=${NOTES_REF}`, "add", "-f", "-m", message, commit]);
}

export interface ReadRatificationRecordsOptions {
  git: GitExec;
  /** The repo to read from, threaded as `-C <repoDir>`. */
  repoDir: string;
  /** The commit the range starts after (exclusive). Omit to read from the repo's root. */
  base?: string;
  /** The last commit in the range. */
  head: string;
}

/**
 * Reads every ratification note in the range, flattened into one list —
 * the equivalent of `git log <range> --notes=ratifications`. Unlike
 * `readObservations` (./notes.ts), this hands back a flat
 * `RatificationRecord[]` rather than keying results to the commit each note
 * sits on: a decision is memory `filterByRatificationMemory` matches by
 * `finding`, not evidence scoped to the commit it was recorded at, so which
 * commit recorded it is not something a caller needs back.
 */
export function readRatificationRecords(options: ReadRatificationRecordsOptions): RatificationRecord[] {
  const { git, repoDir, base, head } = options;
  const range = base ? `${base}..${head}` : head;
  const format = `%N${RECORD_SEP}`;
  const raw = git(["-C", repoDir, "log", range, `--notes=${NOTES_REF}`, `--format=${format}`]);

  const records: RatificationRecord[] = [];
  for (const note of raw.split(RECORD_SEP)) {
    const trimmed = note.trim();
    if (!trimmed) continue;
    records.push(...RatificationRecord.array().parse(JSON.parse(trimmed)));
  }
  return records;
}

export interface FilterByRatificationMemoryOptions {
  /** This run's observations (spec #36 slice 6, `readObservations`'s output flattened to findings). */
  observations: Observation[];
  /** Every decision recorded across prior releases. */
  priorRatifications: RatificationRecord[];
}

/**
 * Ratification memory (spec #36 §4, "Ratification is memory"): a finding
 * previously `declined` is re-proposed only if this run's site list grew
 * beyond what the decision recorded — "carry the site list; that is what
 * distinguishes 'recurred again' from 'grew'," `/standards-pass`'s own rule
 * applied here to release-eligible observations rather than a ledger.
 *
 * A finding with no `declined` record, or whose recorded decision was
 * something other than `declined`, passes through untouched — only a
 * `declined` verdict has memory that can gate a finding out. Growth is
 * "this run names at least one site the decision's site list didn't" —
 * recording the same sites again, in any order or count, is not growth.
 */
export function filterByRatificationMemory(options: FilterByRatificationMemoryOptions): Observation[] {
  const { observations, priorRatifications } = options;

  const declinedByFinding = new Map<string, RatificationRecord>();
  for (const record of priorRatifications) {
    if (record.decision === "declined") declinedByFinding.set(record.finding, record);
  }

  return observations.filter((observation) => {
    const declined = declinedByFinding.get(observation.finding);
    if (!declined) return true;
    return observation.sites.some((site) => !declined.sites.includes(site));
  });
}
