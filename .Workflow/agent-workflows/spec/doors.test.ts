import { describe, expect, it } from "vitest";
import { specDoorFrom, specsSource, TO_SPEC_LABEL, type SpecDoorValues } from "./doors";
import { SLICEABLE_LABEL } from "./open-questions";
import { PRD_LABEL } from "./publish";

const OWNER = "collod873";

function door(over: Partial<SpecDoorValues> = {}): SpecDoorValues {
  return { eventName: "issues", label: TO_SPEC_LABEL, sender: OWNER, owner: OWNER, labels: TO_SPEC_LABEL, ...over };
}

const opens = (values: SpecDoorValues) => specsSource(specDoorFrom(values));

describe("#519: the spec lane reads the three doors that reach it instead of a job condition", () => {
  it("specs a sheet the shape lane dispatched, whoever the dispatch names as sender", () => {
    expect(opens(door({ eventName: "repository_dispatch", label: "", sender: "", labels: "" }))).toBe(true);
  });

  it("specs an idea the owner labelled to-spec", () => {
    expect(opens(door())).toBe(true);
  });

  it("critiques a prd the owner labelled, which is the same lane on its second pass", () => {
    expect(opens(door({ label: PRD_LABEL, labels: PRD_LABEL }))).toBe(true);
  });

  it("refuses a prd already sliced, since critiquing it would re-author work the tickets came from", () => {
    expect(opens(door({ label: PRD_LABEL, labels: `${PRD_LABEL},${SLICEABLE_LABEL}` }))).toBe(false);
  });

  it("still specs a to-spec label on an issue that happens to carry sliceable", () => {
    expect(opens(door({ labels: `${TO_SPEC_LABEL},${SLICEABLE_LABEL}` }))).toBe(true);
  });

  it.each([TO_SPEC_LABEL, PRD_LABEL])("refuses a %s label anyone but the owner applied", (label) => {
    expect(opens(door({ label, labels: label, sender: "passer-by" }))).toBe(false);
  });

  it("refuses a label this lane does not wait for", () => {
    expect(opens(door({ label: "documentation", labels: "documentation" }))).toBe(false);
  });

  it("refuses an event that is neither a label nor a dispatch", () => {
    expect(opens(door({ eventName: "issue_comment", label: "" }))).toBe(false);
  });
});
