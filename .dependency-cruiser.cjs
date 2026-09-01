/**
 * The prevent-side of module boundaries (#305, §4 of #226). `knip.config.ts` and
 * `bin/clone-gate` are the catch-side — "is there a path to this?", "is this a duplicate?" —
 * wired into `bin/gauntlet push` as `wiring` and `clones`. This file answers the question
 * neither of those can: "may this import that?"
 *
 * Three rules, scoped to `.Workflow/agent-workflows` — the only tree with lanes to keep apart:
 *
 *   1. no-lane-to-lane   — a lane may not deep-import another lane. `shared/` is every lane's
 *      only legal crossing, and today `shared/` is itself the door (95 files, no subdirectory
 *      doors yet — #226 says that split comes after this gate has run for a week, not before).
 *   2. shared-no-lane    — `shared/` may never import a lane. The one edge that ran backwards
 *      (`shared/rewrite-session-notes-schema.ts` → `observations/`) is fixed in this same
 *      ticket by moving the type it needed into `shared/`, not by baselining it.
 *   3. no-circular       — dependency-cruiser's own built-in cycle rule.
 *
 * Violations against rules 1 and 2 that predate this gate are baselined by
 * `shared/boundaries-baseline.ts`, the same `regenerate && diff`-on-the-delta shape
 * `wiring-baseline.ts` (#183) already uses for knip: this config is intentionally permissive
 * (it does not fail the CLI on its own), and the baseline script is what turns a *new*
 * violation into a failing push.
 */

const LANES = [
  "acceptance",
  "capture",
  "checkpoints",
  "dispatch",
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
// `bin/gauntlet`'s and this ticket's own check command), not at the cruise target — so every
// path regex below is anchored on the full `.Workflow/agent-workflows/` prefix, not just the
// lane name.
const ROOT = "\\.Workflow/agent-workflows/";

// One rule per lane rather than one shared rule: dependency-cruiser's `pathNot` is a static
// regex, not a function of the match it excludes, so "any lane but the one this edge started
// in" has to be spelled out per lane.
const noLaneToLaneRules = LANES.map((lane) => ({
  name: `no-lane-to-lane-${lane}`,
  severity: "warn",
  comment:
    "A lane may not deep-import another lane's files. Route the fact through shared/, an " +
    "event, or a published seam instead — see docs/agents/module-boundaries.md.",
  from: { path: `^${ROOT}${lane}/` },
  to: { path: `^${ROOT}(${LANE_ALTERNATION})/`, pathNot: `^${ROOT}${lane}/` },
}));

module.exports = {
  forbidden: [
    ...noLaneToLaneRules,
    {
      name: "shared-no-lane",
      severity: "warn",
      comment:
        "shared/ may not import a lane. shared is every lane's door — a door does not reach " +
        "back through the rooms it serves. Move the shared thing it needs into shared/ instead.",
      from: { path: `^${ROOT}shared/` },
      to: { path: `^${ROOT}(${LANE_ALTERNATION})/` },
    },
    {
      name: "no-circular",
      severity: "warn",
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
