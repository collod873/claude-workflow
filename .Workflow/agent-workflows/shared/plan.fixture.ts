import type { Slice } from "./plan-schema";

/**
 * The one builder for a `Slice` fixture. Everything but the title is derived
 * from it, so a test names only the field it is actually about — see
 * CODING_STANDARDS.md, "A test builds a schema-typed fixture through one
 * exported builder".
 */
export function slice(overrides: Partial<Slice> & { title: string }): Slice {
  return {
    whatToBuild: `Build ${overrides.title}.`,
    acceptanceCriteria: [`${overrides.title} works.`],
    filesClaimed: [],
    seamsConsumed: [],
    whyNotMerged: `${overrides.title} is its own vertical slice.`,
    dependsOn: [],
    ...overrides,
  };
}
