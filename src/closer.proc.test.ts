import { describe, expect, it } from "vitest";
import { closing } from "./scenarios.ts";

describe("bin/close closes a ticket once its PR merges, since the PR's review and bin/check already judged it (#931)", () => {
  it("closes the ticket as completed, naming in its closing record the PR that merged", () => {
    const { calls, run } = closing({ ticket: "812" });

    const result = run();

    expect(result.status).toBe(0);
    const commented = calls().find((call) => call.startsWith("issue\ncomment\n812\n"));
    expect(commented).toContain("#812 is done: PR #900 merged");
    expect(calls().some((call) => call.startsWith("issue\nclose\n812\n") && call.includes("completed"))).toBe(true);
    expect(calls().some((call) => call.startsWith("workflow\nrun\nfix.yml"))).toBe(false);
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

describe("bin/close ends a done ticket closed as completed with no stage label (#851)", () => {
  it("re-closes as completed and strips the stage label, even when the merge finds the ticket already closed as not planned", () => {
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
    const stripped = calls().find((call) => call.includes("--remove-label"));
    expect(stripped, "strips its stage label").toBeDefined();
    const args = (stripped ?? "").split("\n");
    expect(args[args.indexOf("--remove-label") + 1]).not.toBe("");
  });

  it("leaves closed as completed a done ticket the merge already closed, reopening nothing", () => {
    const { calls, run } = closing({ ticket: "818", closedAs: "COMPLETED" });

    expect(run().status).toBe(0);
    expect(calls().some((call) => call.startsWith("issue\nreopen\n818"))).toBe(false);
    expect(calls().some((call) => call.includes("--remove-label"))).toBe(true);
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
    const wake = calls().find((call) => call.startsWith("workflow\nrun\nfix.yml") && call.includes("ticket=822"));
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
    const unparked = closing({ ticket: "812", ticketBody: piece("812"), splitFrom: { parent: "811", labels: "fixing\n", said, siblings: { "813": "CLOSED COMPLETED" } } });

    const result = early.run();

    expect(result.status).toBe(0);
    expect(woken(early.calls())).toBe(-1);
    expect(result.stdout).toContain("#811 still waits for #813");
    expect(unparked.run().status).toBe(0);
    expect(woken(unparked.calls())).toBe(-1);
  });
});

describe("bin/close wakes the ticket's builder directly, instead of reopening it or leaving it a comment, when it cannot bring the ticket up to date (#957)", () => {
  const woken = (calls: string[], ticket: string) => calls.find((call) => call.startsWith("workflow\nrun\nfix.yml") && call.includes(`ticket=${ticket}`));

  it("wakes the ticket's builder instead of commenting, when its PR cannot be brought up to date by a merge", () => {
    const { calls, tokens, run } = closing({
      ticket: "819",
      openPrs: [{ number: "909", ticket: "830", refused: "GraphQL: This branch is out-of-date and cannot be updated because of merge conflicts." }],
    });

    const result = run();

    expect(result.status).toBe(0);
    const wake = woken(calls(), "830");
    expect(wake, "fires the trigger fix.yml starts on, naming the ticket").toBeDefined();
    expect(wake).toContain("merge conflicts");
    expect(tokens()[calls().indexOf(wake ?? "")], "runs as the App, so fix.yml actually starts").toBe("app");
    expect(calls().some((call) => call.startsWith("issue\nreopen\n830"))).toBe(false);
    expect(calls().some((call) => call.startsWith("issue\ncomment\n830\n"))).toBe(false);
    expect(calls().some((call) => call.startsWith("pr\ncomment\n909\n")), "leaves the failed branch update comment on the PR (#980)").toBe(true);
  });
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
    const wake = calls().find((call) => call.startsWith("workflow\nrun\nfix.yml") && call.includes("ticket=833"));
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

  it("closes with no counts when its PR's comments cannot be read", () => {
    const { calls, run } = closing({ ticket: "837", prCommentsUnreadable: true });

    const result = run();

    expect(result.status).toBe(0);
    const commented = calls().find((call) => call.startsWith("issue\ncomment\n837\n"));
    expect(commented).toBeDefined();
    expect(commented).toMatch(/failed branch update[^\n]*not available/i);
    expect(commented).toMatch(/re-review[^\n]*not available/i);
    expect(calls().some((call) => call.startsWith("issue\nclose\n837"))).toBe(true);
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
    expect(calls().some((call) => call.startsWith("workflow\nrun\nfix.yml") && call.includes("ticket=847"))).toBe(true);
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
    expect(calls().some((call) => call.startsWith("issue\n")), "a finished check is not a merge, so no ticket is closed").toBe(false);
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
