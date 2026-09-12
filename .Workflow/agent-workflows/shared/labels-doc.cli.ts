import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { withLabelsTable } from "./labels";
import { errorMessage } from "./reason";

export const LABELS_DOC_RELATIVE_PATH = "docs/agents/pipeline-labels.md";

export function labelsDocIsCurrent(root: string): boolean {
  const doc = readFileSync(join(root, LABELS_DOC_RELATIVE_PATH), "utf8");
  return withLabelsTable(doc) === doc;
}

export function regenerateLabelsDoc(root: string): boolean {
  const path = join(root, LABELS_DOC_RELATIVE_PATH);
  const doc = readFileSync(path, "utf8");
  const next = withLabelsTable(doc);
  if (next === doc) return false;
  writeFileSync(path, next);
  return true;
}

function main(): void {
  const args = process.argv.slice(2);
  const root = resolve(args.find((arg) => !arg.startsWith("--")) ?? process.env.TARGET_WORKSPACE ?? ".");
  try {
    if (args.includes("--check")) {
      if (labelsDocIsCurrent(root)) return;
      console.error(`${LABELS_DOC_RELATIVE_PATH} is stale; run \`npm run labels-doc\`.`);
      process.exitCode = 1;
      return;
    }
    console.log(regenerateLabelsDoc(root) ? `regenerated ${LABELS_DOC_RELATIVE_PATH}` : `${LABELS_DOC_RELATIVE_PATH} is current`);
  } catch (error) {
    console.error(`labels-doc: ${errorMessage(error)}`);
    process.exitCode = 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
