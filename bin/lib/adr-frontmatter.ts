export function frontmatterBlock(content: string): string | undefined {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(content);
  return match ? match[1] : undefined;
}

const REVERSAL_PREFIX = "reversal:";

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
