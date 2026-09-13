import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { errorMessage } from "./reason";

export interface Regenerator {
  name: string;
  target: string;
  command: string;
  isCurrent: (root: string) => boolean;
  regenerate: (root: string) => string[];
}

export function runRegenerator(moduleUrl: string, spec: Regenerator): void {
  if (process.argv[1] === undefined || moduleUrl !== pathToFileURL(process.argv[1]).href) return;

  const args = process.argv.slice(2);
  const root = resolve(args.find((arg) => !arg.startsWith("--")) ?? process.env.TARGET_WORKSPACE ?? ".");
  try {
    if (args.includes("--check")) {
      if (spec.isCurrent(root)) return;
      console.error(`${spec.target} is stale; run \`${spec.command}\`.`);
      process.exitCode = 1;
      return;
    }
    const written = spec.regenerate(root);
    console.log(written.length === 0 ? `${spec.target} is current` : `regenerated ${written.join(", ")}`);
  } catch (error) {
    console.error(`${spec.name}: ${errorMessage(error)}`);
    process.exitCode = 2;
  }
}
