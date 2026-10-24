import { describe, expect, it } from "vitest";
import { admitting } from "./admit.part.ts";

const NO_FOLLOW_UP = "as no follow-up the machine builds";
const SPEC = { state: "open", user: { login: "collod873" }, labels: [{ name: "spec" }] };
const APP = "collod873-machine[bot]";
const FAULT = ["## Why", "", "Filed by the builder of collod873/Lumaria#931, which waits on it, as the machine's fault.", "", "> Save runs on a ticket outcome.", "", "## Done when", "", "- Save never runs on a ticket outcome.", ""].join("\n");
const followUp = (line: string) => ["## Why", "", line, "", "> The Day clock spans and punches.", "", "## Done when", "", "- Riley clocks in on /team/timesheets.", ""].join("\n");
const SPLIT_PIECE = followUp("Follow-up of #1089: its builder split it, since it does not fit one build.");
const fromLumaria = (opener: string, parent: object | undefined, body?: string) => ({ repo: "collod873/Lumaria", ticket: "931", opener, parent, body });
const ticketWhy = (line: string) => `## Why\n\n${line}\n\n## Done when\n\n- The builder builds it.\n`;
const parentReads = (calls: string[][]) => calls.filter((args) => args.some((arg) => arg.endsWith("/parent")));

describe("bin/admit lets a ticket into its build before anything marks it (#1022)", () => {
  it.each([
    ["the owner's own ticket", {}],
    ["the builder's follow-up", { opener: APP, body: ticketWhy("Follow-up of #865: its builder split it, since it does not fit one build.") }],
  ])("admits %s without reading any parent", (_, scenario) => {
    const { run, calls, comments } = admitting(scenario);

    const result = run();

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe("admitted=true\n");
    expect(parentReads(calls())).toEqual([]);
    expect(comments()).toEqual([]);
  });

  it.each([
    ["under no spec", undefined],
    ["under an open spec the owner opened, since no stage files a ticket under a spec once slices replaced waves (#1509)", SPEC],
  ])("refuses a ticket the App opened %s, saying why on the ticket, asking the owner nothing and reading no parent", (_, parent) => {
    const { run, calls, comments } = admitting({ opener: APP, parent });

    const result = run();

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe("admitted=false\n");
    expect(comments()).toHaveLength(1);
    expect(comments()[0]).toContain(NO_FOLLOW_UP);
    expect(comments()[0]).not.toContain("@");
    expect(parentReads(calls())).toEqual([]);
  });

  it("fails red, admitting nothing and saying nothing on the ticket, when the ticket cannot be read", () => {
    const ticket = admitting({ unread: true });

    expect(ticket.run()).toEqual({ status: 1, stdout: "", stderr: "admit: #811 could not be read, so nothing was admitted\n" });
    expect(ticket.comments()).toEqual([]);
  });

  it("refuses a machine fault the App filed from an enrolled repo's ticket the App opened under an open spec the owner opened there, naming the origin (#1509)", () => {
    const { run, comments } = admitting({ opener: APP, body: FAULT, origin: fromLumaria(APP, SPEC) });

    expect(run().stdout).toBe("admitted=false\n");
    expect(comments()[0]).toContain("collod873/Lumaria#931");
  });

  it.each([
    ["a machine fault the App filed from a split piece, which builds in its own repo with no spec above it (Lumaria #1090)", FAULT, fromLumaria(APP, undefined, SPLIT_PIECE)],
    ["a first step the App filed in the repo that owns it from a ticket the owner opened, so the step builds there", FAULT.replace("as the machine's fault.", "as its first step."), fromLumaria("collod873", undefined)],
  ])("admits %s", (_, body, origin) => {
    const { run, comments } = admitting({ opener: APP, body, origin });

    const result = run();

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe("admitted=true\n");
    expect(comments()).toEqual([]);
  });

  it("refuses a machine fault whose origin ticket was itself opened by the App under no spec, naming the origin (#1203)", () => {
    const { run, comments } = admitting({ opener: APP, body: FAULT, origin: fromLumaria(APP, undefined) });

    const result = run();

    expect(result.stdout).toBe("admitted=false\n");
    expect(comments()[0]).toContain("collod873/Lumaria#931");
    expect(comments()[0]).toContain(NO_FOLLOW_UP);
  });
});

describe("bin/admit lets research's follow-up in when its note is a research note the owner opened (#1470)", () => {
  const FOUND = ticketWhy("Follow-up of #1461: its research found this.");
  const NOTE = { number: "1461", opener: "collod873", labels: ["note", "research"], state: "closed" };

  it.each([
    ["closed", NOTE],
    ["open", { ...NOTE, state: "open" }],
  ])("admits research's follow-up from a research note the owner opened, %s", (_, note) => {
    const { run, calls, comments } = admitting({ opener: APP, body: FOUND, note });

    const result = run();

    expect(result.stdout, result.stderr).toBe("admitted=true\n");
    expect(parentReads(calls())).toEqual([]);
    expect(comments()).toEqual([]);
  });

  it.each([
    ["the App opened", { ...NOTE, opener: APP }],
    ["is not labelled research", { ...NOTE, labels: ["note"] }],
  ])("refuses research's follow-up whose note %s, as any ticket the App opened", (_, note) => {
    const { run, comments } = admitting({ opener: APP, body: FOUND, note });

    expect(run().stdout).toBe("admitted=false\n");
    expect(comments()[0]).toContain(NO_FOLLOW_UP);
  });
});

