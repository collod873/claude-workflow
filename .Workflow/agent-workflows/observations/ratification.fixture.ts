import type { RatificationRecord } from "./ratification-schema";

/**
 * The one builder for a `RatificationRecord` fixture. Everything but
 * `finding` is derived from it, so a test names only the field it is
 * actually about — see CODING_STANDARDS.md, "A test builds a schema-typed
 * fixture through one exported builder". Defaults to a `declined` verdict
 * since that is the decision ratification memory acts on.
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
