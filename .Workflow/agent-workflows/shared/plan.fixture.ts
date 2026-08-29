import type { Slice } from "./plan-schema";

/**
 * The one builder for a `Slice` fixture. Everything but the title is derived
 * from it, so a test names only the field it is actually about — see
 * CODING_STANDARDS.md, "A test builds a schema-typed fixture through one
 * exported builder".
 *
 * The default criterion carries a real `check:` marker because a published
 * ticket must (`render-body.ts`, #215): a fixture whose criteria could not be
 * verified downstream is a fixture no publisher would accept, and every test
 * that renders or publishes one would be describing a plan the pipeline
 * refuses.
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
