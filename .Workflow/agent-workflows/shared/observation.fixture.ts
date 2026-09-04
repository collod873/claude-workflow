import type { Observation } from "./observation-schema";

/**
 * @fixture Builds an `Observation` for the suite; a lane's observations come from a lens run.
 */

export function observation(overrides: Partial<Observation> & { finding: string }): Observation {
  return {
    lens: "PROPOSED",
    sites: [`a.ts:1`],
    released: false,
    ...overrides,
  };
}
