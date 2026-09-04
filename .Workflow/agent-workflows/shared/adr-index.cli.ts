import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { adrCorpus, INDEX_RELATIVE_PATH, regenerateAdrIndex, renderAdrIndex } from "./adr-index";

function check(root: string): number {
  const index = join(root, INDEX_RELATIVE_PATH);
  if (!existsSync(index)) return 0;

  const corpus = adrCorpus(root);
  if (corpus.length === 0) return 0;

  if (readFileSync(index, "utf8") === renderAdrIndex(corpus)) return 0;

  console.error(`${INDEX_RELATIVE_PATH} is stale; run \`npm run adrs -- --fix\`.`);
  return 1;
}

function main(): void {
  const args = process.argv.slice(2);
  const fix = args.includes("--fix");
  const root = args.find((arg) => !arg.startsWith("--")) || process.env.TARGET_WORKSPACE || process.cwd();

  if (!fix) {
    process.exitCode = check(root);
    return;
  }
  console.log(regenerateAdrIndex(root) ? `regenerated ${INDEX_RELATIVE_PATH}` : `no ${INDEX_RELATIVE_PATH} to regenerate`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
