import { describe, expect, it } from "vitest";
import { fixing } from "./builder.part.ts";
import { createdIssues, schemaIn } from "./scenarios.ts";

const FIXES = "printf 'export const shaped = 2;\\n' >src/ticket-shape.ts\n";
const FIX = { fault: "The trial balance's as-of cutoff falls at UTC midnight, 8pm Eastern.", title: "Cut the trial balance off at the business's midnight", done: ["The trial balance at 9pm on Oct 31 counts a payment posted at 8:30pm."] };
const NEEDS_NOTHING = { risk: "A webhook later than ten minutes could charge twice.", ends: "nothing", why: "Stripe drops the second charge on the same idempotency key." };
const FIXED_HERE = { risk: "Reissue threw away a half-filled raise form.", ends: "fixed", why: "It now keeps the form until the raise is sent." };

describe("every risk the ticket's reviewer names ends somewhere: fixed here, a ticket, or needing nothing, where 24 of 43 risks named since #1491 sat only in a merged PR's comment, as Lumaria#1332's double charge did, and the owner hears only his steps, where spec #1439's review sent him twelve calls the reviewer could make", () => {
  const routed = (extra: Parameters<typeof fixing>[0] = {}) => fixing({ claude: FIXES, review: { outcome: "approve", reason: "it builds the Why", fixes: [FIX], risks: [NEEDS_NOTHING, FIXED_HERE] }, ...extra });

  it("takes no answer that leaves out where its risks end, offers no end with the owner, and tells the reviewer each fault it finds is its to fix here", () => {
    const scenario = routed();

    expect(scenario.run().status).toBe(0);
    const schema = schemaIn(scenario.hired()[1] ?? []);
    expect(schema.required).toContain("risks");
    expect(schema.properties.risks?.items?.required).toEqual(expect.arrayContaining(["risk", "ends", "why"]));
    expect(schema.properties.risks?.items?.properties.ends?.enum).toEqual(["fixed", "nothing"]);
    const review = scenario.handed()[1] ?? "";
    expect(review).toContain("each fault you find is yours to fix on this branch, kept small");
    expect(review).toContain("The owner hears from your review through `steps` alone.");
    expect(review).toContain("Your review is done once each fault, cost or risk you saw sits in `fixes` or `risks`");
  });

  it("files each fix as a ticket naming the reviewed ticket, posts each risk with where it ends beside the reason, and still lands and closes", () => {
    const scenario = routed();

    expect(scenario.run().status).toBe(0);
    const [ticket, ...more] = createdIssues(scenario.calls());
    expect(ticket?.title).toBe(FIX.title);
    expect(ticket?.labels).toEqual(["ticket"]);
    expect(ticket?.body).toContain("Follow-up of #811: its reviewer let this through.");
    expect(ticket?.body).toContain(`> ${FIX.fault}`);
    expect(ticket?.body).toContain(`## Done when\n\n- ${FIX.done[0]}`);
    expect(more).toEqual([]);
    const [approved = ""] = scenario.approved();
    expect(approved).toMatch(/^it builds the Why\n\n/);
    expect(approved).toContain(`- filed as the ticket "${FIX.title}" once it lands: ${FIX.fault}`);
    expect(approved).toContain(`- needs nothing: ${NEEDS_NOTHING.risk} ${NEEDS_NOTHING.why}`);
    expect(approved).toContain(`- fixed here: ${FIXED_HERE.risk} ${FIXED_HERE.why}`);
  });

  it("posts the reason alone when the reviewer saw no risk", () => {
    const scenario = fixing({ claude: FIXES });

    expect(scenario.run().status).toBe(0);
    expect(scenario.approved()).toEqual(["it builds the Why"]);
    expect(createdIssues(scenario.calls())).toEqual([]);
  });

  it("still lands and closes when a filing is refused, and comments the refusal on the ticket", () => {
    const scenario = routed({ unreadable: '*"issue create"*"--label ticket"*' });

    const result = scenario.run();

    expect(result.status, result.stderr).toBe(0);
    const comment = scenario.ticketComments().find((said) => said?.includes(FIX.title));
    expect(comment).toContain("could not be filed");
    expect(comment).toContain("Bad credentials");
  });
});

describe("the builder's closing note reaches its reviewer, where about 20 of 35 builders' notes held a gap, a wait or an owner step that went nowhere", () => {
  it("hands every `code` answer's reason to the reviewer, to route as its own", () => {
    const scenario = fixing({ claude: FIXES, answer: { outcome: "code", reason: "One gap remains outside this ticket: typing a unit drops the map." } });

    expect(scenario.run().status).toBe(0);
    const review = scenario.handed()[1] ?? "";
    expect(review).toContain("## What its builder said");
    expect(review).toContain("One gap remains outside this ticket: typing a unit drops the map.");
    expect(scenario.handed()[0]).toContain("a `code` answer's goes to its reviewer");
  });
});

describe("after bin/land refuses, the PR's approve comment still carries the whole review, where 14 multi-round runs posted only the rebase story", () => {
  const LAND_REFUSES_ONCE = "[ -f ../land-refused ] || { touch ../land-refused; printf 'land: HEAD does not rebase cleanly onto origin/main\\n' >&2; exit 1; }\n";
  const ANSWERS_THE_REBASE = "  [ -f ../reviewed ] && sed -i 's/it builds the Why/the rebase conflict is fixed/' ../review.jsonl; touch ../reviewed\n  printf 'export const shaped = %s;\\n' \"$CALL\" >src/ticket-shape.ts\n";

  it("posts the review's first reason, then what each later answer changed for bin/land", () => {
    const scenario = fixing({ claude: FIXES, reviewer: ANSWERS_THE_REBASE, land: LAND_REFUSES_ONCE });

    expect(scenario.run().status).toBe(0);
    expect(scenario.approved()).toEqual(["it builds the Why", "it builds the Why\n\nAfter `bin/land` refused it: the rebase conflict is fixed"]);
  });
});
