import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * A stage prompt's text, by its path under `agent-workflows/` — for `prompt-skeleton.test.ts`,
 * which holds every prompt's ```structured-output skeleton to the schema its stage sends the CLI.
 * That is a contract between two files no import connects, so the prompt has to be read as text;
 * the read lives here so the suite itself opens nothing under the repository root.
 *
 * @fixture Reached only from the suite, by design.
 */
export function promptSource(promptPath: string): string {
  return readFileSync(resolve(import.meta.dirname, "..", promptPath), "utf8");
}
