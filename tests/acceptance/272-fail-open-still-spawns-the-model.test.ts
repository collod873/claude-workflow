import { existsSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import {
  PINNED_SHA,
  checkpointDirOf,
  cleanUp,
  corruptCheckpoints,
  filesUnder,
  makeTmp,
  runStageProbe,
} from "./272-checkpoint.fixture";

/**
 * #272's third criterion, quoted verbatim in the test name below.
 *
 * Four venues, each one the same claim: what a checkpoint that cannot be proven good costs is the
 * work being done again, never the run.
 *
 * The unreadable case replaces the checkpoint's own path with a directory rather than chmod-ing it,
 * because a runner may be root and root can read a 000 file.
 *
 * The uncomputable-key case deletes GITHUB_SHA and moves the child's cwd outside any checkout, so
 * the `git rev-parse HEAD` fallback has nothing to answer with either.
 */

const ANSWER = JSON.stringify({ greeting: "the model answered" });

const tmps: string[] = [];
afterAll(() => cleanUp(tmps));

/** A venue with one stage already checkpointed, so there is something for the next run to break. */
function seeded(): string {
  const tmp = makeTmp();
  tmps.push(tmp);
  const run = runStageProbe(tmp, [{ response: ANSWER }], { sha: PINNED_SHA });
  expect(run.error, "the seeding run could not be driven at all").toBeNull();
  expect(run.steps[0].error, "the seeding run failed").toBeNull();
  expect(
    filesUnder(checkpointDirOf(tmp)).length,
    "a successful stage left no checkpoint in " + checkpointDirOf(tmp) + " to break",
  ).toBeGreaterThan(0);
  return tmp;
}

describe("a checkpoint that cannot be proven good is treated as absent", () => {
  it("With the checkpoint dir absent, unreadable/unparseable, or the key uncomputable, the stage still spawns its model — check: `npx vitest run .Workflow/agent-workflows/shared/stage.test.ts`", () => {
    const absent = makeTmp();
    tmps.push(absent);
    expect(existsSync(checkpointDirOf(absent))).toBe(false);
    const onAbsent = runStageProbe(absent, [{ response: ANSWER }], { sha: PINNED_SHA });
    expect(onAbsent.error, "the run against an absent directory could not be driven").toBeNull();
    expect(onAbsent.steps[0].error, "an absent checkpoint directory failed the run").toBeNull();
    expect(onAbsent.steps[0].execCalls, "an absent checkpoint directory stopped the model").toBe(1);
    expect(onAbsent.steps[0].result).toEqual({ greeting: "the model answered" });

    const unreadable = seeded();
    corruptCheckpoints(unreadable, "directory");
    const onUnreadable = runStageProbe(unreadable, [{ response: ANSWER }], { sha: PINNED_SHA });
    expect(onUnreadable.error, "the run against an unreadable checkpoint could not be driven").toBeNull();
    expect(onUnreadable.steps[0].error, "an unreadable checkpoint failed the run").toBeNull();
    expect(onUnreadable.steps[0].execCalls, "an unreadable checkpoint stopped the model").toBe(1);
    expect(onUnreadable.steps[0].result).toEqual({ greeting: "the model answered" });

    const unparseable = seeded();
    corruptCheckpoints(unparseable, "garbage");
    const onGarbage = runStageProbe(unparseable, [{ response: ANSWER }], { sha: PINNED_SHA });
    expect(onGarbage.error, "the run against an unparseable checkpoint could not be driven").toBeNull();
    expect(onGarbage.steps[0].error, "an unparseable checkpoint failed the run").toBeNull();
    expect(onGarbage.steps[0].execCalls, "an unparseable checkpoint stopped the model").toBe(1);
    expect(onGarbage.steps[0].result).toEqual({ greeting: "the model answered" });

    const keyless = seeded();
    const onNoKey = runStageProbe(keyless, [{ response: ANSWER }], { sha: null, cwd: keyless });
    expect(onNoKey.error, "the run with no computable key could not be driven").toBeNull();
    expect(onNoKey.steps[0].error, "an uncomputable key failed the run").toBeNull();
    expect(onNoKey.steps[0].execCalls, "an uncomputable key stopped the model").toBe(1);
    expect(onNoKey.steps[0].result).toEqual({ greeting: "the model answered" });
  }, 1_200_000);
});
