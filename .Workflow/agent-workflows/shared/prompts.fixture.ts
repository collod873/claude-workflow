import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * @fixture Reached only from the suite, by design.
 */
export function promptSource(promptPath: string): string {
  return readFileSync(resolve(import.meta.dirname, "..", promptPath), "utf8");
}
