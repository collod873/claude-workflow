import type { GitExec } from "./git";
import type { Observation } from "./observation-schema";
import { RatificationRecord } from "./ratification-schema";

const NOTES_REF = "ratifications";

const RECORD_SEP = "\x1e";

export interface WriteRatificationNoteOptions {
  git: GitExec;
  repoDir: string;
  commit: string;
  records: RatificationRecord[];
}

export function writeRatificationNote(options: WriteRatificationNoteOptions): void {
  const { git, repoDir, commit, records } = options;
  const message = JSON.stringify(RatificationRecord.array().parse(records));
  git(["-C", repoDir, "notes", `--ref=${NOTES_REF}`, "add", "-f", "-m", message, commit]);
}

export interface ReadRatificationRecordsOptions {
  git: GitExec;
  repoDir: string;
  base?: string;
  head: string;
}

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
  observations: Observation[];
  priorRatifications: RatificationRecord[];
}

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
