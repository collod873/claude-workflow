import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildLaneMap, findings, renderLaneMap, tallyRuns } from "./lane-map";
import { LANE_WIRING } from "./lane-wiring";

const ROOT = resolve(__dirname, "../../..");
const map = buildLaneMap(ROOT);
const lanes = map.nodes.filter((node) => node.kind === "model" || node.kind === "wire");
const lane = (id: string) => lanes.find((node) => node.id === id) ?? expect.fail(`no lane ${id}`);

describe("the lane map", () => {
  it("draws every lane in the wiring and nothing else", () => {
    expect(lanes.map((node) => node.id).sort()).toEqual(Object.keys(LANE_WIRING).sort());
  });

  it("reads what a lane rings from its own call path, not from every file it imports", () => {
    expect(lane("dispatch-reconcile").rings).toEqual(["acceptance-wanted", "mechanic-wanted", "ticket-ready"]);
    expect(lane("review").rings).toEqual([]);
    expect(lane("implement").rings).toEqual(["implementation-opened", "mechanic-wanted", "run-ended"]);
  });

  it("follows a dispatcher handed in as a dependency", () => {
    expect(lane("ratify-on-prd-close").rings).toEqual(["ratification-due"]);
  });

  it("sees a label written through a helper, a create, or the wire", () => {
    expect(lane("shape").labelsApplied).toEqual(["1-decide", "1-shaping", "needs-human", "shape-refused"]);
    expect(lane("walk-home").labelsApplied).toEqual(["by-hand", "ticket", "to-build"]);
    expect(lane("to-tickets").labelsApplied).toEqual(["3-sliced", "3-slicing", "slice-failed"]);
    expect(lane("implement").labelsApplied).toEqual(["5-building", "needs-human"]);
    expect(lane("dispatch-reconcile").labelsApplied).toEqual(["4-accepting", "5-building", "needs-human", "queued", "waiting"]);
  });

  it("joins every rung event to the lane that wakes on it", () => {
    const orphans = map.events.filter((row) => row.rungBy.length === 0 || row.wakes.length === 0);
    expect(orphans).toEqual([]);
  });

  it("names a stop nothing reads", () => {
    expect(findings(map).join("\n")).toContain("To-Tickets labels slice-failed");
  });

  it("folds a caller's old run names into the lane", () => {
    const tally = tallyRuns(
      [
        { name: "Shape", conclusion: "skipped" },
        { name: "Shape (caller)", conclusion: "success" },
        { name: "Shape (reusable)", conclusion: "failure" },
        { name: "Nothing", conclusion: "success" },
      ],
      map.nodes,
    );
    expect(tally.get("shape")).toEqual({ worked: 1, skipped: 1, red: 1, cancelled: 0 });
    expect(tally.size).toBe(1);
  });

  it("renders one svg with no blank line inside it, so marked keeps it as one block", () => {
    const page = renderLaneMap(map);
    const svg = page.slice(page.indexOf("<svg"), page.indexOf("</svg>"));
    expect(svg).not.toMatch(/\n\s*\n/);
    expect(page).toContain("## What is not connected");
  });
});
