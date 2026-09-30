import { describe, expect, it } from "vitest";
import { OWNER } from "./scenarios.ts";
import { slicing } from "./slicer.part.ts";

const SPEC_ISSUE = { number: 968, state: "open", labels: [{ name: "spec" }], user: { login: OWNER }, body: "" };
const ticket = (number: number, state = "closed") => ({ number, state, labels: [], user: { login: "core-app[bot]" }, body: "## Why\n\n> the owner's words\n\n## Done when\n\n- It lands.\n" });
const followUp = (number: number, of: number, state = "open") => ({ ...ticket(number, state), body: `## Why\n\nFollow-up of #${of}: its review found this after its builder's repair, outside the earlier gaps and the fix's own lines.\n\n> a gap\n\n## Done when\n\n- It lands.\n` });
const NOTE = "## Wave 1\n\n> the owner's words\n\nSettled.\n\nFiles it.\n\nFiled: #1101, #1102.\n\n<!-- moves: 1, 3 -->\n";
const CHECKED = "## Wave check\n\n1. **Held**: see it\n";

function ended({ closed = 1102, tickets = [ticket(1101), ticket(1102)], spec = SPEC_ISSUE, open = [] as object[], said = [NOTE, CHECKED], extra = {} as Record<string, object> } = {}) {
  const issues: Record<string, object> = { "968": spec, "968/sub_issues": tickets, ...extra };
  for (const one of tickets) Object.assign(issues, { [String(one.number)]: one, [`${one.number}/parent`]: spec });
  const sliced = slicing({ issues, comments: { "968": said }, open });
  return { ...sliced, ran: sliced.run("--ended", String(closed)) };
}

describe("bin/slice --ended tells reslice.yml when a closed issue ends its spec's wave, and which sentences that wave should move (#1037)", () => {
  it("names the spec and the sentences the last `## Wave` note moves, once the spec's last open ticket closes", () => {
    const { ran, hired } = ended();

    expect(ran).toEqual({ status: 0, stdout: "spec=968\nmoves=1,3\n", stderr: "" });
    expect(hired()).toEqual([]);
  });

  it("names no spec while a ticket under it is still open", () => {
    const { ran } = ended({ tickets: [ticket(1101, "open"), ticket(1102)] });

    expect(ran).toEqual({ status: 0, stdout: "", stderr: "slice: #968's wave is not over, #1101 is still open\n" });
  });

  it("names no spec while a follow-up of one of its tickets is open, however deep", () => {
    const { ran } = ended({ open: [followUp(1201, 1101), followUp(1202, 1201)] });
    expect(ran.stdout).toBe("");
    expect(ran.stderr).toBe("slice: #968's wave is not over, #1201 is still open\n");

    const deep = ended({ closed: 1201, extra: { "1201": followUp(1201, 1101, "closed") }, open: [followUp(1202, 1201)] });
    expect(deep.ran.stdout).toBe("");
  });

  it("finds the spec through a closed follow-up's ticket, since a follow-up is not filed under the spec", () => {
    const { ran } = ended({ closed: 1201, extra: { "1201": followUp(1201, 1101, "closed") }, open: [followUp(1300, 999)] });

    expect(ran).toEqual({ status: 0, stdout: "spec=968\nmoves=1,3\n", stderr: "" });
  });

  it("names the spec with no sentences to move when no `## Wave` note carries a marker", () => {
    const { ran } = ended({ said: [CHECKED] });

    expect(ran.stdout).toBe("spec=968\nmoves=\n");
  });

  it("names no spec for an issue under no spec, or under a spec that is closed", () => {
    const loose = ended({ closed: 1500, extra: { "1500": ticket(1500) } });
    expect(loose.ran).toEqual({ status: 0, stdout: "", stderr: "slice: #1500 is under no spec, so no wave ended\n" });

    const shut = ended({ spec: { ...SPEC_ISSUE, state: "closed" } });
    expect(shut.ran).toEqual({ status: 0, stdout: "", stderr: "slice: #1102 is under no open spec, so no wave ended\n" });
  });
});
