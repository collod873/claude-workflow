import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { expectVitestPasses } from "./261-spec-sweep.fixture";
import {
  SHAPE_SOURCE,
  SHAPE_STAGE_NAMES_TEST,
  SHAPE_STAGE_NAMES_TEST_ARG,
  readSource,
  shapeCode,
} from "./273-shape.fixture";

/**
 * #273, criterion 2.
 *
 * The claim is per call site — *each* of the three stages supplies *its own* name — so the reader
 * below pulls each `runStage(` call's arguments out of `shape.ts` whole, and then asks of each one
 * the two questions the criterion joins: which prompt does this call run, and which stage name does
 * it hand `runStage`. Asserting only that the three strings appear somewhere in the file would be
 * satisfied by a file that passed `"sweep"` three times, which is the failure this criterion names.
 *
 * The prompt is what identifies a call, because it is the one argument that is already there and
 * that no part of this ticket moves: `PROMPTS.sweep` is the sweep's call whatever else changes
 * around it.
 */

/** The three stages, and the `PROMPTS` key each one's call already names. */
const STAGES = ["sweep", "shaper", "refuter"] as const;

/**
 * The argument text of every `runStage(...)` call in `code`, in source order.
 *
 * Parenthesis depth is counted with string literals skipped, so a `(` inside a prompt or a rendered
 * value cannot close a call early. The import that merely names `runStage` is not a call and is not
 * matched: the pattern requires the open paren.
 */
function runStageCallArgs(code: string): string[] {
  const opener = /\brunStage\s*\(/g;
  const calls: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = opener.exec(code)) !== null) {
    const start = match.index + match[0].length;
    let depth = 1;
    let i = start;

    while (i < code.length && depth > 0) {
      const ch = code[i];
      if (ch === '"' || ch === "'" || ch === "`") {
        const quote = ch;
        i++;
        while (i < code.length) {
          if (code[i] === "\\") {
            i += 2;
            continue;
          }
          const closing = code[i] === quote;
          i++;
          if (closing) break;
        }
        continue;
      }
      if (ch === "(") depth++;
      else if (ch === ")") depth--;
      i++;
    }

    calls.push(code.slice(start, Math.max(start, i - 1)));
  }

  return calls;
}

/** The stage name a call hands `runStage`, or `null` when it hands none. */
function stageNameOf(args: string): string | null {
  const found = /(?:^|[^\w$.])["']?stage["']?\s*:\s*["'`]([A-Za-z0-9_-]+)["'`]/.exec(args);
  return found === null ? null : found[1];
}

/** Whether a call runs `stage`'s prompt — by the `PROMPTS` key, or by the prompt's own path. */
function runsPromptFor(args: string, stage: string): boolean {
  return (
    new RegExp(String.raw`PROMPTS\s*\.\s*${stage}\b`).test(args) ||
    args.includes(`shape/${stage}/prompt`)
  );
}

/** A one-line summary of what was found, for a failure message that names the real calls. */
function describeCalls(calls: string[]): string {
  return calls
    .map((args, index) => {
      const stage = stageNameOf(args) ?? "no stage name";
      const prompts = STAGES.filter((name) => runsPromptFor(args, name));
      return `call ${index + 1}: stage=${stage}, prompt=${prompts.join("/") || "unrecognised"}`;
    })
    .join("\n");
}

describe("#273 — shape's three stages name themselves to runStage", () => {
  // - [ ] Each of sweep, shaper and refuter's runStage call supplies its own stage name — check: `npx vitest run .Workflow/agent-workflows/shape/shape-stage-names.test.ts`
  it(
    "Each of sweep, shaper and refuter's runStage call supplies its own stage name — check: `npx vitest run .Workflow/agent-workflows/shape/shape-stage-names.test.ts`",
    () => {
      const raw = readSource(SHAPE_SOURCE);
      expect(raw, `${SHAPE_SOURCE} does not exist`).not.toBe("");

      const code = shapeCode();
      const calls = runStageCallArgs(code);

      expect(
        calls.length,
        `shape.ts makes ${calls.length} runStage calls; the sweep, the shaper and the refuter are three`,
      ).toBeGreaterThanOrEqual(3);

      const unnamed = calls.filter((args) => stageNameOf(args) === null);
      expect(
        unnamed.length,
        `a runStage call in shape.ts supplies no stage name:\n${describeCalls(calls)}`,
      ).toBe(0);

      for (const stage of STAGES) {
        const forStage = calls.filter((args) => runsPromptFor(args, stage));
        expect(
          forStage.length,
          `no runStage call in shape.ts runs the ${stage}'s prompt:\n${describeCalls(calls)}`,
        ).toBeGreaterThanOrEqual(1);

        for (const args of forStage) {
          expect(
            stageNameOf(args),
            `the call running the ${stage}'s prompt supplies the wrong stage name:\n${describeCalls(calls)}`,
          ).toBe(stage);
        }
      }

      const names = calls.map((args) => stageNameOf(args));
      expect(names, `shape.ts's runStage calls name ${names.join(", ")}`).toEqual(
        expect.arrayContaining([...STAGES]),
      );

      expect(
        existsSync(SHAPE_STAGE_NAMES_TEST),
        `${SHAPE_STAGE_NAMES_TEST} does not exist, so the criterion's own check has nothing to run`,
      ).toBe(true);

      expectVitestPasses(SHAPE_STAGE_NAMES_TEST_ARG);
    },
    900_000,
  );
});
