import { describe, expect, it } from "vitest";
import { heard, marking } from "./scenarios.ts";

const OTHER_STAGES = "1-defining,3-checking,4-reviewing,5-merging,fixing";

describe("bin/mark shows the owner which stage a ticket is at, and whether it needs the owner (#835, #898)", () => {
  it("swaps the ticket onto one stage label and clears needs-human, since a stage starting means the run is moving again", () => {
    const marked = marking();

    expect(heard(marked.run("811", "2-building"))).toEqual({ status: 0, stderr: "", lines: ["mark: #811 is at 2-building"] });
    expect(marked.calls()).toEqual([`issue edit 811 --add-label 2-building --remove-label needs-human,${OTHER_STAGES}`]);
  });

  it("adds needs-human beside the stage label, so the owner sees where the fixer stopped", () => {
    const marked = marking();

    expect(heard(marked.run("811", "needs-human")).status).toBe(0);
    expect(marked.calls()).toEqual(["issue edit 811 --add-label needs-human"]);
  });

  it("refuses a label that is not a stage or needs-human, and asks GitHub for nothing", () => {
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
