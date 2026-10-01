const CALL = /bin\/mark\b|(?<![\w/.-])(?:gh|git)(?![\w-])/;
const QUIET = /(?:#|\/\/)\s*quiet:\s*(.*?)\s*$/m;
const HUNK = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;
const FILE = /^\+\+\+ b\/(.*)$/;
const IGNORE = "(?:\"ignore\"|'ignore')";

const DISCARDS = [
  { pattern: /(?:2|&)>\s*\/dev\/null|>&\s*\/dev\/null|>\s*\/dev\/null\s+2>&1/, says: (call: string) => `sends a ${call} call's stderr to /dev/null` },
  { pattern: /\|\|\s*true\b/, says: (call: string) => `puts || true on a ${call} call` },
  { pattern: new RegExp(`stdio:\\s*(?:${IGNORE}|\\[[^\\]]*,[^\\]]*,\\s*${IGNORE}\\s*\\])`), says: (call: string) => `spawns a ${call} call with its stderr ignored` },
];

function discardIn(statement: string): string | undefined {
  const call = CALL.exec(statement)?.[0];
  if (call === undefined) return undefined;
  const found = DISCARDS.find(({ pattern }) => pattern.test(statement));
  if (found === undefined) return undefined;
  const quiet = QUIET.exec(statement)?.[1];
  return quiet === undefined ? found.says(call) : `${found.says(call)}, quiet: "${quiet}"`;
}

const depthAfter = (depth: number, line: string) => Math.max(0, depth + (line.match(/[([]/g)?.length ?? 0) - (line.match(/[)\]]/g)?.length ?? 0));

export function discards(diff: string): string[] {
  const found: string[] = [];
  let file = "";
  let at = 0;
  let open: { from: number; lines: string[]; depth: number } | undefined;
  const close = () => {
    const said = open === undefined ? undefined : discardIn(open.lines.join("\n"));
    if (said !== undefined && open !== undefined) found.push(`${file}:${open.from} ${said}`);
    open = undefined;
  };
  for (const line of diff.split("\n")) {
    const named = FILE.exec(line)?.[1];
    const hunk = HUNK.exec(line)?.[1];
    if (!line.startsWith("+") || named !== undefined) close();
    if (named !== undefined) file = named;
    else if (hunk !== undefined) at = Number(hunk);
    else if (line.startsWith("+")) {
      const added = line.slice(1);
      open = open === undefined ? { from: at, lines: [added], depth: depthAfter(0, added) } : { ...open, lines: [...open.lines, added], depth: depthAfter(open.depth, added) };
      if (open.depth === 0 && !added.trimEnd().endsWith("\\")) close();
      at += 1;
    } else if (line.startsWith(" ")) at += 1;
  }
  close();
  return found;
}
