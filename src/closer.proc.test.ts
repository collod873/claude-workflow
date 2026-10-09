import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { CLOSE_RUN, closing } from "./closer.part.ts";
import { HELD, PAUSED, STUCK } from "./spelled.ts";

const REPO = join(import.meta.dirname, "..");

const workflow = (name: string) =>
  parse(readFileSync(join(REPO, ".github", "workflows", name), "utf8")) as {
    on: Record<string, { workflows?: string[]; types?: string[] }>;
    jobs: Record<string, { steps: { run?: string; env?: Record<string, string> }[] }>;
  };

function closeWorkflow() {
  const { close } = workflow("tickets.yml").jobs;
  return { on: workflow("machine.yml").on, step: close?.steps.find((ran) => (ran.run ?? "").includes("bin/close")) };
}

describe("bin/close closes a ticket once its PR merges, since the PR's review and its full check already judged it (#931)", () => {
  it("closes the ticket as completed, naming in its closing record the PR that merged", () => {
    const { calls, run } = closing({ ticket: "812" });

    const result = run();

    expect(result.status).toBe(0);
    const commented = calls().find((call) => call.startsWith("issue\ncomment\n812\n"));
    expect(commented).toContain("#812 is done: PR #900 merged");
    expect(calls().some((call) => call.startsWith("issue\nclose\n812\n") && call.includes("completed"))).toBe(true);
    expect(calls().some((call) => call.startsWith("workflow\nrun\nmachine.yml"))).toBe(false);
  });
});

describe("bin/close names how long filing took to reach merged, and never gates on it (#809)", () => {
  it("carries a speed report from filing to merged, naming the longest wait, and still closes a ticket over an hour late", () => {
    const { calls, run } = closing({
      ticket: "814",
      timing: {
        filed: "2026-01-01T00:00:00Z",
        firstCommit: "2026-01-01T00:10:00Z",
        prOpened: "2026-01-01T01:40:00Z",
        checksGreen: "2026-01-01T01:45:00Z",
        merged: "2026-01-01T01:48:00Z",
      },
    });

    const result = run();

    expect(result.status).toBe(0);
    const commented = calls().find((call) => call.startsWith("issue\ncomment\n814\n"));
    expect(commented).toBeDefined();
    expect(commented).toMatch(/speed report/i);
    expect(commented).toMatch(/longest[^\n]*PR opened/i);
    expect(commented).toMatch(/\d+\s*(m|min|h|hour)/i);
    expect(calls().some((call) => call.startsWith("issue\nclose\n814"))).toBe(true);
  });

  it("dates the first commit by when it was written, so a rebase after the PR opened gives no negative wait", () => {
    const { calls, run } = closing({
      ticket: "816",
      timing: {
        filed: "2026-01-01T00:00:00Z",
        firstCommit: "2026-01-01T00:10:00Z",
        rebased: "2026-01-01T01:45:00Z",
        prOpened: "2026-01-01T01:40:00Z",
        checksGreen: "2026-01-01T01:50:00Z",
        merged: "2026-01-01T01:52:00Z",
      },
    });

    expect(run().status).toBe(0);
    const commented = calls().find((call) => call.startsWith("issue\ncomment\n816\n"));
    expect(commented).toContain("first commit to PR opened: 1h 30m");
    expect(commented).not.toMatch(/: -\d/);
  });
});

describe("bin/close ends a done ticket closed as completed with no state label (#851, #1055)", () => {
  it("re-closes as completed and strips the state label, even when the merge finds the ticket already closed as not planned", () => {
    const { calls, tokens, run } = closing({ ticket: "817", closedAs: "NOT_PLANNED" });

    const result = run();

    expect(result.status).toBe(0);
    const reopened = calls().findIndex((call) => call.startsWith("issue\nreopen\n817"));
    const closed = calls().findIndex((call) => call.startsWith("issue\nclose\n817"));
    expect(reopened, "reopens the ticket before closing it as completed").toBeGreaterThanOrEqual(0);
    expect(closed).toBeGreaterThan(reopened);
    expect(calls()[closed]).toContain("completed");
    expect(tokens()[reopened], "reopens with the token that fires no workflow, so the builder never hears of it").toBe("quiet");
    expect(tokens()[closed]).toBe("quiet");
    const stripped = calls().flatMap((call, at) => (call.startsWith("api\n-X\nDELETE\n") ? [`${call.split("\n")[3] ?? ""} ${tokens()[at] ?? ""}`] : []));
    expect(stripped, "strips its state and try labels through bin/mark, quietly, since its quiet close fires no close handler").toEqual([
      "repos/{owner}/{repo}/issues/817/labels/building quiet",
      "repos/{owner}/{repo}/issues/817/labels/try-2 quiet",
    ]);
  });

  it("leaves closed as completed a done ticket the merge already closed, reopening nothing", () => {
    const { calls, run } = closing({ ticket: "818", closedAs: "COMPLETED" });

    expect(run().status).toBe(0);
    expect(calls().some((call) => call.startsWith("issue\nreopen\n818"))).toBe(false);
    expect(calls().some((call) => call.startsWith("api\n-X\nDELETE\nrepos/{owner}/{repo}/issues/818/labels/building"))).toBe(true);
  });
});

describe("bin/close brings ticket PRs left behind by a merge up to date, so auto-merge is never stuck in silence (#858)", () => {
  it("brings an open ticket PR up to date, as the App, so its checks run again and auto-merge can finish", () => {
    const { calls, tokens, run } = closing({ ticket: "819", openPrs: [{ number: "901", ticket: "820" }] });

    const result = run();

    expect(result.status).toBe(0);
    const updated = calls().findIndex((call) => call.startsWith("pr\nupdate-branch\n901"));
    expect(updated, "the PR left behind by the merge is brought up to date").toBeGreaterThanOrEqual(0);
    expect(tokens()[updated], "runs as the App, so its checks run again").toBe("app");
  });

  it("wakes the builder of the ticket behind the stuck PR, instead of leaving it waiting in silence", () => {
    const { calls, tokens, run } = closing({
      ticket: "819",
      openPrs: [{ number: "903", ticket: "822", refused: "GraphQL: This branch is out-of-date and cannot be updated because of merge conflicts." }],
    });

    const result = run();

    expect(result.status).toBe(0);
    const wake = calls().find((call) => call.startsWith("workflow\nrun\nmachine.yml") && call.includes("ticket=822"));
    expect(wake, "the ticket behind the stuck PR is told why, waking its builder").toBeDefined();
    expect(wake).toContain("903");
    expect(wake).toContain("merge conflicts");
    expect(tokens()[calls().indexOf(wake ?? "")]).toBe("app");
  });
});

