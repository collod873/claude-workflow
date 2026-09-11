import type { LaneRun } from "../shared/strikes";

/**
 * @fixture Builds a `LaneRun` for the suite; a lane's runs come from `gh run list`.
 */

export function laneRun(overrides: Partial<LaneRun> & { databaseId: number }): LaneRun {
  return {
    displayTitle: `Implement #${overrides.databaseId}`,
    status: "completed",
    conclusion: "success",
    url: `https://github.com/o/r/actions/runs/${overrides.databaseId}`,
    ...overrides,
  };
}
