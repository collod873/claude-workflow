
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
const ROOT = "\\.Workflow/agent-workflows/";

const TEST_FILE = "\\.test\\.ts$";

const noLaneToLaneRules = LANES.map((lane) => ({
  name: `no-lane-to-lane-${lane}`,
  severity: "error",
  comment:
    "A lane may not deep-import another lane's files. Route the fact through shared/, an " +
    "event, or a published seam instead; see docs/agents/module-boundaries.md.",
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
        "shared/ may not import a lane. shared is every lane's door, and a door does not reach " +
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
