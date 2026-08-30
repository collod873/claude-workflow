import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { expectVitestPasses } from "./261-spec-sweep.fixture";
import {
  SHAPE_SOURCE,
  SHAPE_STAGE_NAMES_TEST,
  SHAPE_STAGE_NAMES_TEST_ARG,
  linesMentioning,
  readSource,
  shapeCode,
} from "./273-shape.fixture";

/**
 * #273, criterion 1.
 *
 * The three names are read out of `shape.ts`'s own text with comments stripped, because a copy that
 * is "kept" is a copy that is still written in the code — the file is the only place the claim can
 * be observed, and the ticket claims that file. The criterion's own check command is run too: it
 * names a test file this ticket creates, so a run of it is part of what the criterion asserts.
 */
describe("#273 — shape.ts keeps no copy of the checkpoint plumbing", () => {
  // - [ ] shape.ts keeps no local preservingRaw, rawResponsePath or DEFAULT_HANDOFF_PATH — check: `npx vitest run .Workflow/agent-workflows/shape/shape-stage-names.test.ts`
  it(
    "shape.ts keeps no local preservingRaw, rawResponsePath or DEFAULT_HANDOFF_PATH — check: `npx vitest run .Workflow/agent-workflows/shape/shape-stage-names.test.ts`",
    () => {
      const raw = readSource(SHAPE_SOURCE);
      expect(raw, `${SHAPE_SOURCE} does not exist`).not.toBe("");

      const code = shapeCode();

      for (const identifier of ["preservingRaw", "rawResponsePath", "DEFAULT_HANDOFF_PATH"]) {
        const found = linesMentioning(code, identifier);
        expect(
          found,
          `shape.ts still writes ${identifier} in its own code:\n${found.join("\n")}`,
        ).toEqual([]);
      }

      expect(
        existsSync(SHAPE_STAGE_NAMES_TEST),
        `${SHAPE_STAGE_NAMES_TEST} does not exist, so the criterion's own check has nothing to run`,
      ).toBe(true);

      expectVitestPasses(SHAPE_STAGE_NAMES_TEST_ARG);
    },
    900_000,
  );
});
