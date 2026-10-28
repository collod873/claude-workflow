import { describe, expect, it } from "vitest";
import { waitsOnFault, waitsOnOpen, waitsOnStep } from "./builder.ts";
import { closing, type FaultOrigin } from "./closer.part.ts";
import { faultOf, firstStepOf } from "./post.ts";
import { holds, workflowJobs } from "./scenarios.ts";

describe("bin/close wakes a ticket its builder split once every follow-up it split into has merged (#910)", () => {
  const piece = (ticket: string) =>
    ["## Why", "", "Follow-up of #811: its builder split it, since it does not fit one build.", "", "> The shape rules refuse a missing read by name.", "", "## Done when", "", `- The fix for #${ticket} lands.`, ""].join("\n");
  const said = "@collod873 the builder split #811 into #812, #813, which build themselves. #811 keeps what must wait for them, labelled `waiting`, and builds once they all merge: see #889";
  const woken = (calls: string[]) => calls.findIndex((call) => call.trimEnd() === "issue\nedit\n811\n--remove-label\nwaiting");

  it("takes `waiting` off the split ticket, as the App so its build starts, when the last follow-up merges", () => {
    const { calls, tokens, run } = closing({ closedIssue: "812", ticketBody: piece("812"), splitFrom: { parent: "811", labels: "waiting\n", said, siblings: { "812": "CLOSED COMPLETED", "813": "CLOSED COMPLETED" } } });

    const result = run();

    expect(result.status, result.stderr).toBe(0);
    expect(woken(calls())).toBeGreaterThanOrEqual(0);
    expect(tokens()[woken(calls())]).toBe("app");
    expect(result.stdout).toContain("#811 builds now");
  });

  it("leaves the split ticket waiting while a follow-up is still open, and never wakes one that is not waiting", () => {
    const early = closing({ closedIssue: "812", ticketBody: piece("812"), splitFrom: { parent: "811", labels: "waiting\n", said, siblings: { "812": "CLOSED COMPLETED", "813": "OPEN " } } });
    const unparked = closing({ closedIssue: "812", ticketBody: piece("812"), splitFrom: { parent: "811", labels: "building\n", said, siblings: { "812": "CLOSED COMPLETED", "813": "CLOSED COMPLETED" } } });

    const result = early.run();

    expect(result.status).toBe(0);
    expect(woken(early.calls())).toBe(-1);
    expect(result.stdout).toContain("#811 still waits for #813");
    expect(unparked.run().status).toBe(0);
    expect(woken(unparked.calls())).toBe(-1);
  });
});