describe("bin/close brings land PRs left behind by a merge up to date too, since the ruleset holds them the same way (#869)", () => {
  it("brings an open land PR up to date, as the App", () => {
    const { calls, tokens, run } = closing({ ticket: "819", openPrs: [{ number: "904", ticket: "", branch: "land/0123456789ab" }] });

    expect(run().status).toBe(0);
    const updated = calls().findIndex((call) => call.startsWith("pr\nupdate-branch\n904"));
    expect(updated, "the land PR left behind by the merge is brought up to date").toBeGreaterThanOrEqual(0);
    expect(tokens()[updated]).toBe("app");
  });

  it("names on the land PR itself the reason it could not be brought up to date, since it has no ticket", () => {
    const { calls, run } = closing({
      ticket: "819",
      openPrs: [{ number: "905", ticket: "", branch: "land/ba9876543210", refused: "GraphQL: This branch is out-of-date and cannot be updated because of merge conflicts." }],
    });

    expect(run().status).toBe(0);
    const commented = calls().find((call) => call.startsWith("pr\ncomment\n905\n"));
    expect(commented, "the land PR is told why").toBeDefined();
    expect(commented).toContain("merge conflicts");
    expect(calls().some((call) => call.startsWith("issue\ncomment\n\n"))).toBe(false);
  });

  it("leaves alone a PR from a branch the machine did not open", () => {
    const { calls, run } = closing({ ticket: "819", openPrs: [{ number: "906", ticket: "", branch: "dependabot/npm_and_yarn/vitest-5.0.0" }] });

    expect(run().status).toBe(0);
    expect(calls().some((call) => call.includes("\n906"))).toBe(false);
  });
});

describe("bin/close wakes a ticket its builder split once every follow-up it split into has merged (#910)", () => {
  const piece = (ticket: string) =>
    ["## Why", "", "Follow-up of #811: its builder split it, since it does not fit one build.", "", "> The shape rules refuse a missing read by name.", "", "## Done when", "", `- The fix for #${ticket} lands.`, ""].join("\n");
  const said = "@collod873 the builder split #811 into #812, #813, which build themselves. #811 keeps what must wait for them, labelled `waiting`, and builds once they all merge: see #889";
  const woken = (calls: string[]) => calls.findIndex((call) => call.trimEnd() === "issue\nedit\n811\n--remove-label\nwaiting");

  it("takes `waiting` off the split ticket, as the App so its build starts, when the last follow-up merges", () => {
    const { calls, tokens, run } = closing({ ticket: "812", ticketBody: piece("812"), splitFrom: { parent: "811", labels: "waiting\n", said, siblings: { "813": "CLOSED COMPLETED" } } });

    const result = run();

    expect(result.status, result.stderr).toBe(0);
    expect(woken(calls())).toBeGreaterThanOrEqual(0);
    expect(tokens()[woken(calls())]).toBe("app");
    expect(result.stdout).toContain("#811 builds now");
  });

  it("leaves the split ticket waiting while a follow-up is still open, and never wakes one that is not waiting", () => {
    const early = closing({ ticket: "812", ticketBody: piece("812"), splitFrom: { parent: "811", labels: "waiting\n", said, siblings: { "813": "OPEN " } } });
    const unparked = closing({ ticket: "812", ticketBody: piece("812"), splitFrom: { parent: "811", labels: "building\n", said, siblings: { "813": "CLOSED COMPLETED" } } });

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
    const { calls, run } = closing({ ticket: "819", afterCheck: true, splitFrom: { parent: "811", labels: "waiting\n", said, siblings: { "812": "CLOSED COMPLETED", "813": "CLOSED NOT_PLANNED" } } });

    const result = run();

    expect(result.status, result.stderr).toBe(0);
    expect(woken(calls())).toBeGreaterThanOrEqual(0);
    expect(told(calls())).toContain("#812 merged");
    expect(told(calls())).toContain("#813 closed unbuilt");
    expect(calls().indexOf(told(calls()) ?? ""), "tells the split ticket before its build starts").toBeLessThan(woken(calls()));
  });

  it("names the piece that just merged as merged, and wakes nothing and says nothing while a piece is still open", () => {
    const last = closing({ ticket: "812", splitFrom: { parent: "811", labels: "waiting\n", said, siblings: { "813": "CLOSED NOT_PLANNED" } } });
    const early = closing({ ticket: "819", afterCheck: true, splitFrom: { parent: "811", labels: "waiting\n", said, siblings: { "812": "CLOSED NOT_PLANNED", "813": "OPEN " } } });

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
    const held = closing({ ticket: "812", splitFrom: { parent: "811", labels: "waiting\n", said, body, siblings: { "813": "CLOSED COMPLETED", "974": "OPEN " } } });
    const freed = closing({ ticket: "812", splitFrom: { parent: "811", labels: "waiting\n", said, body, siblings: { "813": "CLOSED COMPLETED", "974": "CLOSED COMPLETED" } } });

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
    const held = closing({ ticket: "812", splitFrom: { parent: "811", labels: "waiting\n", said: [said, fault], siblings: { "813": "CLOSED COMPLETED" } } });

    expect(held.run().status).toBe(0);
    expect(woken(held.calls())).toBe(-1);
    expect(told(held.calls())).toBeUndefined();
  });

  it("runs as a queue run whenever an issue closes, so a piece closed with no PR still wakes its split ticket", () => {
    const { on, step } = closeWorkflow();

    expect(on.issues?.types).toContain("closed");
    expect(step?.env?.QUEUE_ONLY).toBe("${{ github.event_name != 'push' && 'queue' || '' }}");
  });
});

