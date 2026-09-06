import type { GateVerdict } from "./run-gauntlet";

/**
 * @fixture A push gate answering a scripted sequence of verdicts, the last one repeating; reached
 * only from the suites that drive a lane through its gate.
 */
export function gateSaying(...verdicts: GateVerdict[]): { runs: GateVerdict[]; runGate: () => GateVerdict } {
  const runs: GateVerdict[] = [];
  return {
    runs,
    runGate: () => {
      const verdict = verdicts[runs.length] ?? verdicts[verdicts.length - 1] ?? { ok: true };
      runs.push(verdict);
      return verdict;
    },
  };
}
