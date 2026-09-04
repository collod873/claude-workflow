import type { StageExec } from "./stage";

export interface FakeStage {
  exec: StageExec;
  calls: string[][];
  stdins: Array<string | undefined>;
}

export function createFakeStage(response: string): FakeStage {
  return recordingStage(() => response);
}

export function createFakeStages(responses: string[]): FakeStage {
  return recordingStage((call) => {
    const response = responses[call - 1];
    if (response === undefined) {
      throw new Error(`fake stage: call ${call} has no response; ${responses.length} were supplied`);
    }
    return response;
  });
}

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
