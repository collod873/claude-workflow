import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { absolute, commandLine, LANE_STAGE_NAMES_TEST, runVitest } from "./274-stage-names.fixture";

/**
 * #274 — "Batch-migrate the remaining ten runStage call sites to supply a stage name".
 *
 * The criterion is about the *source text* of ten files: each `runStage` call's `StageOptions`
 * literal has to carry a `stage` key. So this file reads those files the way a shell would — no
 * import of the subject, which the acceptance boundary forbids — and parses each call itself:
 * balance the call's parentheses, split its top-level arguments, take the last one, and look for a
 * top-level `stage:` entry in it.
 *
 * The reader is deliberately a scanner rather than a regex. Every one of these call sites writes its
 * `StageOptions` across several lines, several of them carry `//` comments inside the literal whose
 * prose contains apostrophes and commas (`review.ts`, `refuter.ts`, `critic.ts`), and the argument
 * before it is an object of substituted strings that themselves contain braces, brackets and
 * commas. A regex over that text answers a different question than the criterion asks.
 */

/**
 * The ten call sites the ticket names, with how many `runStage` calls each carries — `review.ts`
 * has two ("review.ts (both calls)"), the other nine have one apiece.
 */
const CALL_SITES: ReadonlyArray<{ file: string; calls: number }> = [
  { file: ".Workflow/agent-workflows/spec/spec.ts", calls: 1 },
  { file: ".Workflow/agent-workflows/spec/sweep.ts", calls: 1 },
  { file: ".Workflow/agent-workflows/spec/critic.ts", calls: 1 },
  { file: ".Workflow/agent-workflows/spec/reconcile.ts", calls: 1 },
  { file: ".Workflow/agent-workflows/spec/amend.ts", calls: 1 },
  { file: ".Workflow/agent-workflows/review/review.ts", calls: 2 },
  { file: ".Workflow/agent-workflows/review/refuter.ts", calls: 1 },
  { file: ".Workflow/agent-workflows/implement/implement.ts", calls: 1 },
  { file: ".Workflow/agent-workflows/fixer/fixer.ts", calls: 1 },
  { file: ".Workflow/agent-workflows/acceptance/acceptance.ts", calls: 1 },
];

const EXPECTED_CALLS = CALL_SITES.reduce((total, site) => total + site.calls, 0);

/** A file's text, or `""` when it is not there — a missing file fails an assertion, never the read. */
function readSource(relative: string): string {
  try {
    return readFileSync(absolute(relative), "utf8");
  } catch {
    return "";
  }
}

/**
 * The index just past the string literal starting at `start`, or `-1` when it never closes.
 * Template literals are followed through their `${…}` interpolations, so a brace inside one cannot
 * be mistaken for structure.
 */
function skipString(text: string, start: number): number {
  const quote = text[start];
  let i = start + 1;
  while (i < text.length) {
    const ch = text[i];
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === quote) return i + 1;
    if (quote === "`" && ch === "$" && text[i + 1] === "{") {
      let depth = 1;
      i += 2;
      while (i < text.length && depth > 0) {
        const inner = text[i];
        if (inner === "\\") {
          i += 2;
          continue;
        }
        if (inner === '"' || inner === "'" || inner === "`") {
          const next = skipString(text, i);
          if (next === -1) return -1;
          i = next;
          continue;
        }
        if (inner === "{") depth += 1;
        if (inner === "}") depth -= 1;
        i += 1;
      }
      continue;
    }
    i += 1;
  }
  return -1;
}

/** Where a scan should carry on from, when `text[i]` opens a comment or a string. Otherwise `-1`. */
function skipTrivia(text: string, i: number): number {
  const ch = text[i];
  if (ch === "/" && text[i + 1] === "/") {
    const newline = text.indexOf("\n", i);
    return newline === -1 ? text.length : newline;
  }
  if (ch === "/" && text[i + 1] === "*") {
    const end = text.indexOf("*/", i + 2);
    return end === -1 ? text.length : end + 2;
  }
  if (ch === '"' || ch === "'" || ch === "`") {
    const next = skipString(text, i);
    return next === -1 ? text.length : next;
  }
  return -1;
}

