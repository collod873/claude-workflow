import { describe, expect, it } from "vitest";
import { closingNote, heard } from "./scenarios.ts";

describe("bin/close-note lets a session close a finished note, which no PR ever closes (#879)", () => {
  it("closes an issue labelled note as completed", () => {
    const closing = closingNote("wayfinder:task\\nnote\\n");

    expect(heard(closing.run("887"))).toEqual({ status: 0, stderr: "", lines: ["close-note: #887 is closed"] });
    expect(closing.calls()).toEqual(["issue view 887 --json labels --jq .labels[].name", "issue close 887 --reason completed"]);
  });

  it("refuses a ticket and closes nothing, since a ticket closes when its PR merges", () => {
    const closing = closingNote("2-building\\n");

    expect(closing.run("891")).toEqual({
      status: 1,
      stdout: "",
      stderr: "close-note: #891 is not a note; a ticket closes when its PR merges\n",
    });
    expect(closing.calls()).toEqual(["issue view 891 --json labels --jq .labels[].name"]);
  });

  it("refuses anything but one issue number, and asks GitHub for nothing", () => {
    const closing = closingNote("note\\n");

    expect(heard(closing.run("887", "888")).status).toBe(2);
    expect(heard(closing.run("#887")).status).toBe(2);
    expect(closing.calls()).toEqual([]);
  });

  it("says in one line why GitHub would not close it", () => {
    const closing = closingNote("note\\n", { gh: "printf 'HTTP 403: Resource not accessible by integration\\n' >&2\nexit 1\n" });

    expect(closing.run("887")).toEqual({
      status: 1,
      stdout: "",
      stderr: "close-note: #887 not closed: HTTP 403: Resource not accessible by integration\n",
    });
  });
});
