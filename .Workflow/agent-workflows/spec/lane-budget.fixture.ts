import { vi } from "vitest";
import { errorMessage } from "../shared/reason";
import type { StageExec } from "../shared/stage";
import { createFakeStages } from "../shared/stage.fake";

const BEYOND_ANY_LANE_BUDGET_MS = 6 * 60 * 60 * 1000;
const MICROTASK_TURNS = 50;

function stageHangingAfter(answered: string[]): StageExec {
  const fake = answered.length === 0 ? undefined : createFakeStages(answered);
  const reply = fake?.exec as unknown as ((...args: unknown[]) => unknown) | undefined;
  let seen = 0;
  return ((...args: unknown[]) => {
    seen += 1;
    if (reply === undefined || seen > answered.length) return new Promise<never>(() => undefined);
    return reply(...args);
  }) as unknown as StageExec;
}

async function flushMicrotasks(): Promise<void> {
  for (let turn = 0; turn < MICROTASK_TURNS; turn += 1) await Promise.resolve();
}

export async function outcomeAfterLaneBudget(
  start: (exec: StageExec) => Promise<unknown>,
  answeredBefore: string[] = [],
): Promise<string> {
  vi.useFakeTimers();
  try {
    const settled = start(stageHangingAfter(answeredBefore)).then(
      () => "resolved",
      (err: unknown) => `rejected: ${errorMessage(err)}`,
    );
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(BEYOND_ANY_LANE_BUDGET_MS);
    await flushMicrotasks();
    return await Promise.race([settled, Promise.resolve("never settled")]);
  } finally {
    vi.useRealTimers();
  }
}