/** The whole `(…)` of a call whose opening parenthesis is at `open`, or `null` when it never closes. */
function balancedCall(text: string, open: number): string | null {
  let depth = 0;
  let i = open;
  while (i < text.length) {
    const skipped = skipTrivia(text, i);
    if (skipped !== -1) {
      i = skipped;
      continue;
    }
    const ch = text[i];
    if (ch === "(" || ch === "[" || ch === "{") {
      depth += 1;
      i += 1;
      continue;
    }
    if (ch === ")" || ch === "]" || ch === "}") {
      depth -= 1;
      i += 1;
      if (depth === 0) return text.slice(open, i);
      continue;
    }
    i += 1;
  }
  return null;
}

/** `body` split on the commas that sit outside every brace, bracket, parenthesis, string and comment. */
function splitTopLevel(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  let i = 0;
  while (i < body.length) {
    const skipped = skipTrivia(body, i);
    if (skipped !== -1) {
      i = skipped;
      continue;
    }
    const ch = body[i];
    if (ch === "(" || ch === "[" || ch === "{") depth += 1;
    else if (ch === ")" || ch === "]" || ch === "}") depth -= 1;
    else if (ch === "," && depth === 0) {
      parts.push(body.slice(start, i));
      start = i + 1;
    }
    i += 1;
  }
  parts.push(body.slice(start));
  return parts.map((part) => part.trim()).filter((part) => part.length > 0);
}

/** One object-literal entry, split at its first top-level colon. `null` for a spread or a shorthand. */
function splitEntry(entry: string): { key: string; value: string } | null {
  let depth = 0;
  let i = 0;
  while (i < entry.length) {
    const skipped = skipTrivia(entry, i);
    if (skipped !== -1) {
      i = skipped;
      continue;
    }
    const ch = entry[i];
    if (ch === "(" || ch === "[" || ch === "{") depth += 1;
    else if (ch === ")" || ch === "]" || ch === "}") depth -= 1;
    else if (ch === ":" && depth === 0) {
      return { key: entry.slice(0, i).trim(), value: entry.slice(i + 1).trim() };
    }
    i += 1;
  }
  return null;
}

/** A key as written, with any quotes taken off: `stage`, `"stage"` and `'stage'` are one key. */
function unquote(key: string): string {
  const first = key[0];
  if ((first === '"' || first === "'") && key[key.length - 1] === first) return key.slice(1, -1);
  return key;
}

/** The text of a non-empty string literal, or `null` when `value` is not one. */
function stringLiteral(value: string): string | null {
  const first = value[0];
  if (first !== '"' && first !== "'" && first !== "`") return null;
  if (value.length < 2 || value[value.length - 1] !== first) return null;
  if (first === "`" && value.includes("${")) return null;
  const inner = value.slice(1, -1);
  return inner.trim().length === 0 ? null : inner;
}

interface RunStageCall {
  line: number;
  /** The call's `(…)`, or `null` when its parentheses never balanced. */
  text: string | null;
}

/** Whether the text before `index` on its own line makes this a mention in a comment rather than a call. */
function inCommentLine(source: string, index: number): boolean {
  const lineStart = source.lastIndexOf("\n", index) + 1;
  const before = source.slice(lineStart, index).trim();
  return before.startsWith("*") || before.startsWith("//") || before.startsWith("/*");
}

function lineOf(source: string, index: number): number {
  return source.slice(0, index).split("\n").length;
}

/** Every `runStage(` call in a file — prose in a docstring that merely names one is not a call. */
function runStageCalls(source: string): RunStageCall[] {
  const needle = "runStage(";
  const calls: RunStageCall[] = [];
  let at = source.indexOf(needle);
  while (at !== -1) {
    const before = source[at - 1] ?? "";
    if (!/[A-Za-z0-9_$]/.test(before) && !inCommentLine(source, at)) {
      calls.push({ line: lineOf(source, at), text: balancedCall(source, at + needle.length - 1) });
    }
    at = source.indexOf(needle, at + needle.length);
  }
  return calls;
}

