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

/**
 * The `Amends:` trailer in `content`, as the whole paragraph it opens — from the line starting
 * `Amends:` up to (not including) the next blank line. A paragraph rather than one line because a
 * hand-written trailer wraps: `ADR-0053` amends two predecessors across two lines, and `ADR-0066`
 * trails prose onto a second line after its link. `undefined` when there is no such trailer.
 */
function amendsParagraph(content: string): string | undefined {
  const lines = content.split("\n");
  const start = lines.findIndex((line) => line.startsWith("Amends:"));
  if (start === -1) return undefined;

  let end = lines.findIndex((line, index) => index > start && line.trim() === "");
  if (end === -1) end = lines.length;
  return lines.slice(start, end).join(" ");
}

/**
 * Every ADR number an `Amends:` trailer in `content` names, in the order they appear. Matches both
 * `bin/new-adr --amends`'s plain form (`Amends: ADR-0008`) and the hand-written markdown-link form
 * (`Amends: [ADR-0026](0026-slug.md)`) — both carry the literal `ADR-NNNN`, which is all this reads.
 */
export function amendedAdrNumbers(content: string): number[] {
  const paragraph = amendsParagraph(content);
  if (!paragraph) return [];
  return [...paragraph.matchAll(/ADR-(\d{4})/g)].map((match) => Number(match[1]));
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
  return `Status: superseded by ${names}`;
}

const STATUS_LINE_PREFIX = "Status: superseded by";

/**
 * `content` with its `Status: superseded by …` trailer set to exactly `statusLine(successors)`:
 * replaced in place if one is already there (a later successor can widen an existing stamp),
 * inserted as a new trailer paragraph right after the `Recorded YYYY-MM-DD.` line otherwise — the
 * same position `bin/new-adr --amends` writes its own `Amends:` trailer into. Returns `content`
 * unchanged, the same reference, when the file already carries exactly this line — which is what
 * makes a second run over an already-stamped tree a no-op its caller can detect by `===`.
 */
export function withStatusLine(content: string, successors: number[]): string {
  const line = statusLine(successors);
  const lines = content.split("\n");

  const existing = lines.findIndex((each) => each.startsWith(STATUS_LINE_PREFIX));
  if (existing !== -1) {
    if (lines[existing] === line) return content;
    lines[existing] = line;
    return lines.join("\n");
  }

  const recorded = lines.findIndex((each) => each.startsWith("Recorded "));
  // Every ADR carries a `Recorded YYYY-MM-DD.` line (docs/adr/README.md's format); a file that
  // doesn't is malformed in a way no back-stamp should paper over silently, so the trailer goes
  // right after the title instead of being dropped.
  const anchor = recorded === -1 ? 0 : recorded + 1;
  lines.splice(anchor, 0, "", line);
  return lines.join("\n");
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
