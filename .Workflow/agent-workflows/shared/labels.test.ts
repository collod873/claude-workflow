import { describe, expect, it } from "vitest";
import type { GhExec } from "./gh";
import { createRecordingGh } from "./gh.fake";
import {
  BUILDING_LABEL,
  BY_HAND_LABEL,
  DECIDE_LABEL,
  FAMILY_COLORS,
  LABEL_CATALOGUE,
  labelsOf,
  markLane,
  NEEDS_HUMAN_LABEL,
  QUEUED_LABEL,
  renderLabelsTable,
  SLICEABLE_LABEL,
  TICKET_LABEL,
  TO_BUILD_LABEL,
  WAITING_LABEL,
  wearsLane,
  withLabelsTable,
} from "./labels";
import { escalateToOwner } from "./needs-human";

function wearing(labels: string[]): { gh: GhExec; calls: string[][] } {
  const { gh, calls } = createRecordingGh();
  const answering: GhExec = (args) => {
    if (args[0] === "issue" && args[1] === "view") {
      calls.push([...args]);
      return JSON.stringify({ labels: labels.map((name) => ({ name })) });
    }
    return gh(args);
  };
  return { gh: answering, calls };
}

const edits = (calls: string[][]) => calls.filter((call) => call[0] === "issue" && call[1] === "edit");

describe("the catalogue", () => {
  it("names every label once, each with a family colour and a description", () => {
    const names = LABEL_CATALOGUE.map((label) => label.name);
    expect(new Set(names).size).toBe(names.length);
    for (const label of LABEL_CATALOGUE) {
      expect(label.color).toBe(FAMILY_COLORS[label.family]);
      expect(label.description.length).toBeGreaterThan(10);
    }
  });

  it("sorts the in-flight labels in pipeline order by their lane number", () => {
    const numbered = labelsOf("in-flight").filter((name) => /^\d/.test(name));
    expect(numbered).toEqual([...numbered].sort());
    expect(numbered[0]).toBe("1-shaping");
    expect(numbered.at(-1)).toBe("8-landing");
  });

  it("carries no `running`: that label leaves with the sibling by-hand ticket", () => {
    expect(LABEL_CATALOGUE.map((label) => label.name)).not.toContain("running");
  });

  it("renders a table the doc embeds between its markers, one row per label", () => {
    const table = renderLabelsTable();
    for (const label of LABEL_CATALOGUE) expect(table).toContain(`| \`${label.name}\` |`);
    expect(withLabelsTable("head\n<!-- labels-table:v1 -->\nstale\n<!-- /labels-table:v1 -->\ntail")).toBe(`head\n${table}\ntail`);
    expect(() => withLabelsTable("no markers here")).toThrow(/labels-table/);
  });
});

describe("markLane", () => {
  it("adds the named lane label and removes every other green or blue label the issue wears, in one edit", () => {
    const { gh, calls } = wearing([TICKET_LABEL, WAITING_LABEL, SLICEABLE_LABEL, NEEDS_HUMAN_LABEL]);

    markLane(gh, 42, BUILDING_LABEL);

    expect(edits(calls)).toEqual([
      ["issue", "edit", "42", "--remove-label", WAITING_LABEL, "--remove-label", SLICEABLE_LABEL, "--add-label", BUILDING_LABEL],
    ]);
  });

  it("leaves red, purple, grey and amber labels where they are", () => {
    const { gh, calls } = wearing([TICKET_LABEL, NEEDS_HUMAN_LABEL, TO_BUILD_LABEL, BY_HAND_LABEL]);

    markLane(gh, 42, QUEUED_LABEL);

    expect(edits(calls)).toEqual([["issue", "edit", "42", "--add-label", QUEUED_LABEL]]);
  });

  it("makes sure the label exists on the repository before it writes it", () => {
    const { gh, calls } = wearing([]);

    markLane(gh, 42, BUILDING_LABEL);

    const [create] = calls;
    expect(create.slice(0, 3)).toEqual(["label", "create", BUILDING_LABEL]);
    expect(create).toContain("--force");
    expect(create).toContain(FAMILY_COLORS["in-flight"]);
  });

  it("clears green and blue when it stamps a red state label, so an idea waiting on the owner wears no lane", () => {
    const { gh, calls } = wearing(["idea", "1-shaping"]);

    markLane(gh, 7, DECIDE_LABEL);

    expect(edits(calls)).toEqual([["issue", "edit", "7", "--remove-label", "1-shaping", "--add-label", DECIDE_LABEL]]);
  });

  it("swallows a tracker that refuses, so a label is never what ends a lane", () => {
    const refusing: GhExec = () => {
      throw new Error("HTTP 403");
    };

    expect(() => markLane(refusing, 42, BUILDING_LABEL)).not.toThrow();
  });
});

describe("escalateToOwner", () => {
  it("removes the green and blue labels before it adds needs-human, and assigns the owner", () => {
    const { gh, calls } = wearing([BUILDING_LABEL, TICKET_LABEL]);

    escalateToOwner(gh, 42, "collod873");

    expect(edits(calls)).toEqual([
      ["issue", "edit", "42", "--remove-label", BUILDING_LABEL, "--add-label", NEEDS_HUMAN_LABEL],
      ["issue", "edit", "42", "--add-assignee", "collod873"],
    ]);
  });

  it("adds needs-human alone when nothing green or blue is on the issue", () => {
    const { gh, calls } = wearing([TICKET_LABEL]);

    escalateToOwner(gh, 42, undefined);

    expect(edits(calls)).toEqual([["issue", "edit", "42", "--add-label", NEEDS_HUMAN_LABEL]]);
  });
});

describe("wearsLane", () => {
  it("is true only when the issue wears that label and no other lane label", () => {
    expect(wearsLane([WAITING_LABEL, TICKET_LABEL], WAITING_LABEL)).toBe(true);
    expect(wearsLane([WAITING_LABEL, QUEUED_LABEL], WAITING_LABEL)).toBe(false);
    expect(wearsLane([TICKET_LABEL], WAITING_LABEL)).toBe(false);
  });
});
