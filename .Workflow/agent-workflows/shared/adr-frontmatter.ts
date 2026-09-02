/**
 * The ADR frontmatter grammar, for the two lanes that write into it.
 *
 * `docs/adr/README.md` declares an ADR's metadata as a YAML block — `status:`, `date:`,
 * `reversal:`, and the derived `amends:`/`superseded_by:` edge. `bin/new-adr` opens every draft
 * with that block, `~/bin/adr_shape.py` refuses a landed ADR missing a key, and
 * `shared/trailer-form.ts` refuses one still carrying the prose grammar this replaced.
 *
 * That leaves two machine writers — the back-stamp, deriving `superseded_by:`, and the accept
 * lane, filling the `reversal:` the shaper drafted — and this module is the one place either of
 * them parses the block. The alternative is the defect the grammar moved into frontmatter to
 * escape: two hand-written readers that disagree about the same line, which is how three ADRs
 * shipped amended-to-a-human and unamended-to-every-machine.
 */

/**
 * The frontmatter block of `content` — the text between the opening `---` and the next `---` —
 * or `undefined` when there is none.
 */
export function frontmatterBlock(content: string): string | undefined {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(content);
  return match ? match[1] : undefined;
}

const REVERSAL_PREFIX = "reversal:";

/**
 * `content` with its `reversal:` key set to `sentence`.
 *
 * **It throws rather than returning `content` unchanged**, on either a missing block or a missing
 * key. Both mean the draft did not come from `bin/new-adr`'s template, and the quiet alternative
 * is an ADR that lands with the one field `adr_shape.validate` refuses — a lane failing at its own
 * push, on a file nobody watched it write, rather than at the line that made the file wrong.
 *
 * The sentence is flattened to one line because the block is YAML and `reversal:` is a scalar: a
 * model-written sentence carrying a newline would end the key mid-value and take the rest of the
 * frontmatter with it.
 */
export function withReversal(content: string, sentence: string): string {
  const block = frontmatterBlock(content);
  if (block === undefined) throw new Error("no frontmatter block to write `reversal:` into");

  const lines = block.split("\n");
  const at = lines.findIndex((line) => line.startsWith(REVERSAL_PREFIX));
  if (at === -1) throw new Error("no `reversal:` key in the frontmatter block");

  lines[at] = `${REVERSAL_PREFIX} ${sentence.replace(/\s+/g, " ").trim()}`;

  const head = content.indexOf("---\n") + 4;
  const tail = content.indexOf("\n---\n", head);
  return content.slice(0, head) + lines.join("\n") + content.slice(tail);
}