describe("bin/admit lets what a reviewer let through in when the ticket it reviewed builds (#1491)", () => {
  const LET_THROUGH = ticketWhy("Follow-up of #765: its reviewer let this through.");
  const REVIEWED = { number: "765", opener: "collod873", labels: ["ticket"], state: "closed" };

  it("admits a reviewer's follow-up whose reviewed ticket the owner opened", () => {
    const { run, comments } = admitting({ opener: APP, body: LET_THROUGH, note: REVIEWED });

    expect(run().stdout).toBe("admitted=true\n");
    expect(comments()).toEqual([]);
  });

  it.each([
    ["whose reviewed ticket the App opened", LET_THROUGH, { ...REVIEWED, opener: APP }, "#765"],
    ["naming a ticket filed after it", ticketWhy("Follow-up of #900: its reviewer let this through."), { ...REVIEWED, number: "900" }, NO_FOLLOW_UP],
  ])("refuses a reviewer's follow-up %s", (_, body, note, why) => {
    const { run, comments } = admitting({ opener: APP, body, note });

    expect(run().stdout).toBe("admitted=false\n");
    expect(comments()[0]).toContain(why);
  });
});

describe("bin/admit lets the App's ticket in only as a follow-up a stage wrote (#1022, #1509)", () => {
  it.each([
    ["only quotes a follow-up line", ticketWhy("> Follow-up of #865: its builder split it, since it does not fit one build.")],
    ["has a follow-up line the builder does not write", ticketWhy("Follow-up of #865: its notes.")],
    ["has the review follow-up line no stage writes since one run builds, reviews and lands a ticket (#1445)", ticketWhy("Follow-up of #865: its review found this after its builder's repair.")],
  ])("refuses a ticket the App opened whose Why %s", (_, body) => {
    const { run, comments } = admitting({ opener: APP, body });

    expect(run().stdout).toBe("admitted=false\n");
    expect(comments()[0]).toContain(NO_FOLLOW_UP);
  });
});

describe("bin/admit follows a first step's origin in its own repo by the whole chain a ticket there builds by", () => {
  const STEP = FAULT.replace("as the machine's fault.", "as its first step.");
  const LUMARIA = "collod873/Lumaria";
  const REVIEWED = { number: "900", opener: "collod873", labels: ["ticket"], state: "closed", repo: LUMARIA };
  const RESEARCHED = { number: "900", opener: "collod873", labels: ["note", "research"], state: "closed", repo: LUMARIA };
  const LET_THROUGH = ticketWhy("Follow-up of #900: its reviewer let this through.");
  const FOUND = ticketWhy("Follow-up of #900: its research found this.");
  const toldOn = (calls: string[][], repo: string, ticket: string) => calls.filter((args) => args[0] === "issue" && args[1] === "comment" && args[2] === ticket && args[args.indexOf("--repo") + 1] === repo).map((args) => args[args.indexOf("--body") + 1]);

  it.each([
    ["a reviewer's follow-up of a ticket the owner opened there", LET_THROUGH, REVIEWED],
    ["research's follow-up from a research note the owner opened there", FOUND, RESEARCHED],
    ["a reviewer's follow-up of a split piece there", LET_THROUGH, { ...REVIEWED, opener: APP, body: SPLIT_PIECE }],
  ])("admits a first step whose origin is %s", (_, originBody, note) => {
    const { run, comments } = admitting({ opener: APP, body: STEP, origin: fromLumaria(APP, undefined, originBody), note });

    const result = run();

    expect(result.stdout, result.stderr).toBe("admitted=true\n");
    expect(comments()).toEqual([]);
  });

  it("refuses a first step whose origin is a reviewer's follow-up of a ticket the App opened there as no follow-up, naming the whole chain", () => {
    const { run, comments } = admitting({ opener: APP, body: STEP, origin: fromLumaria(APP, undefined, LET_THROUGH), note: { ...REVIEWED, opener: APP } });

    expect(run().stdout).toBe("admitted=false\n");
    expect(comments()[0]).toContain("the first step of collod873/Lumaria#931");
    expect(comments()[0]).toContain("collod873/Lumaria#900");
    expect(comments()[0]).toContain(NO_FOLLOW_UP);
  });

  it("calls the owner on the ticket that waits on a refused first step, naming the step", () => {
    const { run, calls } = admitting({ opener: APP, body: STEP, origin: fromLumaria(APP, undefined) });

    expect(run().stdout).toBe("admitted=false\n");
    const told = toldOn(calls(), LUMARIA, "931");
    expect(told).toHaveLength(1);
    expect(told[0]).toContain("@collod873");
    expect(told[0]).toContain("collod873/design-kit#811, its first step,");
  });

  it("refuses a first step whose origin names it back as its own origin, after a bounded number of reads", () => {
    const { run, calls, comments } = admitting({ opener: APP, body: STEP, origin: fromLumaria(APP, undefined, STEP.replace("collod873/Lumaria#931", "collod873/design-kit#811")) });

    const result = run();

    expect(result.stdout, result.stderr).toBe("admitted=false\n");
    expect(comments()[0]).toContain("without reaching one the owner opened");
    expect(calls().filter((args) => args.includes("api")).length).toBeLessThanOrEqual(8);
  });
});
