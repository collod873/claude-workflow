import { describe, expect, it } from "vitest";
import { admitting } from "./admit.part.ts";

const SPEC = { state: "open", user: { login: "collod873" }, labels: [{ name: "spec" }] };
const APP = "collod873-machine[bot]";
const FAULT = ["## Why", "", "Filed by the builder of collod873/Lumaria#931, which waits on it, as the machine's fault.", "", "> Save runs on a ticket outcome.", "", "## Done when", "", "- Save never runs on a ticket outcome.", ""].join("\n");
const fromLumaria = (opener: string, parent: object | undefined) => ({ repo: "collod873/Lumaria", ticket: "931", opener, parent });
const parentReads = (calls: string[][]) => calls.filter((args) => args.some((arg) => arg.endsWith("/parent")));

describe("bin/admit lets a ticket into its build before anything marks it (#1022)", () => {
  it("admits the owner's own ticket without reading any parent", () => {
    const { run, calls, comments } = admitting();

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

  it("refuses a machine fault whose origin ticket was itself opened by the App under no spec, naming the origin (#1203)", () => {
    const { run, comments } = admitting({ opener: APP, body: FAULT, origin: fromLumaria(APP, undefined) });

    const result = run();

    expect(result.stdout).toBe("admitted=false\n");
    expect(comments()[0]).toContain("collod873/Lumaria#931");
    expect(comments()[0]).toContain("no spec");
  });
});
