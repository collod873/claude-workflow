import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { repoRoot } from "./workflow-shape.fixture";

/**
 * The record readers #264's four ADR criteria share.
 *
 * Not a `.test.ts`, so `vitest.config.ts`'s `tests/acceptance/**\/*.test.ts` include never collects
 * it as a suite — it is only ever imported by one. `.fixture.ts` is the name this directory already
 * gives a file whose job is to be unreachable from a lane.
 *
 * Four of #264's five criteria ask the same two questions of the same directory — *which records are
 * under `docs/adr`*, and *which of them carry the literal text `Amends: ADR-nnnn`* — so the walk and
 * the match live here once. Written into each test file instead, it would be four copies of one
 * directory walk, which is the divergence this directory's fixture convention exists to prevent and
 * which `bin/clone-gate` reports on push.
 *
 * These are deliberately literal substring readers rather than a markdown parser. The criteria's own
 * checks are `grep` over the directory, and what a `grep -rl 'Amends: ADR-0100'` sees is the file's
 * text: a record that spells the trailer any other way does not satisfy the criterion, so a reader
 * that normalises the spelling away would be asserting something looser than the ticket asks for.
 *
 * A missing `docs/adr` reads as no records rather than as an exception, because `grep -r` over a
 * directory that is not there finds nothing — and a criterion has to come back red, not throw.
 */

/** The record directory, as `grep -r ... docs/adr` names it. */
export const ADR_DIR = path.join(repoRoot, "docs", "adr");

/** One file under `docs/adr`, with the text a `grep -r` would be reading. */
export interface RecordFile {
  /** Path relative to the checkout root — `docs/adr/0100-....md`. */
  relative: string;
  absolute: string;
  text: string;
}

function entriesOf(dir: string) {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function filesUnder(dir: string, out: string[]): void {
  for (const entry of entriesOf(dir)) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) filesUnder(full, out);
    else if (entry.isFile()) out.push(full);
  }
}

/**
 * Every file under `docs/adr`, recursively and in path order — every file rather than every `.md`,
 * because the criteria's checks are `grep -r` over the directory and so is this.
 */
export function adrFiles(): RecordFile[] {
  const found: string[] = [];
  filesUnder(ADR_DIR, found);
  const records: RecordFile[] = [];
  for (const absolute of found.sort()) {
    let text: string;
    try {
      text = readFileSync(absolute, "utf8");
    } catch {
      continue;
    }
    records.push({ absolute, relative: path.relative(repoRoot, absolute), text });
  }
  return records;
}

/** Every record whose text carries `needle`, the way `grep -rl` would list it. */
export function adrsContaining(needle: string): RecordFile[] {
  return adrFiles().filter((file) => file.text.includes(needle));
}

/**
 * Every record landing an amendment on `target` (`"ADR-0100"`), matched on the trailer's literal
 * text because that is exactly what the criteria's `grep` matches on.
 */
export function amendingAdrs(target: string): RecordFile[] {
  return adrsContaining(`Amends: ${target}`);
}

/** The relative paths of `files`, so a failure message names what was actually found. */
export function names(files: RecordFile[]): string[] {
  return files.map((file) => file.relative);
}

/** What a message should say when a list of records is empty. */
export function listed(files: RecordFile[]): string {
  const found = names(files);
  return found.length === 0 ? "(none)" : found.join(", ");
}
