import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { withLabelsTable } from "./labels";
import { runRegenerator } from "./regenerate-cli";

export const LABELS_DOC_RELATIVE_PATH = "docs/agents/pipeline-labels.md";

export function labelsDocIsCurrent(root: string): boolean {
  const doc = readFileSync(join(root, LABELS_DOC_RELATIVE_PATH), "utf8");
  return withLabelsTable(doc) === doc;
}

export function regenerateLabelsDoc(root: string): string[] {
  const path = join(root, LABELS_DOC_RELATIVE_PATH);
  const doc = readFileSync(path, "utf8");
  const next = withLabelsTable(doc);
  if (next === doc) return [];
  writeFileSync(path, next);
  return [LABELS_DOC_RELATIVE_PATH];
}

runRegenerator(import.meta.url, {
  name: "labels-doc",
  target: LABELS_DOC_RELATIVE_PATH,
  command: "npm run labels-doc",
  isCurrent: labelsDocIsCurrent,
  regenerate: regenerateLabelsDoc,
});
