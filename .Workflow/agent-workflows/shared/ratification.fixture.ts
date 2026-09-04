import type { RatificationRecord } from "./ratification-schema";

/**
 * @fixture Builds a `RatificationRecord` for the suite; a lane's records come from the ratifier.
 */

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
