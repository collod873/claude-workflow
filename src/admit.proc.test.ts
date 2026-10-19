import { describe, expect, it } from "vitest";
import { admitting } from "./admit.part.ts";

const SPEC = { state: "open", user: { login: "collod873" }, labels: [{ name: "spec" }] };
const APP = "collod873-machine[bot]";
const FAULT = ["## Why", "", "Filed by the builder of collod873/Lumaria#931, which waits on it, as the machine's fault.", "", "> Save runs on a ticket outcome.", "", "## Done when", "", "- Save never runs on a ticket outcome.", ""].join("\n");
const followUp = (line: string) => ["## Why", "", line, "", "> The Day clock spans and punches.", "", "## Done when", "", "- Riley clocks in on /team/timesheets.", ""].join("\n");
const SPLIT_PIECE = followUp("Follow-up of #1089: its builder split it, since it does not fit one build.");
const REVIEW_FOLLOW_UP = followUp("Follow-up of #1089: its review found");
const fromLumaria = (opener: string, parent: object | undefined, body?: string) => ({ repo: "collod873/Lumaria", ticket: "931", opener, parent, body });
const ticketWhy = (line: string) => `## Why\n\n${line}\n\n## Done when\n\n- The builder builds it.\n`;
const parentReads = (calls: string[][]) => calls.filter((args) => args.some((arg) => arg.endsWith("/parent")));

describe("bin/admit lets a ticket into its build before anything marks it (#1022)", () => {
  it.each([
    ["the owner's own ticket", {}],
    ["the reviewer's follow-up under no spec", { opener: APP, body: ticketWhy("Follow-up of #865: its review found this after its builder's repair.") }],
    ["the builder's follow-up under no spec", { opener: APP, body: ticketWhy("Follow-up of #865: its builder split it, since it does not fit one build.") }],
  ])("admits %s without reading any parent", (_, scenario) => {
    const { run, calls, comments } = admitting(scenario);

    const result = run();

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe("admitted=true\n");
    expect(parentReads(calls())).toEqual([]);
    expect(comments()).toEqual([]);
  });

  it("admits a ticket the App opened under an open spec the owner opened", () => {
    const result = admitting({ opener: APP, parent: SPEC }).run();

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe("admitted=true\n");
  });

  it("refuses a ticket the App opened under no spec, saying why on the ticket and asking the owner nothing", () => {
    const { run, comments } = admitting({ opener: APP });

    const result = run();

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe("admitted=false\n");
    expect(comments()).toHaveLength(1);
    expect(comments()[0]).toContain("no spec");
    expect(comments()[0]).not.toContain("@");
  });

  it("fails red, admitting nothing and saying nothing on the ticket, when the ticket or its parent cannot be read", () => {
    const parent = admitting({ opener: APP, parent: "unreadable" });
    const ticket = admitting({ unread: true });

    for (const [scenario, read] of [[parent, "the parent of #811"], [ticket, "#811"]] as const) {
      expect(scenario.run()).toEqual({ status: 1, stdout: "", stderr: `admit: ${read} could not be read, so nothing was admitted\n` });
      expect(scenario.comments()).toEqual([]);
    }
  });

  it("admits a machine fault the App filed from an enrolled repo's ticket under an open spec the owner opened there (#1203)", () => {
    const result = admitting({ opener: APP, body: FAULT, origin: fromLumaria(APP, SPEC) }).run();

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe("admitted=true\n");
  });

  it("admits a machine fault the App filed from a split piece or a review follow-up, which builds in its own repo with no spec above it (Lumaria #1090)", () => {
    for (const body of [SPLIT_PIECE, REVIEW_FOLLOW_UP]) {
      const { run, comments } = admitting({ opener: APP, body: FAULT, origin: fromLumaria(APP, undefined, body) });

      const result = run();

      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toBe("admitted=true\n");
      expect(comments()).toEqual([]);
    }
  });

  it("refuses a machine fault whose origin ticket was itself opened by the App under no spec, naming the origin (#1203)", () => {
    const { run, comments } = admitting({ opener: APP, body: FAULT, origin: fromLumaria(APP, undefined) });

    const result = run();

    expect(result.stdout).toBe("admitted=false\n");
    expect(comments()[0]).toContain("collod873/Lumaria#931");
    expect(comments()[0]).toContain("no spec");
  });
});

describe("bin/admit lets the App's ticket in only under an open spec the owner opened, or as a follow-up the reviewer or the builder wrote (#1022)", () => {

  it.each([
    ["a closed spec", { ...SPEC, state: "closed" }, "open"],
    ["a spec the App opened", { ...SPEC, user: { login: APP } }, "the owner"],
    ["an issue not labelled spec", { ...SPEC, labels: [{ name: "ticket" }] }, "spec"],
  ])("refuses a ticket the App opened under %s, saying why on the ticket", (_, parent, why) => {
    const { run, comments } = admitting({ opener: APP, parent });

    expect(run().stdout).toBe("admitted=false\n");
    expect(comments()).toHaveLength(1);
    expect(comments()[0]).toContain(why);
  });

  it.each([
    ["only quotes a follow-up line", ticketWhy("> Follow-up of #865: its review found this after the builder's one turn.")],
    ["has a follow-up line neither the reviewer nor the builder writes", ticketWhy("Follow-up of #865: its notes.")],
  ])("refuses a ticket the App opened under no spec whose Why %s", (_, body) => {
    const { run, comments } = admitting({ opener: APP, body });

    expect(run().stdout).toBe("admitted=false\n");
    expect(comments()[0]).toContain("no spec");
  });
});
