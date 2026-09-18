import type { z } from "zod";
import type { GitExec } from "./git.ts";

const RECORD_SEP = "\x1e";
const FIELD_SEP = "\x1f";

export interface WriteNoteArrayOptions<T> {
  git: GitExec;
  repoDir: string;
  ref: string;
  commit: string;
  records: T[];
  schema: z.ZodType<T>;
}

export function writeNoteArray<T>(options: WriteNoteArrayOptions<T>): void {
  const { git, repoDir, ref, commit, records, schema } = options;
  const message = JSON.stringify(schema.array().parse(records));
  git(["-C", repoDir, "notes", `--ref=${ref}`, "add", "-f", "-m", message, commit]);
}

export interface ReadNoteArrayOptions<T> {
  git: GitExec;
  repoDir: string;
  ref: string;
  base?: string;
  head: string;
  schema: z.ZodType<T>;
}

export interface CommitNoteArray<T> {
  commit: string;
  records: T[];
}

export function readNoteArray<T>(options: ReadNoteArrayOptions<T>): CommitNoteArray<T>[] {
  const { git, repoDir, ref, base, head, schema } = options;
  const range = base ? `${base}..${head}` : head;
  const format = `%H${FIELD_SEP}%N${RECORD_SEP}`;
  const raw = git(["-C", repoDir, "log", range, `--notes=${ref}`, `--format=${format}`]);

  const results: CommitNoteArray<T>[] = [];
  for (const record of raw.split(RECORD_SEP)) {
    if (!record.trim()) continue;

    const sepIndex = record.indexOf(FIELD_SEP);
    const commit = (sepIndex === -1 ? record : record.slice(0, sepIndex)).trim();
    const note = (sepIndex === -1 ? "" : record.slice(sepIndex + FIELD_SEP.length)).trim();
    if (!note) continue;

    results.push({ commit, records: schema.array().parse(JSON.parse(note)) });
  }
  return results;
}
