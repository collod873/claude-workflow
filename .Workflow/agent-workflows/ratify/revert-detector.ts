import { pathToFileURL } from "node:url";
import type { RatificationRecord } from "../shared/ratification-schema";
import { enabledRuleIds, parseStandardEntries } from "./standards";

export interface RevertScan {
  declined: RatificationRecord[];
  present: string[];
}

export interface RevertScanOptions {
  records: RatificationRecord[];
  standards: string;
  ruleIds: Set<string>;
  sha: string;
}

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

export async function loadEnabledRuleIds(configPath: string): Promise<Set<string>> {
  const module = (await import(pathToFileURL(configPath).href)) as { default: unknown };
  const config = module.default;
  return enabledRuleIds(Array.isArray(config) ? config : [config]);
}