describe("bin/close wakes a split ticket once every piece has closed, however each closed, and names how each ended (#1058)", () => {
  const said = "@collod873 the builder split #811 into #812, #813, which build themselves. #811 keeps what must wait for them, labelled `waiting`, and builds once they all close: see #889";
  const woken = (calls: string[]) => calls.findIndex((call) => call.trimEnd() === "issue\nedit\n811\n--remove-label\nwaiting");
  const told = (calls: string[]) => calls.find((call) => call.startsWith("issue\ncomment\n811\n"));

  it("wakes the split ticket when its last open piece closes unbuilt, naming each piece and how it ended", () => {
    const { calls, run } = closing({ splitFrom: { parent: "811", labels: "waiting\n", said, siblings: { "812": "CLOSED COMPLETED", "813": "CLOSED NOT_PLANNED" } } });

    const result = run();

    expect(result.status, result.stderr).toBe(0);
    expect(woken(calls())).toBeGreaterThanOrEqual(0);
    expect(told(calls())).toContain("#812 merged");
    expect(told(calls())).toContain("#813 closed unbuilt");
    expect(calls().indexOf(told(calls()) ?? ""), "tells the split ticket before its build starts").toBeLessThan(woken(calls()));
  });

  it("names the piece that just merged as merged, and wakes nothing and says nothing while a piece is still open", () => {
    const last = closing({ closedIssue: "812", splitFrom: { parent: "811", labels: "waiting\n", said, siblings: { "812": "CLOSED COMPLETED", "813": "CLOSED NOT_PLANNED" } } });
    const early = closing({ splitFrom: { parent: "811", labels: "waiting\n", said, siblings: { "812": "CLOSED NOT_PLANNED", "813": "OPEN " } } });

    expect(last.run().status).toBe(0);
    expect(told(last.calls())).toContain("#812 merged");
    expect(told(last.calls())).toContain("#813 closed unbuilt");
    expect(woken(last.calls())).toBeGreaterThanOrEqual(0);
    const result = early.run();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("#811 still waits for #813");
    expect(woken(early.calls())).toBe(-1);
    expect(told(early.calls())).toBeUndefined();
  });

  it("holds a split ticket whose pieces have all closed while its Waits on names an open issue, and wakes it once that closes (#1223)", () => {
    const body = ["## Why", "", '"one ticket"', "", "## Waits on", "", "- The Bank link ticket (#974), whose migration it reads.", "- The ticket split from this one.", "", "## Done when", "", "- It lands.", ""].join("\n");
    const held = closing({ closedIssue: "812", splitFrom: { parent: "811", labels: "waiting\n", said, body, siblings: { "812": "CLOSED COMPLETED", "813": "CLOSED COMPLETED", "974": "OPEN " } } });
    const freed = closing({ closedIssue: "812", splitFrom: { parent: "811", labels: "waiting\n", said, body, siblings: { "812": "CLOSED COMPLETED", "813": "CLOSED COMPLETED", "974": "CLOSED COMPLETED" } } });

    const result = held.run();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("#811 still waits for #974");
    expect(woken(held.calls())).toBe(-1);
    expect(told(held.calls())).toBeUndefined();
    expect(freed.run().status).toBe(0);
    expect(woken(freed.calls())).toBeGreaterThanOrEqual(0);
  });

  it("leaves a split ticket waiting on a Machine fault filed after its split, though every piece has closed (#1262)", () => {
    const fault = "@collod873 the builder of #811 found the machine at fault and filed https://github.com/collod873/claude-workflow/issues/1223. #811 waits on it, labelled `waiting`: take the label off once it merges. see #1262";
    const held = closing({ closedIssue: "812", splitFrom: { parent: "811", labels: "waiting\n", said: [said, fault], siblings: { "812": "CLOSED COMPLETED", "813": "CLOSED COMPLETED" } } });

    expect(held.run().status).toBe(0);
    expect(woken(held.calls())).toBe(-1);
    expect(told(held.calls())).toBeUndefined();
  });

  it("wakes with no merge, given the issue that closed, whenever an issue closes, so a piece closed unbuilt still wakes its split ticket", () => {
    const close = workflowJobs("tickets.yml").close;
    const { calls, run } = closing({ closedIssue: "813", splitFrom: { parent: "811", labels: "waiting\n", said, siblings: { "812": "CLOSED COMPLETED", "813": "CLOSED NOT_PLANNED" } } });

    expect(holds(close?.if ?? "false", { event: "issues", action: "closed" })).toBe(true);
    expect(holds(close?.if ?? "false", { event: "issues", action: "opened" })).toBe(false);
    expect(run().status).toBe(0);
    expect(woken(calls())).toBeGreaterThanOrEqual(0);
    expect(calls().some((call) => call.startsWith("issue\nclose\n"))).toBe(false);
  });
});

