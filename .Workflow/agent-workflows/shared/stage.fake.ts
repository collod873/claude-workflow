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
  return recordingStage(() => response);
}

/**
 * Creates a `FakeStage` that answers each call from `responses` in order — for
 * a chain whose stages answer to different schemas, where one canned response
 * would be parsed by every stage in it alike.
 *
 * **Running out of responses throws.** A chain that spawned a stage the test
 * did not plan for is the failure a call-order assertion is usually there to
 * catch, and a fake that quietly repeated its last answer would let the extra
 * stage through whenever that answer happened to parse.
 */
export function createFakeStages(responses: string[]): FakeStage {
  return recordingStage((call) => {
    const response = responses[call - 1];
    if (response === undefined) {
      throw new Error(`fake stage: call ${call} has no response — ${responses.length} were supplied`);
    }
    return response;
  });
}

/** The recorder both share: every argv and stdin kept in order, the answer left to the caller. */
function recordingStage(answer: (call: number) => string): FakeStage {
  const calls: string[][] = [];
  const stdins: Array<string | undefined> = [];
  const exec: StageExec = async (argv, stdin) => {
    calls.push(argv);
    stdins.push(stdin);
    return answer(calls.length);
  };
  return { exec, calls, stdins };
}
