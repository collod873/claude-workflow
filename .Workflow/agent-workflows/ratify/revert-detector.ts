import { pathToFileURL } from "node:url";
import type { RatificationRecord } from "../shared/ratification-schema";
import { enabledRuleIds, parseStandardEntries } from "./standards";

/**
 * **Decline by revert** — the owner's one lever, and the whole of it.
 *
 * A standard lands as a merged pull request. To decline it, the owner reverts
 * it, or simply deletes the entry or the rule in any later commit. This
 * detector notices: it lists what is actually in the tree, compares that
 * against every `ratified` record's `landedAs`, and writes a `declined`
 * record for anything the record says landed that the tree no longer carries.
 * `filterByRatificationMemory` then keeps that finding suppressed until it
 * grows a site the decision never covered — the existing contract, unchanged;
 * only its writer moved.
 *
 * Why a revert is a *stronger* signature than the checkbox it replaces: a
 * revert costs a deliberate act, and an unticked box is indistinguishable
 * from not having read the pull request at all.
 *
 * **A back-stamp, not a counter** (ADR-0044/0046 taxonomy): the output is a
 * committed write derived entirely from state, recomputed every run and never
 * stored, so it needs no reader, no DESIGN.md §6 row, and no ADR-0064 counter
 * admission. Idempotence falls out of that: a finding that already carries a
 * `declined` record derives nothing new.
 *
 * **It cannot loop itself.** Lane 08 merges with the built-in `GITHUB_TOKEN`,
 * whose pushes start no workflow runs (ADR-0054), so the ratifier's own
 * landings never fire this. Only a human's push does — which is exactly the
 * event it exists for.
 */

/** What one detector pass hands back. */
export interface RevertScan {
  /** One `declined` record per ratified standard the tree no longer carries. */
  declined: RatificationRecord[];
  /** Every `landedAs` the tree still carries — the log line that makes a quiet run readable. */
  present: string[];
}

export interface RevertScanOptions {
  /** Every record `refs/notes/ratifications` holds, in any order. */
  records: RatificationRecord[];
  /** `CODING_STANDARDS.md`'s current text. */
  standards: string;
  /** The rule ids `eslint.config.js` currently turns on. */
  ruleIds: Set<string>;
  /** The commit the revert was noticed at — named in the reason so the record says when. */
  sha: string;
}

/**
 * Pure tree-vs-memory, one mechanical rule: a ratified record whose
 * `landedAs` names neither a `CODING_STANDARDS.md` entry nor an enabled lint
 * rule was reverted.
 *
 * A finding that already carries a `declined` record is skipped, which is
 * what makes repeated runs a no-op. A `ratified` record with no `landedAs`
 * (written before the ratifier existed) names nothing to look for and is
 * skipped too — the detector declines to guess rather than declining a
 * standard nobody can point at.
 */
export function scanForReverts(options: RevertScanOptions): RevertScan {
  const { records, standards, ruleIds, sha } = options;

  const inTree = new Set<string>([...parseStandardEntries(standards).map((entry) => entry.name), ...ruleIds]);
  const alreadyDeclined = new Set(
    records.filter((record) => record.decision === "declined").map((record) => record.finding),
  );

  const declined: RatificationRecord[] = [];
  const present: string[] = [];
  const seen = new Set<string>();

  for (const record of records) {
    if (record.decision !== "ratified" || !record.landedAs) continue;
    if (inTree.has(record.landedAs)) {
      present.push(record.landedAs);
      continue;
    }
    if (alreadyDeclined.has(record.finding) || seen.has(record.finding)) continue;
    seen.add(record.finding);
    declined.push({
      finding: record.finding,
      sites: record.sites,
      decision: "declined",
      reason: `reverted by owner at ${sha}: "${record.landedAs}" is no longer in the tree`,
      landedAs: record.landedAs,
    });
  }

  return { declined, present };
}

/**
 * The rule ids `eslint.config.js` turns on, loaded from a real config file.
 *
 * A dynamic import rather than a parse: the config is JavaScript that
 * composes helpers (`tseslint.config(...)`), so the only honest answer to
 * "which rules does this turn on" is the one the module itself computes.
 * Separated from `scanForReverts` so the scan stays a pure function over data
 * a test can hand it.
 */
export async function loadEnabledRuleIds(configPath: string): Promise<Set<string>> {
  const module = (await import(pathToFileURL(configPath).href)) as { default: unknown };
  const config = module.default;
  return enabledRuleIds(Array.isArray(config) ? config : [config]);
}