describe("bin/close wakes a reviewer's follow-up once its parent's PR merges or closes, so it builds on a main that holds its parent (#1033)", () => {
  const woken = (calls: string[], ticket: string) => calls.findIndex((call) => call.trimEnd() === `issue\nedit\n${ticket}\n--remove-label\nwaiting`);

  it("takes `waiting` off a follow-up, as the App so its build starts, once its parent's PR merged", () => {
    const { calls, tokens, run } = closing({ ticket: "821", followUps: [{ ticket: "830", parent: "821", parentPr: "MERGED" }] });

    const result = run();

    expect(result.status, result.stderr).toBe(0);
    expect(woken(calls(), "830")).toBeGreaterThanOrEqual(0);
    expect(tokens()[woken(calls(), "830")]).toBe("app");
    expect(result.stdout).toContain("#830 builds now, the PR of #821 merged");
  });

  it("wakes a follow-up whose parent's PR closed unmerged, so no follow-up waits forever", () => {
    const { calls, run } = closing({ ticket: "819", afterCheck: true, followUps: [{ ticket: "831", parent: "822", parentPr: "CLOSED" }] });

    const result = run();

    expect(result.status, result.stderr).toBe(0);
    expect(woken(calls(), "831")).toBeGreaterThanOrEqual(0);
    expect(result.stdout).toContain("#831 builds now, the PR of #822 closed");
  });

  it("leaves waiting a follow-up whose parent's PR is still open, and one its builder split", () => {
    const { calls, run } = closing({
      ticket: "819",
      followUps: [
        { ticket: "832", parent: "823", parentPr: "OPEN" },
        { ticket: "833", parent: "824", parentPr: "MERGED", split: true },
      ],
    });

    expect(run().status).toBe(0);
    expect(woken(calls(), "832")).toBe(-1);
    expect(woken(calls(), "833")).toBe(-1);
  });

  it("leaves waiting a follow-up whose parent's PR merged while its Waits on names an open issue (#1223)", () => {
    const held = closing({ ticket: "821", followUps: [{ ticket: "834", parent: "821", parentPr: "MERGED", waitsOn: { ticket: "974", state: "OPEN " } }] });
    const freed = closing({ ticket: "821", followUps: [{ ticket: "834", parent: "821", parentPr: "MERGED", waitsOn: { ticket: "974", state: "CLOSED COMPLETED" } }] });

    const result = held.run();
    expect(result.status, result.stderr).toBe(0);
    expect(woken(held.calls(), "834")).toBe(-1);
    expect(result.stdout).toContain("#834 still waits for #974");
    expect(freed.run().status).toBe(0);
    expect(woken(freed.calls(), "834")).toBeGreaterThanOrEqual(0);
  });

  it("runs as a queue run whenever a PR closes, so a parent closed unmerged wakes its follow-ups at once", () => {
    const { on, step } = closeWorkflow();

    expect(on.pull_request_target).toEqual({ types: ["closed"] });
    expect(step?.env?.QUEUE_ONLY).toBe("${{ github.event_name != 'push' && 'queue' || '' }}");
  });
});

describe("bin/close wakes the ticket's builder directly, instead of reopening it or leaving it a comment, when it cannot bring the ticket up to date (#957)", () => {
  const woken = (calls: string[], ticket: string) => calls.find((call) => call.startsWith("workflow\nrun\nmachine.yml") && call.includes(`ticket=${ticket}`));

  it("wakes the ticket's builder instead of commenting, when its PR cannot be brought up to date by a merge", () => {
    const { calls, tokens, run } = closing({
      ticket: "819",
      openPrs: [{ number: "909", ticket: "830", refused: "GraphQL: This branch is out-of-date and cannot be updated because of merge conflicts." }],
    });

    const result = run();

    expect(result.status).toBe(0);
    const wake = woken(calls(), "830");
    expect(wake, "dispatches the caller file, naming the ticket").toBeDefined();
    expect(wake).toContain("merge conflicts");
    expect(tokens()[calls().indexOf(wake ?? "")], "runs as the App, so the caller file actually starts").toBe("app");
    expect(calls().some((call) => call.startsWith("issue\nreopen\n830"))).toBe(false);
    expect(calls().some((call) => call.startsWith("issue\ncomment\n830\n"))).toBe(false);
    expect(calls().some((call) => call.startsWith("pr\ncomment\n909\n")), "leaves the failed branch update comment on the PR (#980)").toBe(true);
  });
});

