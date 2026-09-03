import type { Observation } from "./observation-schema";

/**
 * The one builder for an `Observation` fixture. Everything but `finding` is
 * derived from it, so a test names only the field it is actually about —
 * see CODING_STANDARDS.md, "A test builds a schema-typed fixture through one
 * exported builder".
 */
export function observation(overrides: Partial<Observation> & { finding: string }): Observation {
  return {
    lens: "PROPOSED",
    sites: [`a.ts:1`],
    released: false,
    ...overrides,
  };
}