describe("bin/close wakes a foreign ticket waiting on a machine fault its builder filed, once every fault it filed has closed, since ADR-0005 leaves nothing waiting on the owner", () => {
  const fault = (filed: string) => `https://github.com/collod873/claude-workflow/issues/${filed}`;
  const parked = `${waitsOnFault("1015", [fault("812"), fault("813")])} its stage hooks were missing`;
  const faultBody = ["## Why", "", faultOf("collod873/Lumaria#1015"), "", "> The stage hooks were missing.", "", "## Done when", "", "- They are there.", ""].join("\n");
  const origin = (filed: Record<string, string>): FaultOrigin => ({ repo: "collod873/Lumaria", ticket: "1015", labels: ["ticket", "waiting"], said: [parked], filed });
  const woken = (calls: string[]) => calls.findIndex((call) => call.trimEnd() === "issue\nedit\n1015\n--remove-label\nwaiting");
  const told = (calls: string[]) => calls.findIndex((call) => call.startsWith("issue\ncomment\n1015\n"));

  it("wakes it in its own repo when the last fault merges, telling it how each fault ended first, and leaves it waiting while another is open", () => {
    const last = closing({ closedIssue: "812", ticketBody: faultBody, faultOrigin: origin({ "812": "CLOSED COMPLETED", "813": "CLOSED NOT_PLANNED" }) });
    const early = closing({ closedIssue: "812", ticketBody: faultBody, faultOrigin: origin({ "812": "CLOSED COMPLETED", "813": "OPEN " }) });

    const result = last.run();

    expect(result.status, result.stderr).toBe(0);
    expect(woken(last.calls())).toBeGreaterThanOrEqual(0);
    expect(last.repos()[woken(last.calls())]).toBe("collod873/Lumaria");
    expect(last.calls()[told(last.calls())]).toContain("#812 merged, #813 closed unbuilt");
    expect(last.repos()[told(last.calls())]).toBe("collod873/Lumaria");
    expect(told(last.calls())).toBeLessThan(woken(last.calls()));
    expect(result.stdout).toContain("collod873/Lumaria#1015 builds now");
    const held = early.run();
    expect(held.status, held.stderr).toBe(0);
    expect(woken(early.calls())).toBe(-1);
    expect(told(early.calls())).toBe(-1);
    expect(held.stdout).toContain("collod873/Lumaria#1015 still waits for #813");
  });

  it("wakes it when its last fault closes unbuilt and no PR merges in the run", () => {
    const { run, calls } = closing({ ticketBody: faultBody, closedIssue: "813", faultOrigin: origin({ "812": "CLOSED COMPLETED", "813": "CLOSED NOT_PLANNED" }) });

    const result = run();

    expect(result.status, result.stderr).toBe(0);
    expect(woken(calls())).toBeGreaterThanOrEqual(0);
    expect(calls()[told(calls())]).toContain("#812 merged, #813 closed unbuilt");
  });
});

describe("bin/close wakes a ticket waiting on a first step its builder handed to the repo that owns it, in that repo's close run, where Lumaria#1382 sat stuck until the owner filed design-kit#191", () => {
  const step = (filed: string) => `https://github.com/collod873/design-kit/issues/${filed}`;
  const parked = `${waitsOnStep("1382", "collod873/design-kit", [step("191")])} the kit's map needs coordinates`;
  const stepBody = ["## Why", "", firstStepOf("collod873/Lumaria#1382"), "", "> The kit's map needs coordinates.", "", "## Done when", "", "- It draws from a place ID.", ""].join("\n");
  const origin: FaultOrigin = { repo: "collod873/Lumaria", ticket: "1382", labels: ["ticket", "waiting"], said: [parked], filed: { "191": "CLOSED COMPLETED" } };

  it("wakes it in its own repo once the step closes in the owning repo", () => {
    const { run, calls, repos } = closing({ closedIssue: "191", closedIn: "collod873/design-kit", ticketBody: stepBody, faultOrigin: origin });

    const result = run();

    expect(result.status, result.stderr).toBe(0);
    const woken = calls().findIndex((call) => call.trimEnd() === "issue\nedit\n1382\n--remove-label\nwaiting");
    expect(woken).toBeGreaterThanOrEqual(0);
    expect(repos()[woken]).toBe("collod873/Lumaria");
    expect(result.stdout).toContain("collod873/Lumaria#1382 builds now");
  });
});

describe("bin/close wakes a ticket its builder parked waiting on an open ticket it depends on, where Mezzanine #1596 sat stuck six hours after #1592 merged (#1546)", () => {
  const said = `${waitsOnOpen("1596", ["#1592"])} see #1546`;
  const woken = (calls: string[]) => calls.findIndex((call) => call.trimEnd() === "issue\nedit\n1596\n--remove-label\nwaiting");

  it("takes `waiting` off, as the App so its build starts, once the ticket it depends on closes", () => {
    const { calls, tokens, run } = closing({ closedIssue: "1592", splitFrom: { parent: "1596", labels: "waiting\n", said, siblings: { "1592": "CLOSED COMPLETED" } } });

    expect(run().status).toBe(0);
    expect(woken(calls())).toBeGreaterThanOrEqual(0);
    expect(tokens()[woken(calls())]).toBe("app");
  });

  it("leaves it waiting while a ticket it depends on is still open", () => {
    const { calls, run } = closing({ closedIssue: "1592", splitFrom: { parent: "1596", labels: "waiting\n", said: `${waitsOnOpen("1596", ["#1592", "#1593"])} see #1546`, siblings: { "1592": "CLOSED COMPLETED", "1593": "OPEN " } } });

    expect(run().status).toBe(0);
    expect(woken(calls())).toBe(-1);
  });
});
