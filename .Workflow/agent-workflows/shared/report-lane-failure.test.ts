import { describe, expect, it } from "vitest";
import { createRecordingGh } from "./gh.fake";
import { laneFailureComment, reportLaneEnding, type LaneEnding, type ReportedLane } from "./report-lane-failure";

const RUN_URL = "https://github.com/o/r/actions/runs/42";

function ending(lane: ReportedLane, over: Partial<LaneEnding> = {}): LaneEnding {
  return {
    lane,
    status: "failure",
    issue: 519,
    runUrl: RUN_URL,
    reason: "audit-and-publish: the model refused the plan",
    verb: "approved",
    refused: false,
    ...over,
  };
}

describe("#519: a lane reads its own ending as data instead of asking failure()", () => {
  it("says nothing about a run that finished clean", () => {
    expect(laneFailureComment(ending("shape", { status: "success" }))).toBeUndefined();
  });

  it("says nothing when the lane refused the work on purpose", () => {
    expect(laneFailureComment(ending("to-tickets", { refused: true }))).toBeUndefined();
  });

  it("names a cancelled runner, which neither failure() nor !success() could tell apart", () => {
    const body = laneFailureComment(ending("shape", { status: "cancelled" }));

    expect(body).toContain("**cancelled**");
    expect(body).toContain("never reached the code that reports why it stopped");
  });

  it("reports a plain failure without claiming the runner cancelled it", () => {
    expect(laneFailureComment(ending("shape"))).not.toContain("cancelled");
  });

  it("carries the handoff reason and the checkpoint artifact for a lane that keeps them", () => {
    const body = laneFailureComment(ending("shape"));

    expect(body).toContain("**Reason:** audit-and-publish: the model refused the plan");
    expect(body).toContain("`checkpoints-shape-519` artifact");
  });

  it("says the stage is unknown when nothing wrote a handoff", () => {
    expect(laneFailureComment(ending("to-tickets", { reason: undefined }))).toContain("**Reason:** unknown stage");
  });

  it("offers the recovery a lane has instead of a reason it never writes", () => {
    const body = laneFailureComment(ending("spec"));

    expect(body).toContain("re-applying `to-spec` starts it again");
    expect(body).not.toContain("**Reason:**");
  });

  it("names the label verb that a shape accept was carrying", () => {
    expect(laneFailureComment(ending("shape-accept", { verb: "parked" }))).toContain("The `parked` accept did not finish");
  });

  it("every lane's report links the run that failed", () => {
    for (const lane of ["shape", "shape-accept", "spec", "to-tickets"] as ReportedLane[]) {
      expect(laneFailureComment(ending(lane)), lane).toContain(`**Workflow run:** ${RUN_URL}`);
    }
  });
});

describe("#519: reporting an ending is one comment, and a label only where the lane declares one", () => {
  it("labels a failed slicing run so the PRD shows it, and answers that it spoke", () => {
    const { gh, calls } = createRecordingGh();

    expect(reportLaneEnding(gh, ending("to-tickets"))).toBe(true);
    expect(calls[0].slice(0, 3)).toEqual(["issue", "comment", "519"]);
    expect(calls[1]).toEqual(["issue", "edit", "519", "--add-label", "slice-failed"]);
  });

  it("leaves a lane with no label of its own uncommented on twice", () => {
    const { gh, calls } = createRecordingGh();

    expect(reportLaneEnding(gh, ending("spec"))).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it("touches the tracker not at all when there is nothing to report", () => {
    const { gh, calls } = createRecordingGh();

    expect(reportLaneEnding(gh, ending("shape", { status: "success" }))).toBe(false);
    expect(calls).toEqual([]);
  });
});
