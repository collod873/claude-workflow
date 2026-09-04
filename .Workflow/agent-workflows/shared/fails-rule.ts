const FAILS_CALL = /\b(test|it)\.fails\(/;

function withoutFails(line: string): string {
  return line.replace(FAILS_CALL, "$1(");
}

export type FailsRuleVerdict = { ok: true } | { ok: false; reason: string };

export function judgeFailsEdits(diff: string, declaredPaths: Set<string> = new Set()): FailsRuleVerdict {
  const lines = diff.split("\n");
  const offences: string[] = [];
  let file = "";
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("+++ ")) {
      file = line.slice(4).replace(/^b\//, "");
      continue;
    }
    if (!line.startsWith("-") || line.startsWith("---")) continue;
    const removed = line.slice(1);
    if (!FAILS_CALL.test(removed)) continue;
    if (declaredPaths.has(file)) continue;
    const next = lines[i + 1] ?? "";
    if (next.startsWith("+") && next.slice(1) === withoutFails(removed)) {
      i++;
      continue;
    }
    offences.push(`${file}: ${removed.trim()}`);
  }
  if (offences.length === 0) return { ok: true };
  return {
    ok: false,
    reason:
      `${offences.length} acceptance test(s) marked test.fails( were edited beyond removing .fails: ` +
      `an implementer may turn one green, never rewrite or delete it:\n` +
      offences.map((offence) => `  ${offence}`).join("\n"),
  };
}
