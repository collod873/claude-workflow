import { describe, expect, it } from "vitest";
import { ACCEPTANCE_WANTED_DISPATCH_ACTION } from "../shared/ready-set";
import { authorsPublishedSlice, issueEditFrom, PRD_LABEL, refiresAffectedSlices, type IssueEditValues } from "./doors";

function edit(over: Partial<IssueEditValues> = {}): IssueEditValues {
  return { eventName: "issues", labels: `${PRD_LABEL},to-build`, sender: "collod873", owner: "collod873", ...over };
}

describe("#519: the re-fire reads the issue edit that woke it instead of a job condition", () => {
  it("re-fires when the owner edits a prd-labelled issue", () => {
    expect(refiresAffectedSlices(issueEditFrom(edit()))).toBe(true);
  });

  it("refuses an edit by anyone but the owner, so a stranger cannot spend a model", () => {
    expect(refiresAffectedSlices(issueEditFrom(edit({ sender: "passer-by" })))).toBe(false);
  });

  it("refuses an issue that is not a prd, since only a prd has slices to re-fire", () => {
    expect(refiresAffectedSlices(issueEditFrom(edit({ labels: "to-build,running" })))).toBe(false);
  });

  it("refuses an issue carrying no labels at all", () => {
    expect(refiresAffectedSlices(issueEditFrom(edit({ labels: "" })))).toBe(false);
  });

  it("refuses the dispatch door, which reaches the author rather than the re-fire", () => {
    expect(refiresAffectedSlices(issueEditFrom(edit({ eventName: "repository_dispatch", labels: "" })))).toBe(false);
  });

  it("treats an empty sender with an empty owner as not the owner", () => {
    expect(refiresAffectedSlices(issueEditFrom(edit({ sender: "", owner: "" })))).toBe(false);
  });

  it("reads a label list GitHub joined with commas, spaces and all", () => {
    expect(issueEditFrom(edit({ labels: ` ${PRD_LABEL} , , to-build ` })).issueLabels).toEqual([PRD_LABEL, "to-build"]);
  });
});

describe("#519: the author reads the dispatch that woke it instead of a job condition", () => {
  it("authors for the dispatch that publishes a slice", () => {
    expect(authorsPublishedSlice(ACCEPTANCE_WANTED_DISPATCH_ACTION)).toBe(true);
  });

  it.each(["edited", "labeled", ""])("refuses a %s action, which is the re-fire door or no door at all", (action) => {
    expect(authorsPublishedSlice(action)).toBe(false);
  });
});
