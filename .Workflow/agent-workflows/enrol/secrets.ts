import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * The secret names the enrol lane propagates into a target.
 *
 * Derived by scanning this repository's own workflow files for `secrets.<NAME>` references —
 * never listed (ADR-0057's surviving rule, kept by ADR-0133). A lane that starts spending a third
 * secret is picked up here on the next push, with nothing in this module edited: the set is the
 * union of every reference this repository's workflows already carry, minus the two names that
 * are never this lane's to hand outward.
 */

/**
 * The credential this lane itself reaches outward on. No repository this lane enrols may hold it
 * — see the note above `on:` in `enrol.yml` for why the value never travels past this process.
 */
export const OUTWARD_CREDENTIAL = "ENROL_PAT";

/** Ambient in every repository already; never a secret this lane needs to provision. */
const AMBIENT_TOKEN = "GITHUB_TOKEN";

const SECRET_REFERENCE = /secrets\.([A-Za-z_][A-Za-z0-9_]*)/g;

/**
 * Every `secrets.<NAME>` this repository's own `.yml` workflow files reference, minus the ambient
 * token and the outward credential — sorted, so a run's report is stable between passes over an
 * unchanged estate.
 */
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
