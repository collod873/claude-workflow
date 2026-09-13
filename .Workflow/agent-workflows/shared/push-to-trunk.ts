import type { GitExec } from "./git";
import { reason } from "./reason";

export const PUSH_ATTEMPTS = 5;

export const PUSH_BACKOFF_SECONDS = 5;

export interface PushToTrunkDeps {
  git: GitExec;
  sleep: (seconds: number) => Promise<void>;
  log: (line: string) => void;
}

export async function pushToTrunk(deps: PushToTrunkDeps): Promise<void> {
  for (let attempt = 1; attempt <= PUSH_ATTEMPTS; attempt++) {
    deps.git(["fetch", "origin", "main"]);
    deps.git(["rebase", "origin/main"]);
    try {
      deps.git(["push", "origin", "HEAD:main"]);
      return;
    } catch (err) {
      deps.log(`push ${attempt} of ${PUSH_ATTEMPTS} lost the race: ${reason(err)}`);
    }
    await deps.sleep(attempt * PUSH_BACKOFF_SECONDS);
  }
  throw new Error(`push to trunk failed after ${PUSH_ATTEMPTS} attempts`);
}
