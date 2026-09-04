import type { Slice } from "./plan-schema";

/**
 * @fixture Builds a `Slice` for the suite; a lane's slices come from the planner.
 */

export function slice(overrides: Partial<Slice> & { title: string }): Slice {
  return {
    whatToBuild: `Build ${overrides.title}.`,
    acceptanceCriteria: [`${overrides.title} works — check: \`npm test\``],
    filesClaimed: [],
    seamsConsumed: [],
    whyNotMerged: `${overrides.title} is its own vertical slice.`,
    dependsOn: [],
    ...overrides,
  };
}
