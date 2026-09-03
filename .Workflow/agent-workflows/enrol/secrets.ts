import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export const OUTWARD_CREDENTIAL = "ENROL_PAT";

const AMBIENT_TOKEN = "GITHUB_TOKEN";

const SECRET_REFERENCE = /secrets\.([A-Za-z_][A-Za-z0-9_]*)/g;

export function derivedSecretNames(workflowsDir: string): string[] {
  const names = new Set<string>();
  for (const file of readdirSync(workflowsDir).filter((name) => name.endsWith(".yml"))) {
    const content = readFileSync(join(workflowsDir, file), "utf8");
    for (const match of content.matchAll(SECRET_REFERENCE)) names.add(match[1]);
  }
  names.delete(AMBIENT_TOKEN);
  names.delete(OUTWARD_CREDENTIAL);
  return [...names].sort();
}
