const CALL = /bin\/mark\b|(?<![\w/.-])(?:gh|git)(?![\w-])/;
const QUIET = /(?:#|\/\/)\s*quiet:\s*(.*?)\s*$/m;
const HUNK = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;
const FILE = /^\+\+\+ b\/(.*)$/;
const IGNORE = "(?:\"ignore\"|'ignore')";

const DISCARDS = [
  { pattern: /(?:2|&)>\s*\/dev\/null|>&\s*\/dev\/null|>\s*\/dev\/null\s+2>&1/, says: (call: string) => `sends a ${call} call's stderr to /dev/null` },
  { pattern: /\|\|\s*(?:true\b|:(?![\w:]))/, says: (call: string) => `puts || true on a ${call} call` },
  { pattern: new RegExp(`stdio:\\s*(?:${IGNORE}|\\[[^\\]]*,[^\\]]*,\\s*${IGNORE}\\s*\\])`), says: (call: string) => `spawns a ${call} call with its stderr ignored` },
];

interface Discard {
  at: number;
  says: string;
  quiet?: string;
}

function discardIn(statement: string): Omit<Discard, "at"> | undefined {
  const call = CALL.exec(statement)?.[0];
  if (call === undefined) return undefined;
  const found = DISCARDS.find(({ pattern }) => pattern.test(statement));
  if (found === undefined) return undefined;
  const quiet = QUIET.exec(statement)?.[1];
  return quiet === undefined ? { says: found.says(call) } : { says: found.says(call), quiet };
}

const UNCOUNTED = /"(?:[^"\\]|\\.)*"|'[^']*'|`(?:[^`\\]|\\.)*`|(?:^|\s)(?:#|\/\/).*$/g;
const depthAfter = (depth: number, line: string) => {
  const code = line.replace(UNCOUNTED, " ");
  return Math.max(0, depth + (code.match(/[([]/g)?.length ?? 0) - (code.match(/[)\]]/g)?.length ?? 0));
};

function discardsAmong(lines: { at: number; added?: string }[]): Discard[] {
  const found: Discard[] = [];
  let open: { from: number; lines: string[]; depth: number } | undefined;
  const close = () => {
    const said = open === undefined ? undefined : discardIn(open.lines.join("\n"));
    if (said !== undefined && open !== undefined) found.push({ at: open.from, ...said });
    open = undefined;
  };
  for (const { at, added } of lines) {
    if (added === undefined) {
      close();
      continue;
    }
    open = open === undefined ? { from: at, lines: [added], depth: depthAfter(0, added) } : { ...open, lines: [...open.lines, added], depth: depthAfter(open.depth, added) };
    if (open.depth === 0 && !added.trimEnd().endsWith("\\")) close();
  }
  close();
  return found;
}

export const discardsIn = (source: string): Discard[] => discardsAmong(source.split("\n").map((added, index) => ({ at: index + 1, added })));

export function discards(diff: string): string[] {
  const files: { file: string; lines: { at: number; added?: string }[] }[] = [];
  let at = 0;
  for (const line of diff.split("\n")) {
    const named = FILE.exec(line)?.[1];
    const hunk = HUNK.exec(line)?.[1];
    const current = files.at(-1);
    if (named !== undefined) files.push({ file: named, lines: [] });
    else if (hunk !== undefined) {
      at = Number(hunk);
      current?.lines.push({ at });
    } else if (line.startsWith("+")) {
      current?.lines.push({ at, added: line.slice(1) });
      at += 1;
    } else {
      current?.lines.push({ at });
      if (line.startsWith(" ")) at += 1;
    }
  }
  return files.flatMap(({ file, lines }) => discardsAmong(lines).map(({ at, says, quiet }) => `${file}:${at} ${says}${quiet === undefined ? "" : `, quiet: "${quiet}"`}`));
}
