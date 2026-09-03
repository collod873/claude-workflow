import type { RatificationRecord } from "./ratification-schema";

export function ratificationRecord(
  overrides: Partial<RatificationRecord> & { finding: string },
): RatificationRecord {
  return {
    decision: "declined",
    sites: [`a.ts:1`],
    reason: "not worth a rule",
    ...overrides,
  };
}
