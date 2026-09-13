import { expect, test } from "vitest";
import { PUSH_ATTEMPTS, PUSH_BACKOFF_SECONDS, pushToTrunk, type PushToTrunkDeps } from "./push-to-trunk";

interface PushSeam {
  deps: PushToTrunkDeps;
  pushes: () => number;
  slept: number[];
}

function pushSeam(losses: number): PushSeam {
  let pushes = 0;
  const slept: number[] = [];
  const deps: PushToTrunkDeps = {
    git: (args) => {
      if (args[0] === "push" && ++pushes <= losses) throw new Error("rejected: non-fast-forward (fetch first)");
      return "";
    },
    sleep: async (seconds) => {
      slept.push(seconds);
    },
    log: () => undefined,
  };
  return { deps, pushes: () => pushes, slept };
}

test("#541.1: a push rejected on its first attempt succeeds on a later one", async () => {
  const seam = pushSeam(1);
  await expect(pushToTrunk(seam.deps)).resolves.toBeUndefined();
  expect(seam.pushes()).toBe(2);
});

test("#541.1: exhausting every push attempt raises rather than reporting success", async () => {
  const seam = pushSeam(Number.POSITIVE_INFINITY);
  await expect(pushToTrunk(seam.deps)).rejects.toThrow();
  expect(seam.pushes()).toBe(PUSH_ATTEMPTS);
});

test("#541.2: PUSH_ATTEMPTS and PUSH_BACKOFF_SECONDS have one home, the shared module, and govern its retry", async () => {
  const seam = pushSeam(PUSH_ATTEMPTS - 1);
  const backoffs = Array.from({ length: PUSH_ATTEMPTS - 1 }, (_, lost) => (lost + 1) * PUSH_BACKOFF_SECONDS);
  await expect(pushToTrunk(seam.deps)).resolves.toBeUndefined();
  expect(seam.pushes()).toBe(PUSH_ATTEMPTS);
  expect(seam.slept).toEqual(backoffs);
});
