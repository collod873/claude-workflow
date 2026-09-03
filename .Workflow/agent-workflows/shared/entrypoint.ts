import { writeFailure } from "./handoff-path";
import { reason } from "./reason";

/**
 * Runs a lane's `main`, reporting a failure the one way every entrypoint reports one: to stderr,
 * to the handoff file the workflow reads back, and as a non-zero exit.
 */
export function runEntrypoint(stage: string, main: () => Promise<void>): void {
  main().catch((err: unknown) => {
    const detail = reason(err);
    console.error(`${stage} failed: ${detail}`);
    writeFailure(stage, detail);
    process.exitCode = 1;
  });
}