/** What one call's last argument turned out to be, and what it says about `stage`. */
function stageKeyOf(callText: string): { ok: true; name: string } | { ok: false; why: string } {
  const args = splitTopLevel(callText.slice(1, -1));
  if (args.length === 0) return { ok: false, why: "the call has no arguments at all" };

  const options = args[args.length - 1];
  if (!options.startsWith("{") || !options.endsWith("}")) {
    return {
      ok: false,
      why: `its last argument is not a StageOptions object literal — it reads ${JSON.stringify(options)}`,
    };
  }

  const entries = splitTopLevel(options.slice(1, -1)).map(splitEntry);
  const keys = entries
    .filter((entry): entry is { key: string; value: string } => entry !== null)
    .map((entry) => ({ key: unquote(entry.key), value: entry.value }));

  const stage = keys.find((entry) => entry.key === "stage");
  if (stage === undefined) {
    const found = keys.map((entry) => entry.key).join(", ") || "(no keys at all)";
    return { ok: false, why: `its StageOptions literal carries no \`stage\` key — it has: ${found}` };
  }

  const name = stringLiteral(stage.value);
  if (name === null) {
    return {
      ok: false,
      why: `its \`stage\` key is not the literal name the ticket asks for — it reads \`stage: ${stage.value}\``,
    };
  }
  return { ok: true, name };
}

describe("#274 — the remaining ten runStage call sites supply a stage name", () => {
  // Criterion, verbatim from the ticket:
  // "Every one of the ten call sites' StageOptions literal includes a stage key — check: `npx vitest run .Workflow/agent-workflows/shared/lane-stage-names.test.ts`"
  it("Every one of the ten call sites' StageOptions literal includes a stage key — check: `npx vitest run .Workflow/agent-workflows/shared/lane-stage-names.test.ts`", () => {
    const problems: string[] = [];
    const named: string[] = [];
    let seen = 0;

    for (const site of CALL_SITES) {
      const source = readSource(site.file);
      if (source === "") {
        problems.push(`${site.file}: could not be read — the ticket claims this file`);
        continue;
      }

      const calls = runStageCalls(source);
      if (calls.length < site.calls) {
        problems.push(
          `${site.file}: found ${calls.length} runStage call(s), and the ticket names ${site.calls}`,
        );
      }

      for (const call of calls) {
        seen += 1;
        if (call.text === null) {
          problems.push(`${site.file}:${call.line}: the runStage call's parentheses never close`);
          continue;
        }
        const verdict = stageKeyOf(call.text);
        if (verdict.ok) named.push(`${site.file}:${call.line} → ${verdict.name}`);
        else problems.push(`${site.file}:${call.line}: ${verdict.why}`);
      }
    }

    expect(
      problems,
      `every runStage call in the ten files #274 claims has to pass a literal \`stage: "<name>"\` in its ` +
        `StageOptions.\n\nWhat is still missing one:\n${problems.join("\n")}\n\n` +
        `What already names its stage:\n${named.join("\n") || "(none)"}`,
    ).toEqual([]);

    expect(
      seen,
      `the ten call sites carry ${EXPECTED_CALLS} runStage calls between them — review.ts has both of ` +
        `its two — and only ${seen} were found, so at least one call site has gone missing rather than ` +
        `been migrated.`,
    ).toBeGreaterThanOrEqual(EXPECTED_CALLS);

    // The criterion's own check, run the way a shell runs it.
    const args = [LANE_STAGE_NAMES_TEST];
    const run = runVitest(args);
    expect(
      run.status,
      `\`${commandLine(args)}\` — the check this criterion names — did not exit 0:\n${run.output}`,
    ).toBe(0);
  }, 900_000);
});
