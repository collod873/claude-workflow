import { writeFailure } from "./handoff-path";
import { reason } from "./reason";

export function runEntrypoint(stage: string, main: () => Promise<void>): void {
  main().catch((err: unknown) => {
    const detail = reason(err);
    console.error(`${stage} failed: ${detail}`);
    writeFailure(stage, detail);
    process.exitCode = 1;
  });
}
