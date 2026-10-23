import { readFileSync } from "node:fs";

export const BUCKETS = "docs/buckets.md";
const HEADER = "| Bucket | Evidence | Prevention | State |";
const CELL_CAP = 300;
const STATE = /^(unruled|ruled|built|measured)( \([^()]+\))?$/;

export const builtState = (ticket: string) => `built (#${ticket})`;

export const cellsOf = (line: string): string[] => line.slice(2, -2).split(" | ");

function misshapen(table: string): string[] {
  const lines = table.split("\n");
  const header = lines.indexOf(HEADER);
  if (header === -1) return [`${BUCKETS} has no table headed ${HEADER}`];
  const rows = lines.slice(header + 2).filter((line) => line.startsWith("| "));
  return rows.flatMap((line) => {
    const cells = cellsOf(line);
    const [bucket = "", , , state = ""] = cells;
    const where = `${BUCKETS} row ${JSON.stringify(bucket.slice(0, 60))}`;
    if (cells.length !== 4 || !line.endsWith(" |")) return [`${where} has ${cells.length} cells, not 4`];
    const long = cells.filter((cell) => cell.length > CELL_CAP).map((cell) => `${where} has a cell of ${cell.length} characters, over ${CELL_CAP}: rewrite it, the old text is in git`);
    const stated = STATE.test(state) ? [] : [`${where} has the State ${JSON.stringify(state.slice(0, 60))}, not unruled, ruled, built or measured with its issues in brackets`];
    return [...long, ...stated];
  });
}

if (import.meta.main) {
  const refused = misshapen(readFileSync(BUCKETS, "utf8"));
  for (const refusal of refused) console.log(refusal);
  process.exit(refused.length > 0 ? 1 : 0);
}
