import { describe, expect, it } from "vitest";
import { heard, marking } from "./scenarios.ts";

const OTHER_STAGES = "1-defining,3-checking,4-reviewing,5-merging,fixing";

describe("bin/mark shows the owner which stage a ticket is at, and whether its run stopped red (#835)", () => {
  it("swaps the ticket onto one stage label and clears failed, since a stage starting means the run is moving again", () => {
    const marked = marking();

    expect(heard(marked.run("811", "2-building"))).toEqual({ status: 0, stderr: "", lines: ["mark: #811 is at 2-building"] });
    expect(marked.calls()).toEqual([`issue edit 811 --add-label 2-building --remove-label failed,${OTHER_STAGES}`]);
  });

  it("adds failed beside the stage label, so the owner sees where the run stopped", () => {
    const marked = marking();

    expect(heard(marked.run("811", "failed")).status).toBe(0);
    expect(marked.calls()).toEqual(["issue edit 811 --add-label failed"]);
  });

  it("refuses a label that is not a stage or failed, and asks GitHub for nothing", () => {
    const marked = marking();

    expect(heard(marked.run("811", "7-fixing")).status).toBe(2);
    expect(marked.calls()).toEqual([]);
  });

  it("says in one line why GitHub refused the label", () => {
    const marked = marking({ gh: "printf 'HTTP 403: Resource not accessible by integration\\n' >&2\nexit 1\n" });

    expect(marked.run("811", "fixing")).toEqual({
      status: 1,
      stdout: "",
      stderr: "mark: #811 not labelled fixing: HTTP 403: Resource not accessible by integration\n",
    });
  });
});
