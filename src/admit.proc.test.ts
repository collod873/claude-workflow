import { describe, expect, it } from "vitest";
import { admitting } from "./admit.part.ts";

const SPEC = { state: "open", user: { login: "collod873" }, labels: [{ name: "spec" }] };
const APP = "collod873-machine[bot]";
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

    for (const scenario of [parent, ticket]) {
      const result = scenario.run();
      expect(result.status).not.toBe(0);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("could not be read");
      expect(scenario.comments()).toEqual([]);
    }
  });
});
