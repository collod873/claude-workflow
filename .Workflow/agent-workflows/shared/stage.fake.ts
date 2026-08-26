import type { StageExec } from "./stage";

/**
 * An in-memory stand-in for `StageExec`, for every test that runs a stage
 * without spawning a model. Every argv it was called with is recorded
 * verbatim, in order, so a test can assert on prompt substitution and argv
 * shape — the thing `runStage` actually owns — instead of on anything a
 * model would say.
 */
export interface FakeStage {
  exec: StageExec;
  /** Every argv this fake was called with, in call order. */
  calls: string[][];
  /** What was handed to stdin on each of those calls — `undefined` for an argv-borne prompt. */
  stdins: Array<string | undefined>;
}

/**
 * Creates a `FakeStage` that always returns `response`, regardless of what
 * argv it's called with — good enough for asserting substitution and argv
 * shape, since a stage's own response content is never something a test
 * pins.
 */
export function createFakeStage(response: string): FakeStage {
  const calls: string[][] = [];
  const stdins: Array<string | undefined> = [];
  const exec: StageExec = async (argv, stdin) => {
    calls.push(argv);
    stdins.push(stdin);
    return response;
  };
  return { exec, calls, stdins };
}