describe("bin/close wakes no builder for a conflict on a ticket the owner was called for (#1058)", () => {
  for (const held of HELD) {
    it(`leaves the failed branch update on the PR but starts no builder and marks nothing when the ticket carries ${held} (#1166)`, () => {
      const { calls, run } = closing({
        ticket: "819",
        openPrs: [{ number: "912", ticket: "834", held, refused: "GraphQL: This branch is out-of-date and cannot be updated because of merge conflicts." }],
      });

      const result = run();

      expect(result.status).toBe(0);
      expect(calls().some((call) => call.startsWith("pr\ncomment\n912\n"))).toBe(true);
      expect(calls().some((call) => call.startsWith("workflow\nrun\nmachine.yml"))).toBe(false);
      expect(calls().filter((call) => /^api\n-X\n(POST|DELETE)\nrepos\/\{owner\}\/\{repo\}\/issues\/834\//.test(call))).toEqual([]);
      expect(result.stdout).toContain(`#834 is labelled ${held}`);
    });
  }
});

describe("bin/close counts a ticket PR's collisions in its closing record: failed branch updates and re-reviews (#980)", () => {
  it("leaves a failed branch update on a ticket PR", () => {
    const { calls, run } = closing({
      ticket: "819",
      openPrs: [{ number: "911", ticket: "833", refused: "GraphQL: This branch is out-of-date and cannot be updated because of merge conflicts." }],
    });

    const result = run();

    expect(result.status).toBe(0);
    const commented = calls().find((call) => call.startsWith("pr\ncomment\n911\n"));
    expect(commented, "leaves the same comment a non-ticket PR gets").toBeDefined();
    expect(commented).toContain("PR #911 could not be brought up to date with main");
    expect(commented).toContain("merge conflicts");
    const wake = calls().find((call) => call.startsWith("workflow\nrun\nmachine.yml") && call.includes("ticket=833"));
    expect(wake, "still wakes the builder as today").toBeDefined();
  });

  it("counts failed branch updates and re-reviews", () => {
    const { calls, run } = closing({
      ticket: "836",
      prComments: [
        "PR #900 could not be brought up to date with main: GraphQL: This branch is out-of-date and cannot be updated because of merge conflicts.",
        "The reviewer read this PR against the Why of #836 and found drift.\n\n- a gap\n\nFingerprint: `judged-1`\n",
        "PR #900 could not be brought up to date with main: GraphQL: This branch is out-of-date and cannot be updated because of merge conflicts.",
        "Fingerprint: `judged-2`\n\nIt now reads a green build. Did this build what you meant, yes or no?",
        "Fingerprint: `judged-3`\n\nIt now reads a green build. Did this build what you meant, yes or no?",
      ],
    });

    const result = run();

    expect(result.status).toBe(0);
    const commented = calls().find((call) => call.startsWith("issue\ncomment\n836\n"));
    expect(commented).toBeDefined();
    expect(commented).toMatch(/speed report/i);
    expect(commented).toMatch(/failed branch update[^\n]*2/i);
    expect(commented).toMatch(/re-review[^\n]*2/i);
  });

  it("ends red naming its PR's comments when they cannot be read, and writes no record with counts it never read (#1099)", () => {
    const { calls, run } = closing({ ticket: "837", prCommentsUnreadable: true });

    const { status, stderr } = run();

    expect(status).toBe(1);
    expect(stderr).toBe("close: the comments on PR #900 could not be read, so #837 is left as it is\n");
    expect(calls().some((call) => /^issue\n(comment|close)\n837\n/.test(call))).toBe(false);
  });
});

describe("bin/close merges machine PRs one at a time, bringing only the oldest green one up to date, judged from git (#1011)", () => {
  const CONFLICT = "GraphQL: This branch is out-of-date and cannot be updated because of merge conflicts.";
  const updated = (calls: string[]) => calls.filter((call) => call.startsWith("pr\nupdate-branch\n")).map((call) => call.split("\n")[2]);

  it("after a merge, brings up to date only the oldest PR whose checks are green, and leaves the others as they are", () => {
    const { calls, run } = closing({
      ticket: "819",
      openPrs: [
        { number: "920", ticket: "840", checks: "pending" },
        { number: "921", ticket: "841", autoMerge: false },
        { number: "922", ticket: "842" },
        { number: "923", ticket: "843" },
        { number: "924", ticket: "844", checks: "red" },
      ],
    });

    const result = run();

    expect(result.status, result.stderr).toBe(0);
    expect(updated(calls())).toEqual(["922"]);
    expect(calls().some((call) => call.startsWith("issue\ncomment\n819\n")), "still closes the ticket that merged").toBe(true);
  });

  it("brings nothing up to date while a PR already up to date with main is still being checked", () => {
    const { calls, run } = closing({
      ticket: "819",
      openPrs: [
        { number: "925", ticket: "845" },
        { number: "926", ticket: "846", upToDate: true, checks: "pending" },
      ],
    });

    expect(run().status).toBe(0);
    expect(updated(calls())).toEqual([]);
  });

  it("wakes the builder of a PR whose update conflicts, and brings the next green PR up to date", () => {
    const { calls, run } = closing({
      ticket: "819",
      openPrs: [
        { number: "927", ticket: "847", refused: CONFLICT },
        { number: "928", ticket: "848" },
        { number: "929", ticket: "849" },
      ],
    });

    expect(run().status).toBe(0);
    expect(updated(calls())).toEqual(["927", "928"]);
    expect(calls().some((call) => call.startsWith("workflow\nrun\nmachine.yml") && call.includes("ticket=847"))).toBe(true);
  });

  it("wakes no builder again for a conflict it already reported at the PR's head, and brings the next green PR up to date", () => {
    const { calls, run } = closing({
      ticket: "819",
      openPrs: [
        { number: "935", ticket: "855", refused: CONFLICT, refusedBefore: true },
        { number: "936", ticket: "856" },
      ],
    });

    expect(run().status).toBe(0);
    expect(updated(calls())).toEqual(["936"]);
    expect(calls().some((call) => call.startsWith("workflow\nrun\nmachine.yml"))).toBe(false);
    expect(calls().some((call) => call.startsWith("pr\ncomment\n935\n"))).toBe(false);
  });

  it("tries again a PR whose update failed at its head for a passing reason, not a conflict, and wakes no builder for it (#1014)", () => {
    const { calls, run } = closing({
      ticket: "819",
      openPrs: [
        { number: "938", ticket: "858", refused: "Post \"https://api.github.com/graphql\": dial tcp: i/o timeout", refusedBefore: true },
        { number: "939", ticket: "859" },
      ],
    });

    expect(run().status).toBe(0);
    expect(updated(calls())).toEqual(["938", "938", "938", "939"]);
    expect(calls().some((call) => call.startsWith("workflow\nrun\nmachine.yml")), "a builder cannot fix a network error").toBe(false);
    expect(calls().some((call) => call.startsWith("pr\ncomment\n938\n")), "leaves no comment to pile up or count as a failed branch update").toBe(false);
  });

  it("judges a conflict from git, whatever GitHub's wording, so it wakes the builder and is skipped at its head after (#1014)", () => {
    const first = closing({ ticket: "819", openPrs: [{ number: "940", ticket: "860", refused: "GraphQL: Something went wrong.", conflicts: true }] });
    const again = closing({
      ticket: "819",
      openPrs: [
        { number: "941", ticket: "861", refused: "GraphQL: Something went wrong.", conflicts: true, refusedBefore: true },
        { number: "942", ticket: "862" },
      ],
    });

    expect(first.run().status).toBe(0);
    expect(first.calls().some((call) => call.startsWith("workflow\nrun\nmachine.yml") && call.includes("ticket=860"))).toBe(true);
    expect(first.calls().find((call) => call.startsWith("pr\ncomment\n940\n"))).toMatch(/Head: `[0-9a-f]{40}`/);
    expect(again.run().status).toBe(0);
    expect(updated(again.calls())).toEqual(["942"]);
  });

  it("names the PR's head in the conflict it reports, so a later run knows it was already reported", () => {
    const { calls, run } = closing({ ticket: "819", openPrs: [{ number: "937", ticket: "857", refused: CONFLICT }] });

    expect(run().status).toBe(0);
    expect(calls().find((call) => call.startsWith("pr\ncomment\n937\n"))).toMatch(/Head: `[0-9a-f]{40}`/);
  });

  it("once the PR at the front goes red, brings the next green PR up to date, and closes no ticket", () => {
    const { calls, run } = closing({
      ticket: "819",
      afterCheck: true,
      openPrs: [
        { number: "930", ticket: "850", upToDate: true, checks: "red" },
        { number: "931", ticket: "851" },
      ],
    });

    const result = run();

    expect(result.status, result.stderr).toBe(0);
    expect(updated(calls())).toEqual(["931"]);
    expect(calls().some((call) => /^issue\n(?!list\n|view\n)/.test(call)), "a finished check is not a merge, so no ticket is closed").toBe(false);
  });

  it("walks three PRs left behind by one merge through main, one at a time, with no one touching them", () => {
    const steps = [
      closing({ ticket: "819", openPrs: [{ number: "932", ticket: "852" }, { number: "933", ticket: "853" }, { number: "934", ticket: "854" }] }),
      closing({ ticket: "819", afterCheck: true, openPrs: [{ number: "932", ticket: "852", upToDate: true, checks: "pending" }, { number: "933", ticket: "853" }, { number: "934", ticket: "854" }] }),
      closing({ ticket: "852", openPrs: [{ number: "933", ticket: "853" }, { number: "934", ticket: "854" }] }),
      closing({ ticket: "853", openPrs: [{ number: "934", ticket: "854" }] }),
    ];

    const walked = steps.map(({ calls, run }) => {
      expect(run().status).toBe(0);
      return updated(calls());
    });

    expect(walked).toEqual([["932"], [], ["933"], ["934"]]);
  });
});

describe("bin/close merges the PR the queue waits for once it is green, since GitHub's auto-merge has been seen not to fire (#1171)", () => {
  const merged = (calls: string[]) => calls.filter((call) => call.startsWith("pr\nmerge\n"));

  it("merges the green PR up to date with main itself, matching its head, and still brings no other PR up to date", () => {
    const { calls, heads, run } = closing({
      ticket: "819",
      afterCheck: true,
      openPrs: [
        { number: "960", ticket: "880" },
        { number: "961", ticket: "881", upToDate: true },
      ],
    });

    const result = run();

    expect(result.status, result.stderr).toBe(0);
    expect(merged(calls())).toEqual([`pr\nmerge\n961\n--merge\n--match-head-commit\n${heads[1] ?? ""}\n`]);
    expect(calls().some((call) => call.startsWith("pr\nupdate-branch\n"))).toBe(false);
    expect(result.stdout).toContain("PR #961 merged");
  });

  it("merges nothing while the PR up to date with main is still being checked", () => {
    const { calls, run } = closing({ ticket: "819", afterCheck: true, openPrs: [{ number: "962", ticket: "882", upToDate: true, checks: "pending" }] });

    expect(run().status).toBe(0);
    expect(merged(calls())).toEqual([]);
  });

  it("leaves the PR to auto-merge and says why when GitHub refuses the merge, ending green", () => {
    const { calls, run } = closing({ ticket: "819", afterCheck: true, openPrs: [{ number: "963", ticket: "883", upToDate: true, mergeRefused: "GraphQL: Head branch was modified" }] });

    const result = run();

    expect(result.status, result.stderr).toBe(0);
    expect(merged(calls())).toHaveLength(1);
    expect(result.stdout).toContain("PR #963 could not be merged, so auto-merge is left to merge it: GraphQL: Head branch was modified");
  });
});

describe("bin/close neither queues nor merges a held ticket's PR, whose auto-merge bin/pause turned off (#1174)", () => {
  it.each(HELD)("leaves the green PR of a ticket labelled %s unmerged, un-updated and unmarked, even up to date with main", (held) => {
    const { calls, run } = closing({
      ticket: "819",
      afterCheck: true,
      openPrs: [
        { number: "970", ticket: "890", upToDate: true, autoMerge: false, held },
        { number: "971", ticket: "891", autoMerge: false, held },
      ],
    });

    const result = run();

    expect(result.status, result.stderr).toBe(0);
    expect(calls().some((call) => /^pr\n(merge|update-branch)\n/.test(call))).toBe(false);
    expect(calls().some((call) => /^issue\nedit\n(890|891)\n/.test(call) || /issues\/(890|891)\/labels/.test(call))).toBe(false);
    expect(result.stdout).toContain("no green PR waits behind main");
  });
});

describe("a finished Check run moves the queue on, and a red one wakes its builder, so a red PR never holds the queue (#1011)", () => {
  it("runs the closer's queue, closing no ticket, whenever a Check run completes, red or green", () => {
    const { on, step } = closeWorkflow();

    expect(on.workflow_run).toEqual({ workflows: ["Check"], types: ["completed"] });
    expect(step?.run).toContain("$QUEUE_ONLY");
    expect(step?.env?.QUEUE_ONLY).toBe("${{ github.event_name != 'push' && 'queue' || '' }}");
  });

  it("wakes the builder of a ticket whose Check run goes red, which is how a PR that fails after its update leaves the line", () => {
    const { on } = workflow("machine.yml");

    expect(on.workflow_run?.workflows).toContain("Check");
    expect(on.workflow_run?.types).toEqual(["completed"]);
  });
});

describe("bin/close writes on the PR and the ticket each run it made, so a merged ticket shows the queue ran on real GitHub (#1015)", () => {
  it("comments on a PR it brought up to date, linking the Close run that did it", () => {
    const { calls, tokens, run } = closing({ ticket: "819", openPrs: [{ number: "940", ticket: "860" }] });

    expect(run().status).toBe(0);
    const commented = calls().findIndex((call) => call.startsWith("pr\ncomment\n940\n"));
    expect(commented, "the PR is told it was brought up to date").toBeGreaterThanOrEqual(0);
    expect(calls()[commented]).toContain("PR #940 brought up to date with main");
    expect(calls()[commented]).toContain(CLOSE_RUN);
    expect(tokens()[commented]).toBe("app");
  });

  it("links the Close run in a failed update too", () => {
    const { calls, run } = closing({ ticket: "819", openPrs: [{ number: "941", ticket: "861", refused: "GraphQL: merge conflicts." }] });

    expect(run().status).toBe(0);
    expect(calls().find((call) => call.startsWith("pr\ncomment\n941\n"))).toContain(CLOSE_RUN);
  });

  it("links the Close run that wrote the closing record, and counts the branch updates that worked next to the failed ones", () => {
    const { calls, run } = closing({
      ticket: "838",
      prComments: [
        `PR #900 brought up to date with main by ${CLOSE_RUN}`,
        "PR #900 could not be brought up to date with main: GraphQL: merge conflicts.",
        `PR #900 brought up to date with main by ${CLOSE_RUN}`,
      ],
    });

    expect(run().status).toBe(0);
    const commented = calls().find((call) => call.startsWith("issue\ncomment\n838\n"));
    expect(commented).toMatch(/^- branch updates: 2$/m);
    expect(commented).toMatch(/^- failed branch updates: 1$/m);
    expect(commented).toContain(`Written by ${CLOSE_RUN}`);
  });
});

describe("bin/close marks what the queue does to each ticket, so waiting its turn, being landed and having a conflict resolved read apart (#1063)", () => {
  const CONFLICT = "GraphQL: This branch is out-of-date and cannot be updated because of merge conflicts.";
  const labelled = (calls: string[], ticket: string) => calls.flatMap((call, at) => (call.startsWith(`api\n-X\nPOST\nrepos/{owner}/{repo}/issues/${ticket}/labels\n`) ? [{ at, labels: call.split("\n").filter((line) => line.startsWith("labels[]=")) }] : []));
  const touched = (calls: string[], ticket: string) => calls.filter((call) => call.includes(`repos/{owner}/{repo}/issues/${ticket}/labels`));

  it("marks a ticket resolving before it wakes its builder for a conflict, and adds no try", () => {
    const { calls, tokens, run } = closing({ ticket: "819", openPrs: [{ number: "950", ticket: "870", labels: ["queued", "try-2"], refused: CONFLICT }] });

    expect(run().status).toBe(0);
    const wake = calls().findIndex((call) => call.startsWith("workflow\nrun\nmachine.yml") && call.includes("ticket=870"));
    const [marked] = labelled(calls(), "870");
    expect(marked?.labels).toEqual(["labels[]=resolving"]);
    expect(marked?.at).toBeLessThan(wake);
    expect(tokens()[marked?.at ?? -1], "marks quietly, so taking a label off starts no build").toBe("quiet");
    expect(touched(calls(), "870").some((call) => call.includes("try-3"))).toBe(false);
  });

  it("marks landing once it brings a branch up to date cleanly, since auto-merge can fire before any later run, and adds no try (#1073)", () => {
    const { calls, run } = closing({ ticket: "819", openPrs: [{ number: "951", ticket: "871", labels: ["queued", "try-2"] }] });

    expect(run().status).toBe(0);
    expect(labelled(calls(), "871").map(({ labels }) => labels)).toEqual([["labels[]=landing"]]);
    expect(touched(calls(), "871").some((call) => call.includes("try-3"))).toBe(false);
  });

  it("marks landing on the green ticket the queue waits for and queued on every other green one, writing only where the label differs", () => {
    const { calls, run } = closing({
      ticket: "819",
      afterCheck: true,
      openPrs: [
        { number: "952", ticket: "872", labels: ["landing"] },
        { number: "953", ticket: "873", upToDate: true, labels: ["checking"] },
        { number: "954", ticket: "874", labels: ["queued"] },
        { number: "955", ticket: "875", checks: "pending", labels: ["checking"] },
        { number: "956", ticket: "876", checks: "red", labels: ["checking"] },
        { number: "957", ticket: "877", held: STUCK },
        { number: "967", ticket: "887", held: PAUSED, labels: ["checking"] },
      ],
    });

    expect(run().status).toBe(0);
    expect(labelled(calls(), "873").map(({ labels }) => labels)).toEqual([["labels[]=landing"]]);
    expect(labelled(calls(), "872").map(({ labels }) => labels)).toEqual([["labels[]=queued"]]);
    expect(touched(calls(), "874")).toEqual([]);
    expect(touched(calls(), "875")).toEqual([]);
    expect(touched(calls(), "876")).toEqual([]);
    expect(touched(calls(), "877")).toEqual([]);
    expect(touched(calls(), "887")).toEqual([]);
  });

  it("marks no landing on a held ticket it brings up to date cleanly (#1166)", () => {
    for (const held of HELD) {
      const { calls, run } = closing({ ticket: "819", openPrs: [{ number: "951", ticket: "871", held, labels: ["queued"] }] });

      expect(run().status, held).toBe(0);
      expect(touched(calls(), "871").filter((call) => call.startsWith("api\n-X\n")), held).toEqual([]);
    }
  });

  it("marks no landing while the PR the queue waits for is still being checked, and marks queued every green one behind it", () => {
    const { calls, run } = closing({
      ticket: "819",
      afterCheck: true,
      openPrs: [
        { number: "961", ticket: "881", upToDate: true, checks: "pending", labels: ["checking"] },
        { number: "962", ticket: "882", labels: ["checking"] },
      ],
    });

    expect(run().status).toBe(0);
    expect(touched(calls(), "881")).toEqual([]);
    expect(labelled(calls(), "882").map(({ labels }) => labels)).toEqual([["labels[]=queued"]]);
  });

  it("marks checking through bin/mark on every ticket the queue no longer waits for, so only one ticket reads landing and none is left with no state (#1093)", () => {
    const { calls, tokens, run } = closing({
      ticket: "819",
      afterCheck: true,
      openPrs: [
        { number: "963", ticket: "883", checks: "pending", labels: ["landing"] },
        { number: "964", ticket: "884", checks: "red", labels: ["landing"] },
        { number: "966", ticket: "886", upToDate: true, labels: ["queued"] },
      ],
    });

    expect(run().status).toBe(0);
    expect(labelled(calls(), "886").map(({ labels }) => labels)).toEqual([["labels[]=landing"]]);
    expect(labelled(calls(), "883").map(({ labels }) => labels)).toEqual([["labels[]=checking"]]);
    const [red] = labelled(calls(), "884");
    expect(red?.labels).toEqual(["labels[]=checking"]);
    expect(tokens()[red?.at ?? -1], "marks quietly, so the mark starts no build").toBe("quiet");
    expect(calls().some((call) => call.includes("issues/884/labels/landing") && tokens()[calls().indexOf(call)] !== "quiet")).toBe(false);
  });

  it("leaves landing beside a held label as it is, so a paused or stuck ticket's state stays where it stopped (#1093, #1166)", () => {
    for (const held of HELD) {
      const { calls, run } = closing({ ticket: "819", afterCheck: true, openPrs: [{ number: "965", ticket: "885", checks: "red", held, labels: ["landing"] }] });

      expect(run().status, held).toBe(0);
      expect(touched(calls(), "885"), held).toEqual([]);
      expect(touched(calls(), "965"), held).toEqual([]);
    }
  });

  it("marks queued every green ticket behind the one it brings up to date, and none whose conflict is already reported", () => {
    const { calls, run } = closing({
      ticket: "819",
      openPrs: [
        { number: "958", ticket: "878", refused: CONFLICT, refusedBefore: true, labels: ["resolving"] },
        { number: "959", ticket: "879", labels: ["queued"] },
        { number: "960", ticket: "880", labels: ["checking"] },
      ],
    });

    expect(run().status).toBe(0);
    expect(touched(calls(), "878")).toEqual([]);
    expect(labelled(calls(), "879").map(({ labels }) => labels)).toEqual([["labels[]=landing"]]);
    expect(labelled(calls(), "880").map(({ labels }) => labels)).toEqual([["labels[]=queued"]]);
  });

  it("keeps landing on the PR next to merge while its checks rerun, takes it off one that stops being next, and marks queued the green one behind (#1073)", () => {
    const { calls, run } = closing({
      ticket: "819",
      afterCheck: true,
      openPrs: [
        { number: "967", ticket: "887", upToDate: true, checks: "pending", labels: ["landing"] },
        { number: "968", ticket: "888", upToDate: true, checks: "pending", labels: ["landing"] },
        { number: "969", ticket: "889", labels: ["queued"] },
      ],
    });

    expect(run().status).toBe(0);
    expect(touched(calls(), "887")).toEqual([]);
    expect(labelled(calls(), "888").map(({ labels }) => labels)).toEqual([["labels[]=checking"]]);
    expect(touched(calls(), "889")).toEqual([]);
  });

  it("keeps resolving on a ticket whose conflict is reported while another PR is next to merge, so its builder counts no try (#1077)", () => {
    const { calls, run } = closing({
      ticket: "819",
      afterCheck: true,
      openPrs: [
        { number: "970", ticket: "890", upToDate: true, checks: "pending", labels: ["landing"] },
        { number: "971", ticket: "891", refused: CONFLICT, refusedBefore: true, labels: ["resolving"] },
        { number: "972", ticket: "892", checks: "pending", labels: ["resolving", "try-2"] },
      ],
    });

    expect(run().status).toBe(0);
    expect(touched(calls(), "891")).toEqual([]);
    expect(touched(calls(), "892")).toEqual([]);
  });

  it("keeps resolving on a ticket its queue run brings up to date cleanly once main moved past the conflict, so its woken builder counts no try (#1077)", () => {
    const { calls, run } = closing({ ticket: "819", afterCheck: true, openPrs: [{ number: "974", ticket: "894", labels: ["resolving"] }] });

    expect(run().status).toBe(0);
    expect(calls().some((call) => call.startsWith("pr\nupdate-branch\n974\n"))).toBe(true);
    expect(touched(calls(), "894")).toEqual([]);
  });
});

describe("bin/close writes each mark on the ticket's open PR too, and says in its log when a mark fails (#1077)", () => {
  it("runs as the App, so bin/mark can find and label the ticket's open PR", () => {
    expect(closeWorkflow().step?.env?.GH_TOKEN).toBe("${{ steps.app.outputs.token }}");
  });

  it("passes on bin/mark's refusal in its log, and still brings the PR up to date", () => {
    const { calls, run } = closing({ ticket: "823", afterCheck: true, openPrs: [{ number: "973", ticket: "893", labels: ["queued"] }], prLookupRefused: "HTTP 403: Resource not accessible by integration" });

    const { status, stderr } = run();

    expect(status).toBe(0);
    expect(stderr).toBe("mark: #893's open PR not labelled landing: HTTP 403: Resource not accessible by integration\n");
    expect(calls().some((call) => call.startsWith("pr\nupdate-branch\n973\n"))).toBe(true);
  });
});

describe("bin/close stops red at the first read it cannot make, and marks nothing after it (#1099)", () => {
  const marked = (calls: string[]) => calls.filter((call) => /^api\n-X\n(POST|DELETE)\n/.test(call));

  it("leaves stuck on a ticket whose labels cannot be read, naming the label read and the ticket", () => {
    const { calls, run } = closing({ ticket: "819", afterCheck: true, openPrs: [{ number: "975", ticket: "895", held: STUCK, labelsUnreadable: true }] });

    const { status, stderr } = run();

    expect(status).toBe(1);
    expect(stderr).toBe("close: the labels of #895 could not be read, so nothing is marked\n");
    expect(marked(calls())).toEqual([]);
  });

  it("closes no ticket and wakes no builder once a queued ticket's labels cannot be read", () => {
    const { calls, run } = closing({ ticket: "819", openPrs: [{ number: "976", ticket: "896", labelsUnreadable: true, refused: "GraphQL: This branch is out-of-date and cannot be updated because of merge conflicts." }] });

    expect(run().status).toBe(1);
    expect(marked(calls())).toEqual([]);
    expect(calls().some((call) => /^(issue\nclose|workflow\nrun)\n/.test(call))).toBe(false);
  });

  it("ends red naming the merged PR when its body cannot be read, instead of exiting green with the ticket open", () => {
    const { calls, run } = closing({ ticket: "819", mergedFrom: "collod873/land/some-work", prUnreadable: true });

    const { status, stderr } = run();

    expect(status).toBe(1);
    expect(stderr).toBe("close: the body of the merged PR #900 could not be read, so the ticket it built is left as it is\n");
    expect(calls().some((call) => call.startsWith("issue\nclose\n"))).toBe(false);
  });

  it("ends red naming the merged PR when its opening cannot be read, closing nothing", () => {
    const { calls, run } = closing({ ticket: "838", prUnreadable: true });

    const { status, stderr } = run();

    expect(status).toBe(1);
    expect(stderr).toBe("close: when PR #900 opened could not be read, so #838 is left as it is\n");
    expect(calls().some((call) => /^issue\n(comment|close)\n838\n/.test(call))).toBe(false);
  });
});

describe("bin/close stops at a mark GitHub refused, so it closes nothing whose labels lag (#1107)", () => {
  it("ends red at the closed mark, naming the stage, the label and the ticket, and closes and re-slices nothing after it", () => {
    const { calls, run } = closing({ ticket: "814", markRefusal: "mark: #814 not labelled --closed: HTTP 403: Resource not accessible by integration" });

    const { status, stderr } = run();

    expect(status).toBe(1);
    expect(stderr).toContain("close: bin/mark #814 --closed ended non-zero, so nothing after it is posted, closed, marked or hired\n");
    expect(calls().some((call) => /^(issue\nclose|workflow\nrun)\n/.test(call))).toBe(false);
  });
});

describe("bin/close, called from another repo's caller file, wakes builders through that file and lands on its check and its review (#1135)", () => {
  const calledFrom = "collod873/Lumaria/.github/workflows/machine.yml@refs/heads/main";
  const conflicted = { number: "909", ticket: "830", refused: "GraphQL: This branch is out-of-date and cannot be updated because of merge conflicts." };

  it("dispatches the caller file for a conflicted ticket, as the App", () => {
    const { calls, tokens, run } = closing({ ticket: "819", openPrs: [conflicted], calledFrom });

    expect(run().status).toBe(0);
    const wake = calls().find((call) => call.startsWith("workflow\nrun\nmachine.yml\n") && call.includes("ticket=830"));
    expect(wake).toContain("merge conflicts");
    expect(tokens()[calls().indexOf(wake ?? "")]).toBe("app");
  });

  it.each([calledFrom, "collod873/claude-workflow/.github/workflows/machine.yml@refs/heads/main", undefined])("closes the ticket and starts no re-slice, leaving it to the caller's own issues: closed, called from %s, or from no caller file as on a run by hand (#1220)", (called) => {
    const { calls, run } = closing({ ticket: "819", calledFrom: called });

    expect(run().status).toBe(0);
    expect(calls().some((call) => call.startsWith("issue\nclose\n819\n"))).toBe(true);
    expect(calls().some((call) => call.startsWith("workflow\nrun\n"))).toBe(false);
  });

  it.each([
    ["pending", false],
    ["green", true],
  ] as const)("brings a PR up to date only once the caller's own review is green as well as its check: %s (#1285)", (checks, updated) => {
    const { calls, run } = closing({ ticket: "819", afterCheck: true, openPrs: [{ number: "936", ticket: "856", checks }], calledFrom });

    expect(run().status).toBe(0);
    expect(calls().some((call) => call.startsWith("pr\nupdate-branch\n936"))).toBe(updated);
  });

  it("marks the ticket closed with the machine's bin/mark, from a caller's tree that holds no bin/ of its own", () => {
    const { session, calls, run } = closing({ ticket: "819", calledFrom, foreign: true });

    const result = run();

    expect(result.status, result.stderr).toBe(0);
    expect(existsSync(join(session, "bin"))).toBe(false);
    expect(calls().some((call) => call.startsWith("issue\nclose\n819\n"))).toBe(true);
    expect(calls().some((call) => call.includes("issues/819/labels") || call.startsWith("issue\nedit\n819\n"))).toBe(true);
  });

  it("still waits for the review here, where no caller is named", () => {
    const { calls, run } = closing({ ticket: "819", afterCheck: true, openPrs: [{ number: "936", ticket: "856", unreviewed: true }] });

    expect(run().status).toBe(0);
    expect(calls().some((call) => call.startsWith("pr\nupdate-branch\n936"))).toBe(false);
  });
});

describe("bin/close, called from a caller file in the machine's own repo, is home: it waits for the review but wakes builders through that file (#1215)", () => {
  const calledFrom = "collod873/claude-workflow/.github/workflows/machine.yml@refs/heads/main";

  it("waits for the review before bringing a PR up to date, as this repo's own workflows do", () => {
    const { calls, run } = closing({ ticket: "819", afterCheck: true, openPrs: [{ number: "936", ticket: "856", unreviewed: true }], calledFrom });

    expect(run().status).toBe(0);
    expect(calls().some((call) => call.startsWith("pr\nupdate-branch\n936"))).toBe(false);
  });

  it("dispatches the caller file it runs under for a conflicted ticket", () => {
    const { calls, run } = closing({ ticket: "819", openPrs: [{ number: "909", ticket: "830", refused: "GraphQL: This branch is out-of-date and cannot be updated because of merge conflicts." }], calledFrom });

    expect(run().status).toBe(0);
    expect(calls().some((call) => call.startsWith("workflow\nrun\nmachine.yml\n") && call.includes("ticket=830"))).toBe(true);
  });

});

describe("bin/close names the ticket in its hands when it stops red, so the run calls the owner on it and gets its one re-run (#1206)", () => {
  it("names a queued ticket whose mark stopped it, as #1202's landing mark did on 2026-10-07", () => {
    const { output, run } = closing({ ticket: "819", openPrs: [{ number: "938", ticket: "858", upToDate: true, labels: ["queued"] }], markRefusal: "mark: #858 not labelled landing: gh: Label does not exist (HTTP 404)" });

    expect(run().status).not.toBe(0);
    expect(output()).toBe("ticket=858\n");
  });

  it("names the merged ticket when its own close stops", () => {
    const { output, run } = closing({ ticket: "815", readable: false });

    expect(run().status).not.toBe(0);
    expect(output()).toBe("ticket=815\n");
  });

  it("ends red naming a green PR's ticket when its branch update failed and no other PR moved, as Lumaria#1010's did in the probe Wave (#1281)", () => {
    const { output, run } = closing({ ticket: "819", afterCheck: true, openPrs: [{ number: "939", ticket: "859", refused: "unknown command \"update-branch\" for \"gh pr\"" }] });

    const { status, stderr } = run();

    expect(status).toBe(1);
    expect(stderr).toContain("PR #939 could not be brought up to date with main");
    expect(output()).toBe("ticket=859\n");
  });

  it("names nothing on a run that ends green", () => {
    const { output, run } = closing({ ticket: "814" });

    expect(run().status).toBe(0);
    expect(output()).toBe("");
  });
});
