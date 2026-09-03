import type { RatifierVerdict } from "./verdict-schema";

export function ratifierVerdict(overrides: Partial<RatifierVerdict> = {}): RatifierVerdict {
  return {
    verdict: "mechanise",
    landedAs: "lane-boundary/no-cross-lane-import",
    reason: "two sites reached across a lane boundary for the same helper",
    fallback: {
      name: "Lane-local imports",
      entry:
        "- **Lane-local imports** — a lane imports from its own directory or from `shared/`.\n" +
        "  Why: a cross-lane import makes two lanes one deployable unit.\n" +
        "  Red flag: a relative import climbing out of a lane's own directory.",
    },
    ...overrides,
  };
}
