/**
 * The judgement half of the back-stamp (#125, `./back-stamp-walk.ts` is the IO half): derives the
 * `Status: superseded by ADR-NNNN` line a predecessor ADR needs from the `Amends:` trailers its
 * successors already carry.
 *
 * `docs/adr/README.md` said all along that a superseded ADR gains a `superseded by ADR-NNNN`
 * status line — *"the point of the record is that you can see the mind change"* — and **zero of
 * 43 ADRs ever carried one**
 * ([ADR-0044](../../../docs/adr/0044-an-unread-document-cannot-be-detected-so-the-backwards-quest.md)).
 * [ADR-0045](../../../docs/adr/0045-a-superseded-adr-is-named-by-a-trailer-its-successor-writes.md)
 * is why this reads a trailer instead of prose: supersession is declared in a machine-readable
 * `Amends:` trailer (`bin/new-adr --amends NNNN`), not inferred from a verb grep — the vocabulary
 * across this repo's own ADRs is five different words for it, and one of them (`extends`) is not
 * supersession at all.
 *
 * **Recomputed, never stored.** Every run reads the whole `docs/adr/` corpus and derives the graph
 * fresh, so nothing here can go stale and a second run over an already-stamped tree finds nothing
 * left to write ([ADR-0045](../../../docs/adr/0045-a-superseded-adr-is-named-by-a-trailer-its-successor-writes.md)'s
 * consequence).
 *
 * **Only ADRs are ever a predecessor.** The status line names an ADR number, and only a file under
 * `docs/adr/` has one. A `docs/research/` note gets a different treatment on the same trailer graph
 * — *"does it name the issue it answers? File an issue against it"* — which is a separate,
 * file-scoped mechanism, not this one
 * ([ADR-0044](../../../docs/adr/0044-an-unread-document-cannot-be-detected-so-the-backwards-quest.md)'s
 * table).
 */

import { frontmatterBlock } from "../shared/adr-frontmatter";

/** One document as this module needs it: a repo-relative path and its full text. */
export interface DocFile {
  path: string;
  content: string;
}

/** One file this module will write, and the content it needs to carry. */
export interface BackStampWrite {
  path: string;
  content: string;
}

/** The ADR number `path` declares by its own filename — `docs/adr/0032-....md` is `32`. */
export function adrNumber(path: string): number | undefined {
  const match = /docs\/adr\/(\d{4})-/.exec(path);
  return match ? Number(match[1]) : undefined;
}

/** The `amends:` declaration line, or `undefined`. */
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

/**
 * The predecessor → successors graph over `files`: every ADR number some file's `Amends:` trailer
 * names, mapped to the sorted, deduplicated list of ADR numbers that name it. A predecessor named
 * only by a file with no ADR number of its own (a `docs/research/` note, say) contributes nothing —
 * see this module's own header for why only an ADR can be a successor here.
 */
export function trailerGraph(files: DocFile[]): Map<number, number[]> {
  const bySuccessor = new Map<number, Set<number>>();

  for (const file of files) {
    const successor = adrNumber(file.path);
    if (successor === undefined) continue;

    for (const predecessor of amendedAdrNumbers(file.content)) {
      if (predecessor === successor) continue; // an ADR cannot supersede itself
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

/** The status line for a predecessor superseded by `successors` (sorted ascending, at least one). */
export function statusLine(successors: number[]): string {
  const names = successors.map((n) => `ADR-${String(n).padStart(4, "0")}`).join(", ");
  return `superseded_by: ${names}`;
}

const STATUS_LINE_PREFIX = "superseded_by:";
const STATUS_PREFIX = "status:";

/**
 * `content` with its `superseded_by:` key set to exactly `statusLine(successors)`: replaced in
 * place if one is already there (a later successor can widen an existing stamp), inserted into the
 * frontmatter block right after `date:` otherwise — beside the `amends:` key `bin/new-adr
 * --amends` writes, which is the edge this one is derived from. Returns `content`
 * unchanged, the same reference, when the file already carries exactly this line — which is what
 * makes a second run over an already-stamped tree a no-op its caller can detect by `===`.
 */
export function withStatusLine(content: string, successors: number[]): string {
  const line = statusLine(successors);
  const block = frontmatterBlock(content);
  // A file with no frontmatter is malformed in a way no back-stamp should paper over: writing a
  // derived key into a document the readers cannot parse would produce a stamp nothing can find.
  if (block === undefined) return content;

  const head = content.indexOf("---\n") + 4;
  const tail = content.indexOf("\n---\n", head);
  const lines = block.split("\n");

  const existing = lines.findIndex((each) => each.startsWith(STATUS_LINE_PREFIX));
  if (existing !== -1) lines[existing] = line;
  else {
    // After `date:` when there is one, so the derived key sits with the other metadata rather
    // than after the prose `reversal:` sentence, which is the field a reader scans for.
    const date = lines.findIndex((each) => each.startsWith("date:"));
    lines.splice(date === -1 ? 0 : date + 1, 0, line);
  }

  // The status is derived too. An ADR whose ruling has been replaced is not a live constraint,
  // and leaving it saying `constraint` is exactly the lie the whole re-admission removed.
  const status = lines.findIndex((each) => each.startsWith(STATUS_PREFIX));
  if (status !== -1) lines[status] = "status: superseded";

  const updated = content.slice(0, head) + lines.join("\n") + content.slice(tail);
  return updated === content ? content : updated;
}

/**
 * Every file among `files` that needs a `Status:` line written or updated, with the content it
 * should be replaced by. Only files with an ADR number of their own that some `Amends:` trailer in
 * `files` names come back, and only when the derived line differs from what the file already
 * carries — so a tree that is already correctly stamped derives an empty list, the property the
 * IO half turns into "zero commits" on a second run.
 */
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
