import { afterAll, describe, expect, it } from "vitest";
import { PINNED_SHA, cleanUp, makeTmp, runStageProbe } from "./272-checkpoint.fixture";

/**
 * #272's second criterion, quoted verbatim in the test name below.
 *
 * Two halves, both observed through the real `runStage`:
 *
 * - calls no StageExec: the second run is offered a different answer and must not take it, because
 *   it must not spawn anything at all.
 * - re-validated through the stage's output.parse: the third run asks the same stage, at the same
 *   commit, through a schema that also requires a `count` the stored checkpoint does not carry. A
 *   resume that runs output.parse over the restored value cannot hand that value on, so fail-open
 *   spawns and the live answer comes back. A resume that cast the file's contents to T instead
 *   would return the stale, countless value with no model spawned.
 */

const tmps: string[] = [];
afterAll(() => cleanUp(tmps));

describe("a stage whose valid output is already present is skipped rather than re-run", () => {
  it("A stage with a key-matching checkpoint calls no StageExec and returns it re-validated through the stage's output.parse — check: `npx vitest run .Workflow/agent-workflows/shared/stage.test.ts`", () => {
    const tmp = makeTmp();
    tmps.push(tmp);

    const first = runStageProbe(tmp, [{ response: JSON.stringify({ greeting: "hi" }) }], {
      sha: PINNED_SHA,
    });
    expect(first.error, "the first run could not be driven at all").toBeNull();
    expect(first.steps[0].error, "the first run failed").toBeNull();
    expect(first.steps[0].execCalls, "a stage with no checkpoint must spawn its model").toBe(1);

    const resumed = runStageProbe(tmp, [{ response: JSON.stringify({ greeting: "a live answer" }) }], {
      sha: PINNED_SHA,
    });
    expect(resumed.error, "the second run could not be driven at all").toBeNull();
    expect(resumed.steps[0].error, "the second run failed").toBeNull();
    expect(
      resumed.steps[0].execCalls,
      "the stage spawned a model despite a key-matching checkpoint",
    ).toBe(0);
    expect(resumed.steps[0].result, "the checkpoint's value was not what came back").toEqual({
      greeting: "hi",
    });

    const widened = runStageProbe(
      tmp,
      [{ schema: "widened", response: JSON.stringify({ greeting: "hi", count: 3 }) }],
      { sha: PINNED_SHA },
    );
    expect(widened.error, "the third run could not be driven at all").toBeNull();
    expect(
      widened.steps[0].error,
      "a checkpoint the stage's schema refuses must be treated as absent, not as a failure",
    ).toBeNull();
    expect(
      widened.steps[0].execCalls,
      "the restored value was handed on without being re-validated through output.parse",
    ).toBe(1);
    expect(widened.steps[0].result).toEqual({ greeting: "hi", count: 3 });
  }, 900_000);
});
