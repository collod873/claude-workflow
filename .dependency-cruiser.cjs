/**
 * The prevent-side of module boundaries (#305, §4 of #226). `knip.config.ts` is the catch-side —
 * "is there a path to this?" — wired into `bin/gauntlet push` as `wiring`. This file answers the
 * question that one cannot: "may this import that?"
 *
 * Three rules, scoped to `.Workflow/agent-workflows` — the only tree with lanes to keep apart:
 *
 *   1. no-lane-to-lane   — a lane may not deep-import another lane. `shared/` is every lane's
 *      only legal crossing, and today `shared/` is itself the door (no subdirectory doors yet —
 *      #226 says that split comes after this gate has run for a week, not before).
 *   2. shared-no-lane    — `shared/` may never import a lane. A door does not reach back through
 *      the rooms it serves; the shared thing it needs moves into `shared/` instead.
 *   3. no-circular       — dependency-cruiser's own built-in cycle rule.
 *
 * Every rule is an error: the CLI fails on any violation, and it is run from `npm run lint`.
 * There is no baseline — a violation is fixed at its source, never excused.
 */

const LANES = [
  "acceptance",
  "capture",
  "checkpoints",
  "dispatch",
  "enrol",
  "fixer",
  "implement",
  "intake",
  "integrate",
  "observations",
  "ratify",
  "recover",
  "review",
  "shape",
  "spec",
  "to-tickets",
  "watchdog",
];
const LANE_ALTERNATION = LANES.join("|");
// Module `source`/`resolved` paths come back rooted at the invoking cwd (the repo root, per
// `npm run lint`), not at the cruise target — so every path regex below is anchored on the full
// `.Workflow/agent-workflows/` prefix, not just the lane name.
const ROOT = "\\.Workflow/agent-workflows/";

// Rules 1 and 2 are about the production import graph, so a test file is not a `from`: a test may
// import another lane's subject or fixture to exercise it, and that says nothing about which
// modules ship coupled. Rule 3 stays unscoped — a cycle through a test is still a cycle.
const TEST_FILE = "\\.test\\.ts$";

// One rule per lane rather than one shared rule: dependency-cruiser's `pathNot` is a static
// regex, not a function of the match it excludes, so "any lane but the one this edge started
// in" has to be spelled out per lane.
const noLaneToLaneRules = LANES.map((lane) => ({
  name: `no-lane-to-lane-${lane}`,
  severity: "error",
  comment:
    "A lane may not deep-import another lane's files. Route the fact through shared/, an " +
    "event, or a published seam instead — see docs/agents/module-boundaries.md.",
  from: { path: `^${ROOT}${lane}/`, pathNot: TEST_FILE },
  to: { path: `^${ROOT}(${LANE_ALTERNATION})/`, pathNot: `^${ROOT}${lane}/` },
}));

module.exports = {
  forbidden: [
    ...noLaneToLaneRules,
    {
      name: "shared-no-lane",
      severity: "error",
      comment:
        "shared/ may not import a lane. shared is every lane's door — a door does not reach " +
        "back through the rooms it serves. Move the shared thing it needs into shared/ instead.",
      from: { path: `^${ROOT}shared/`, pathNot: TEST_FILE },
      to: { path: `^${ROOT}(${LANE_ALTERNATION})/` },
    },
    {
      name: "no-circular",
      severity: "error",
      comment: "Dependency cycles make both files impossible to reason about independently.",
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.json" },
    enhancedResolveOptions: { exportsFields: ["exports"], conditionNames: ["import", "types"] },
  },
};
