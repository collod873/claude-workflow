import { describe, expect, it } from "vitest";
import { fixing } from "./scenarios.ts";

const DRIFT = "The reviewer read this PR against the Why of #811 and found drift.\n\n- src/fixer.ts posts no marker\n";

describe("bin/fix clears a stuck ticket with one fixer turn (#811)", () => {
  it("posts its marker before any model and refuses a ticket that already carries one: one turn per ticket", () => {
    const first = fixing();

    expect(first.run().status).toBe(0);
    const marker = first.ticketComments()[0];
    expect(first.order().indexOf("gh issue comment")).toBeLessThan(first.order().indexOf("claude"));

    const second = fixing({ turns: ["a comment the owner left", marker] });
    const result = second.run();

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("one turn");
    expect(second.spent()).toBe(false);
    expect(second.ticketComments()).toEqual([]);
    expect(second.closes()).toEqual([]);
  });

  it("refuses a rewrite that changes one byte of the Why, and writes one that changes only the criteria with its reason on the PR: byte-identical", () => {
    const { body } = fixing();
    const reworded = body.replace("gets one turn", "gets One turn");
    const refused = fixing({ answer: { outcome: "ticket", reason: "the Why reads better this way", body: reworded } });

    expect(refused.run().status).toBe(1);
    expect(refused.edits()).toEqual([]);

    const recriteria = body.replace("The fixer clears a stuck ticket", "The fixer clears a ticket stuck at any stage");
    const reason = "the criterion named one stage where the Why means every stage";
    const written = fixing({ answer: { outcome: "ticket", reason, body: recriteria } });

    expect(written.run().status).toBe(0);
    expect(written.edits()).toEqual([recriteria]);
    expect(written.prComments()).toEqual([expect.stringContaining(reason)]);
    expect(written.closes()).toEqual([]);
  });

  it("closes unbuilt with the reason on the ticket and the branch kept, as it does when its turn ends red", () => {
    const reason = "the ticket asks for a stage the ruling has since dropped";
    const ruled = fixing({ answer: { outcome: "close", reason } });

    expect(ruled.run().status).toBe(0);
    expect(ruled.closes()).toEqual([["issue", "close", "811", "--reason", "not planned"]]);
    expect(ruled.ticketComments().at(-1)).toContain(reason);
    expect(ruled.branches()).toContain("ticket/811");

    const red = fixing({ answer: { outcome: "code", reason: "fixed it" } });

    expect(red.run().status).toBe(1);
    expect(red.closes()).toHaveLength(1);
    expect(red.ticketComments().at(-1)).toContain("changed nothing");
    expect(red.branches()).toContain("ticket/811");
  });

  it("hands the model the Why, the failure, the diff and the reviewer's gaps, and commits a code fix on the ticket branch", () => {
    const { run, handed, committed, closes } = fixing({
      answer: { outcome: "code", reason: "the export was never renamed" },
      logged: { "build-811.log": "1 refusals\nthe checks are still red after the repair round\n" },
      onPr: ["a comment nobody needs", DRIFT],
      claude: "printf 'export const shaped = 2;\\n' >src/ticket-shape.ts\n",
    });

    expect(run().status).toBe(0);
    expect(handed()).toContain("a stuck ticket gets one turn from a fresh fixer, never the owner");
    expect(handed()).toContain("the checks are still red after the repair round");
    expect(handed()).toContain("Tests  1 failed");
    expect(handed()).toContain("src/fixer.ts posts no marker");
    expect(handed()).not.toContain("a comment nobody needs");
    expect(handed()).toContain('+it("names the behaviour the criterion asks for"');
    expect(committed()).toEqual([expect.stringContaining("#811"), "src/ticket-shape.ts"]);
    expect(closes()).toEqual([]);
  });
});
