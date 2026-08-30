import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { repoRoot } from "./workflow-shape.fixture";

/**
 * The source readers #273's three acceptance tests share.
 *
 * Not a `.test.ts`, so `vitest.config.ts`'s `tests/acceptance/**\/*.test.ts` include never collects
 * it as a suite — it is only ever imported by the three test files beside it. `.fixture.ts` is the
 * name this directory already gives a file whose job is to be unreachable from a lane.
 *
 * All three of #273's criteria are claims about the *text* of one file — which declarations
 * `shape.ts` keeps, which options its `runStage` calls carry, and which module its `handoffPath`
 * comes from — so all three need the same two things: the file's absolute path, and its source with
 * comments taken out. Written into each test instead, that would be three copies of one comment
 * stripper, which is exactly the divergence this directory's fixture convention exists to prevent
 * (`bin/clone-gate` reports the copies on push).
 *
 * **Why comments are stripped and nothing else is.** The criteria are about what the file *does*,
 * not about what it says it used to do: a docstring in the rewritten `shape.ts` may perfectly well
 * mention that `preservingRaw` moved into `runStage`, and a reader that counted that sentence would
 * be red for a reason having nothing to do with the ticket. What is left after stripping is the
 * code, and the code is where a kept copy would have to live.
 *
 * A missing file reads as empty text rather than as an exception, so a criterion comes back red on
 * its own assertion instead of blowing up the file.
 */

const laneRoot = path.join(repoRoot, ".Workflow", "agent-workflows");

/** The file #273 claims and rewrites. */
export const SHAPE_SOURCE = path.join(laneRoot, "shape", "shape.ts");

/** The shared seam `shape.ts` is repointed onto — `handoffPath`'s one home. */
export const SHARED_HANDOFF_PATH_SOURCE = path.join(laneRoot, "shared", "handoff-path.ts");

/** The test file #273 creates, which both of its first two check commands name. */
export const SHAPE_STAGE_NAMES_TEST = path.join(laneRoot, "shape", "shape-stage-names.test.ts");

/** The first two criteria's check argument, exactly as the ticket spells it. */
export const SHAPE_STAGE_NAMES_TEST_ARG =
  ".Workflow/agent-workflows/shape/shape-stage-names.test.ts";

/** The third criterion's check argument — the whole shape suite. */
export const SHAPE_SUITE_ARG = ".Workflow/agent-workflows/shape";

/** A source file's text, or `""` when it does not exist. */
export function readSource(file: string): string {
  return existsSync(file) ? readFileSync(file, "utf8") : "";
}

/**
 * `text` with its `//` and block comments removed and its string literals left alone.
 *
 * Deliberately a small scanner rather than a parser: what the criteria are about is whether an
 * identifier is still *written* in the file, and a scanner that knows quotes from slashes answers
 * that. String bodies are kept because a stage name is a string literal, and criterion 2 reads it.
 */
export function stripComments(text: string): string {
  let out = "";
  let i = 0;

  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1];

    if (ch === "/" && next === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      continue;
    }

    if (ch === "/" && next === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i += 2;
      continue;
    }

    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      out += ch;
      i++;
      while (i < text.length) {
        if (text[i] === "\\") {
          out += text[i] + (text[i + 1] ?? "");
          i += 2;
          continue;
        }
        out += text[i];
        const closing = text[i] === quote;
        i++;
        if (closing) break;
      }
      continue;
    }

    out += ch;
    i++;
  }

  return out;
}

/** `shape.ts`'s code, comments removed — the text every #273 criterion reads. */
export function shapeCode(): string {
  return stripComments(readSource(SHAPE_SOURCE));
}

/**
 * The lines of `code` in which `identifier` appears as a whole word, each prefixed with its line
 * number — so a failed absence assertion names what was found rather than only that something was.
 */
export function linesMentioning(code: string, identifier: string): string[] {
  const word = new RegExp(String.raw`\b${identifier}\b`);
  return code
    .split("\n")
    .map((line, index) => ({ line: line.trim(), number: index + 1 }))
    .filter((entry) => word.test(entry.line))
    .map((entry) => `${entry.number}: ${entry.line}`);
}
