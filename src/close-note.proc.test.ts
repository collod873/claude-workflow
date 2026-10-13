import { describe, expect, it } from "vitest";
import { closingNote, heard } from "./scenarios.ts";

describe("bin/close-note lets a session close what no PR ever closes: a finished note (#879) or an issue the machine does not hold (agent-hooks#34)", () => {
  it("closes an issue labelled note as completed", () => {
    const closing = closingNote("wayfinder:task\\nnote\\n");

    expect(heard(closing.run("887"))).toEqual({ status: 0, stderr: "", lines: ["close-note: #887 is closed"] });
    expect(closing.calls()).toEqual(["issue view 887 --json labels --jq .labels[].name", "issue close 887 --reason completed"]);
  });

  it.each([
    ["an issue an app filed and a session only tested with", "from-app\\n"],
    ["an app's bug report, whose bug label is the app's own", "bug\\nfrom-app\\n"],
    ["an issue with no label at all", ""],
  ])("closes %s, which is neither a ticket nor a note", (_, labels) => {
    const closing = closingNote(labels);

    expect(heard(closing.run("22"))).toEqual({ status: 0, stderr: "", lines: ["close-note: #22 is closed"] });
    expect(closing.calls()).toEqual(["issue view 22 --json labels --jq .labels[].name", "issue close 22 --reason completed"]);
  });

  it.each([
    ["a ticket mid-build that predates the ticket label", "building\\n", "building"],
    ["a ticket whose PR has not merged", "from-app\\nticket\\n", "ticket"],
    ["a bug the machine builds", "bug\\nticket\\n", "ticket"],
    ["a spec, which its done check closes", "spec\\n", "spec"],
    ["a ticket the owner paused", "paused\\n", "paused"],
  ])("refuses %s and closes nothing, since the machine closes what it holds", (_, labels, holding) => {
    const closing = closingNote(labels);

    expect(closing.run("891")).toEqual({
      status: 1,
      stdout: "",
      stderr: `close-note: #891 is labelled ${holding}, so the machine closes it; a ticket closes when its PR merges\n`,
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
