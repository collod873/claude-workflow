import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ROUNDS_SOURCE, ROUNDS_TEST_SOURCE } from "./263-lane-02.fixture";

/**
 * #263, criterion 3. The round loop is removed rather than capped, so the module that counts the
 * rounds and the test that pins its behaviour both go. Asserted as the criterion's own check
 * asserts it: the two paths do not exist.
 */
describe("#263 - the round counter is deleted", () => {
  // "The round counter and its test are gone — check: `test ! -e .Workflow/agent-workflows/spec/rounds.ts && test ! -e .Workflow/agent-workflows/spec/rounds.test.ts`"
  it("The round counter and its test are gone — check: `test ! -e .Workflow/agent-workflows/spec/rounds.ts && test ! -e .Workflow/agent-workflows/spec/rounds.test.ts`", () => {
    expect(existsSync(ROUNDS_SOURCE), ROUNDS_SOURCE + " still exists").toBe(false);
    expect(existsSync(ROUNDS_TEST_SOURCE), ROUNDS_TEST_SOURCE + " still exists").toBe(false);
  });
});
