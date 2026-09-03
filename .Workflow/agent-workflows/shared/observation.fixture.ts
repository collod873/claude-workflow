import type { Observation } from "./observation-schema";

export function observation(overrides: Partial<Observation> & { finding: string }): Observation {
  return {
    lens: "PROPOSED",
    sites: [`a.ts:1`],
    released: false,
    ...overrides,
  };
}
