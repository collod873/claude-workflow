/**
 * The one rule that replaced `push-gate.ts` and `land-gate.ts` (#360): an acceptance test lives
 * beside its subject and lands on `main` green, marked `test.fails(` because the ticket it names
 * is not built yet. The implement lane's pull request may change such a line in exactly one way —
 * dropping `.fails` — and may not otherwise touch a `test.fails(` test at all. Anything else is
 * an implementer editing the judgement it is judged by, which is what the immutable
 * `tests/acceptance/` directory used to forbid by location.
 *
 * Judged on a unified diff, never on a checkout: the diff is what the pull request carries and
 * what the Immutability job already reads, so no lane has to reconstruct trunk to apply this.
 */

/** A `test.fails(` or `it.fails(` opener, anywhere on a line. */
const FAILS_CALL = /\b(test|it)\.fails\(/;

/** The same line with `.fails` dropped — the only edit an implementer may make to it. */
function withoutFails(line: string): string {
  return line.replace(FAILS_CALL, "$1(");
}

export type FailsRuleVerdict = { ok: true } | { ok: false; reason: string };

/**
 * Reads `diff` (unified, as `git diff` or the pull-request API prints it) and refuses when it edits
 * a `test.fails(` line other than by removing `.fails`, or deletes one outright.
 *
 * A removed `-test.fails(...)` line is legal only when the very next added line is the same line
 * minus `.fails`; a removed one with no such twin is a deleted acceptance test. An added
 * `+test.fails(` line is legal — that is how the acceptance author lands one — so the rule never
 * refuses a pull request for adding a red test, only for touching a standing one.
 */
export function judgeFailsEdits(diff: string): FailsRuleVerdict {
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
      `${offences.length} acceptance test(s) marked test.fails( were edited beyond removing .fails — ` +
      `an implementer may turn one green, never rewrite or delete it:\n` +
      offences.map((offence) => `  ${offence}`).join("\n"),
  };
}
