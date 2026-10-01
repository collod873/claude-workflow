const CALL = /bin\/mark\b|(?<![\w/.-])(?:gh|git)(?![\w-])/;
const QUIET = /(?:#|\/\/)\s*quiet:\s*(.*?)\s*$/;
const HUNK = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;
const FILE = /^\+\+\+ b\/(.*)$/;

const DISCARDS = [
  { pattern: /(?:2|&)>\s*\/dev\/null|>\s*\/dev\/null\s+2>&1/, says: (call: string) => `sends a ${call} call's stderr to /dev/null` },
  { pattern: /\|\|\s*true\b/, says: (call: string) => `puts || true on a ${call} call` },
  { pattern: /stdio:\s*(?:"ignore"|\[[^\]]*,[^\]]*,\s*"ignore"\s*\])/, says: (call: string) => `spawns a ${call} call with its stderr ignored` },
];

function discardIn(line: string): string | undefined {
  const call = CALL.exec(line)?.[0];
  if (call === undefined) return undefined;
  const found = DISCARDS.find(({ pattern }) => pattern.test(line));
  if (found === undefined) return undefined;
  const quiet = QUIET.exec(line)?.[1];
  return quiet === undefined ? found.says(call) : `${found.says(call)}, quiet: "${quiet}"`;
}

export function discards(diff: string): string[] {
  const found: string[] = [];
  let file = "";
  let at = 0;
  for (const line of diff.split("\n")) {
    const named = FILE.exec(line)?.[1];
    const hunk = HUNK.exec(line)?.[1];
    if (named !== undefined) file = named;
    else if (hunk !== undefined) at = Number(hunk);
    else if (line.startsWith("+")) {
      const said = discardIn(line.slice(1));
      if (said !== undefined) found.push(`${file}:${at} ${said}`);
      at += 1;
    } else if (line.startsWith(" ")) at += 1;
  }
  return found;
}
