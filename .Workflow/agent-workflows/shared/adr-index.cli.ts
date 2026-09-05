import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { adrCorpus, INDEX_RELATIVE_PATH, regenerateAdrIndex, renderAdrIndex } from "./adr-index";
import { errorMessage } from "./reason";

const USAGE = "name exactly one repository root, as the first argument or in TARGET_WORKSPACE";

function check(root: string): number {
  const index = join(root, INDEX_RELATIVE_PATH);
  if (!existsSync(index)) return 0;

  const corpus = adrCorpus(root);
  if (corpus.length === 0) return 0;

  if (readFileSync(index, "utf8") === renderAdrIndex(corpus)) return 0;

  console.error(`${INDEX_RELATIVE_PATH} is stale; run \`npm run adrs -- --fix\`.`);
  return 1;
}

function repoRoot(args: string[], env: NodeJS.ProcessEnv): string {
  const fromEnv = env.TARGET_WORKSPACE?.trim();
  const named = [...args.filter((arg) => !arg.startsWith("--")), ...(fromEnv ? [fromEnv] : [])];
  const roots = [...new Set(named.map((name) => resolve(name)))];

  if (roots.length === 0) throw new Error(`adr-index: no repository root given; ${USAGE}.`);
  if (roots.length > 1) throw new Error(`adr-index: roots disagree (${roots.join(", ")}); ${USAGE}.`);
  if (!statSync(roots[0], { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error(`adr-index: ${roots[0]} is not a directory; ${USAGE}.`);
  }
  return roots[0];
}

function main(): void {
  const args = process.argv.slice(2);

  let root: string;
  try {
    root = repoRoot(args, process.env);
  } catch (error) {
    console.error(errorMessage(error));
    process.exitCode = 2;
    return;
  }

  if (!args.includes("--fix")) {
    process.exitCode = check(root);
    return;
  }
  console.log(regenerateAdrIndex(root) ? `regenerated ${INDEX_RELATIVE_PATH}` : `no ${INDEX_RELATIVE_PATH} to regenerate`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
