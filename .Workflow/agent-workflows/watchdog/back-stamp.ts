import { frontmatterBlock } from "../shared/adr-frontmatter";

export interface DocFile {
  path: string;
  content: string;
}

export interface BackStampWrite {
  path: string;
  content: string;
}

export function adrNumber(path: string): number | undefined {
  const match = /docs\/adr\/(\d{4})-/.exec(path);
  return match ? Number(match[1]) : undefined;
}

function amendsDeclaration(content: string): string | undefined {
  const block = frontmatterBlock(content);
  if (block === undefined) return undefined;
  return block.split("\n").find((line) => line.startsWith("amends:"));
}

export function amendedAdrNumbers(content: string): number[] {
  const declaration = amendsDeclaration(content);
  if (!declaration) return [];
  return [...declaration.matchAll(/ADR-(\d{4})/g)].map((match) => Number(match[1]));
}

export function trailerGraph(files: DocFile[]): Map<number, number[]> {
  const bySuccessor = new Map<number, Set<number>>();

  for (const file of files) {
    const successor = adrNumber(file.path);
    if (successor === undefined) continue;

    for (const predecessor of amendedAdrNumbers(file.content)) {
      if (predecessor === successor) continue; 
      const set = bySuccessor.get(predecessor) ?? new Set<number>();
      set.add(successor);
      bySuccessor.set(predecessor, set);
    }
  }

  const graph = new Map<number, number[]>();
  for (const [predecessor, successors] of bySuccessor) {
    graph.set(predecessor, [...successors].sort((a, b) => a - b));
  }
  return graph;
}

export function statusLine(successors: number[]): string {
  const names = successors.map((n) => `ADR-${String(n).padStart(4, "0")}`).join(", ");
  return `superseded_by: ${names}`;
}

const STATUS_LINE_PREFIX = "superseded_by:";
const STATUS_PREFIX = "status:";

export function withStatusLine(content: string, successors: number[]): string {
  const line = statusLine(successors);
  const block = frontmatterBlock(content);
  if (block === undefined) return content;

  const head = content.indexOf("---\n") + 4;
  const tail = content.indexOf("\n---\n", head);
  const lines = block.split("\n");

  const existing = lines.findIndex((each) => each.startsWith(STATUS_LINE_PREFIX));
  if (existing !== -1) lines[existing] = line;
  else {
    const date = lines.findIndex((each) => each.startsWith("date:"));
    lines.splice(date === -1 ? 0 : date + 1, 0, line);
  }

  const status = lines.findIndex((each) => each.startsWith(STATUS_PREFIX));
  if (status !== -1) lines[status] = "status: superseded";

  const updated = content.slice(0, head) + lines.join("\n") + content.slice(tail);
  return updated === content ? content : updated;
}

export function deriveBackStamps(files: DocFile[]): BackStampWrite[] {
  const graph = trailerGraph(files);
  const writes: BackStampWrite[] = [];

  for (const file of files) {
    const number = adrNumber(file.path);
    if (number === undefined) continue;

    const successors = graph.get(number);
    if (!successors || successors.length === 0) continue;

    const updated = withStatusLine(file.content, successors);
    if (updated !== file.content) writes.push({ path: file.path, content: updated });
  }

  return writes.sort((a, b) => a.path.localeCompare(b.path));
}
