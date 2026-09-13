import type { GitExec } from "./git";

/** @fixture #541 has not switched land.ts onto this yet, so only its own suite reaches it. */
export const PUSH_ATTEMPTS = 5;

/** @fixture #541 has not switched land.ts onto this yet, so only its own suite reaches it. */
export const PUSH_BACKOFF_SECONDS = 5;

/** @fixture #541 has not switched land.ts onto this yet, so only its own suite reaches it. */
export interface PushToTrunkDeps {
  git: GitExec;
  sleep: (seconds: number) => Promise<void>;
  log: (line: string) => void;
}

/** @fixture #541 has not switched land.ts onto this yet, so only its own suite reaches it. */
export function pushToTrunk(deps: PushToTrunkDeps): Promise<void> {
  deps.log("#541: not built");
  return Promise.reject(new Error("#541: not built"));
}
