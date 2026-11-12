import { describe, expect, it } from "vitest";
import { FULL_CHECK_PASSED, RED_TEST_LINE, servingProduction, shipping } from "./ship.part.ts";

async function shippingApp() {
  const app = shipping();
  const production = await servingProduction(app.live);
  const ship = (...args: string[]) => app.runAsync(args, { SHIP_HEALTH_URL: production.healthUrl });
  const shipOnSchedule = () => app.runAsync(["--daily"], { SHIP_HEALTH_URL: production.healthUrl, GITHUB_EVENT_NAME: "schedule" });
  const shipWithoutWaiting = (...args: string[]) => app.runAsync(args, { SHIP_HEALTH_URL: production.healthUrl, SHIP_CHECK_DEADLINE_SECONDS: "0" });
  return { ...app, production, ship, shipWithoutWaiting, shipOnSchedule };
}

describe("bin/ship moves production by pushing a commit that passed the full check to the release branch, and holds when the check is red", () => {
  it("ships the newest green commit and waits for that commit's deploy", async () => {
    const { land, ship, release, waitedOn } = await shippingApp();
    land("older", FULL_CHECK_PASSED);
    const newest = land("newest", FULL_CHECK_PASSED);

    const shipped = await ship();

    expect(shipped.status, shipped.stderr).toBe(0);
    expect(release()).toBe(newest);
    expect(waitedOn()).toBe(newest);
    expect(shipped.stdout).toContain("older");
  });

  it("gives a tip with no full check of its own one, and ships when it passes", async () => {
    const { land, ship, release, fullCheckWillBe, dispatched } = await shippingApp();
    land("older", FULL_CHECK_PASSED);
    const tip = land("tip", null);
    fullCheckWillBe(tip, "success");

    expect((await ship()).status).toBe(0);
    expect(release()).toBe(tip);
    expect(dispatched()).toEqual([tip]);
  });

  it("ships a tip that already has a passing full check without another", async () => {
    const { land, ship, dispatched } = await shippingApp();
    land("tip", FULL_CHECK_PASSED);

    expect((await ship()).status).toBe(0);
    expect(dispatched()).toEqual([]);
  });

  it("holds the ship and files a bug naming the failing tests, the merges since production, and the owner when the full check on the tip is red", async () => {
    const { land, ship, release, live, issues, waitedOn } = await shippingApp();
    land("older", FULL_CHECK_PASSED);
    const tip = land("tip", null);

    const held = await ship("--daily");

    expect(held.status).toBe(1);
    expect(release()).toBe(live);
    expect(waitedOn()).toBeUndefined();
    const created = issues().find(([command]) => command === "create")?.join(" ");
    expect(created).toContain(`Ship held: the full check is red on ${tip.slice(0, 7)}`);
    expect(created).toContain(RED_TEST_LINE);
    expect(created).toContain("older");
    expect(created).toContain("tip");
    expect(created).toContain("@owner-login");
  });

  it("comments on the open held-ship issue instead of filing another", async () => {
    const { land, ship, issues, openIssue } = await shippingApp();
    land("tip", null);
    openIssue(2501);

    expect((await ship("--daily")).status).toBe(1);
    expect(issues().some(([command]) => command === "create")).toBe(false);
    expect(issues().find(([command]) => command === "comment")).toContain("2501");
  });

  it("refuses when the full check is red, and production stays put", async () => {
    const { land, ship, release, live, waitedOn } = await shippingApp();
    land("red", null);

    const shipped = await ship();

    expect(shipped.status).toBe(1);
    expect(release()).toBe(live);
    expect(waitedOn()).toBeUndefined();
  });

  it("says so and moves nothing when production already runs main", async () => {
    const { ship, release, live, waitedOn } = await shippingApp();

    const shipped = await ship();

    expect(shipped.status).toBe(0);
    expect(shipped.stdout).toContain("Nothing to ship");
    expect(release()).toBe(live);
    expect(waitedOn()).toBeUndefined();
  });
});

describe("bin/ship --daily waits for production's /api/health to report the release commit, and files an issue when it never does", () => {
  it("passes once production reports the shipped build", async () => {
    const { land, ship, release, production, issues } = await shippingApp();
    const green = land("green", FULL_CHECK_PASSED);
    production.build = green;

    const shipped = await ship("--daily");

    expect(shipped.status).toBe(0);
    expect(release()).toBe(green);
    expect(issues()).toEqual([]);
  });

  it("fails and files an issue when production never reports the shipped build", async () => {
    const { land, ship, release, live, issues } = await shippingApp();
    const green = land("green", FULL_CHECK_PASSED);

    const shipped = await ship("--daily");

    expect(shipped.status).toBe(1);
    expect(release()).toBe(green);
    const created = issues().find(([command]) => command === "create");
    expect(created).toContain(`Production deploy of ${green.slice(0, 7)} failed`);
    expect(created?.join(" ")).toContain(live.slice(0, 7));
    expect(created?.join(" ")).toContain("@owner-login");
  });

  it("still fails with nothing to ship when production is behind release", async () => {
    const { land, ship, live, production, issues } = await shippingApp();
    const green = land("green", FULL_CHECK_PASSED);
    production.build = green;
    expect((await ship("--daily")).status).toBe(0);
    production.build = live;

    const stale = await ship("--daily");

    expect(stale.status).toBe(1);
    expect(issues().find(([command]) => command === "create")).toContain(`Production deploy of ${green.slice(0, 7)} failed`);
  });

  it("comments on the open deploy issue instead of filing another", async () => {
    const { land, ship, issues, openIssue } = await shippingApp();
    land("green", FULL_CHECK_PASSED);
    openIssue(2495);

    expect((await ship("--daily")).status).toBe(1);
    expect(issues().some(([command]) => command === "create")).toBe(false);
    expect(issues().find(([command]) => command === "comment")).toContain("2495");
  });
});

describe("bin/ship rolls production back with --to and leaves it there until someone ships forward by hand", () => {
  it("leaves a rollback alone in the daily run until a hand ship goes forward", async () => {
    const { land, ship, release, live, production } = await shippingApp();
    land("bad", FULL_CHECK_PASSED);
    expect((await ship()).status).toBe(0);
    expect((await ship("--to", live)).status).toBe(0);

    const held = await ship("--daily");
    expect(held.status).toBe(0);
    expect(held.stdout).toContain("rolled back");
    expect(release()).toBe(live);

    const fixed = land("fixed", FULL_CHECK_PASSED);
    expect((await ship("--daily")).status).toBe(0);
    expect(release()).toBe(live);

    expect((await ship()).status).toBe(0);
    expect(release()).toBe(fixed);

    const later = land("later", FULL_CHECK_PASSED);
    production.build = later;
    expect((await ship("--daily")).status).toBe(0);
    expect(release()).toBe(later);
  });

  it("rolls back with --to and names the migrations that stay applied", async () => {
    const { land, ship, release, live } = await shippingApp();
    land("schema", FULL_CHECK_PASSED, "src/server/db/migrations/0300_new_column.sql");
    expect((await ship()).status).toBe(0);

    const rolledBack = await ship("--to", live);

    expect(rolledBack.status).toBe(0);
    expect(release()).toBe(live);
    expect(rolledBack.stdout).toContain("0300_new_column.sql");
  });

  it("refuses a forward --to commit that is not green", async () => {
    const { land, ship, release, live } = await shippingApp();
    const red = land("red", null);

    expect((await ship("--to", red)).status).toBe(1);
    expect(release()).toBe(live);
  });

  it("refuses a --to commit that is not on main", async () => {
    const { ship, release, live } = await shippingApp();

    expect((await ship("--to", "does-not-exist")).status).toBe(1);
    expect(release()).toBe(live);
  });
});

describe("bin/ship counts a hand-run full check, so machine-merged work can reach production", () => {
  it("ships a machine-merged commit whose push CI was skipped once CI rerun by hand passes", async () => {
    const { land, ship, release } = await shippingApp();
    land("green", FULL_CHECK_PASSED);
    const rerun = land("machine-merged", [
      { event: "push", conclusion: "skipped" },
      { event: "workflow_dispatch", conclusion: "success" },
    ]);

    expect((await ship()).status).toBe(0);
    expect(release()).toBe(rerun);
  });

  it("gives a commit whose only CI run was skipped a full check before it ships", async () => {
    const { land, ship, release, fullCheckWillBe, dispatched } = await shippingApp();
    const merged = land("machine-merged", [{ event: "push", conclusion: "skipped" }]);
    fullCheckWillBe(merged, "success");

    expect((await ship()).status).toBe(0);
    expect(release()).toBe(merged);
    expect(dispatched()).toEqual([merged]);
  });
});

describe("bin/ship takes only a full check started by ship's own dispatch as the pass that moves production", () => {
  it.each(["push", "pull_request"] as const)("does not take a green %s run for it: a dispatch is started before anything moves", async (event) => {
    const { land, ship, release, fullCheckWillBe, dispatched } = await shippingApp();
    const tip = land("tip", [{ event, conclusion: "success" }]);
    fullCheckWillBe(tip, "success");

    expect((await ship()).status).toBe(0);
    expect(dispatched()).toEqual([tip]);
    expect(release()).toBe(tip);
  });

  it("holds the ship when a pull request run is green but the dispatch is red", async () => {
    const { land, ship, release, live, dispatched } = await shippingApp();
    const tip = land("tip", [{ event: "pull_request", conclusion: "success" }]);

    expect((await ship()).status).toBe(1);
    expect(dispatched()).toEqual([tip]);
    expect(release()).toBe(live);
  });

  it("refuses a commit that is not main's head when it has no full check, rather than waiting out the deadline on a dispatch that cannot cover it", async () => {
    const { land, shipWithoutWaiting, release, live, dispatched, waitedOn } = await shippingApp();
    const older = land("older", null);
    const head = land("head", FULL_CHECK_PASSED);

    const refused = await shipWithoutWaiting("--to", older);

    expect(refused.status).toBe(1);
    expect(refused.stderr).toContain(`${older.slice(0, 7)} is not main's head (${head.slice(0, 7)})`);
    expect(dispatched()).toEqual([]);
    expect(release()).toBe(live);
    expect(waitedOn()).toBeUndefined();
  });

  it("still ships a commit behind main's head when its own full check has passed", async () => {
    const { land, ship, release, dispatched } = await shippingApp();
    const behind = land("behind", FULL_CHECK_PASSED);
    land("head", null);

    expect((await ship("--to", behind)).status).toBe(0);
    expect(release()).toBe(behind);
    expect(dispatched()).toEqual([]);
  });

  it("holds nothing and files no bug when the full check ends cancelled, since another CI run took its place", async () => {
    const { land, ship, release, live, fullCheckWillBe, issues } = await shippingApp();
    const tip = land("tip", null);
    fullCheckWillBe(tip, "cancelled");

    const shipped = await ship("--daily");

    expect(shipped.status).toBe(1);
    expect(shipped.stderr).toContain("cancelled");
    expect(shipped.stderr).not.toContain("Ship held");
    expect(issues()).toEqual([]);
    expect(release()).toBe(live);
  });
});

describe("bin/ship --daily files an issue when the full check is still waiting in the check queue at its deadline, as it does for a failed deploy", () => {
  it("files one naming the commit, production's build, the owner and the run, and holds production", async () => {
    const { land, shipWithoutWaiting, release, live, fullCheckWillBe, issues } = await shippingApp();
    const tip = land("tip", null);
    fullCheckWillBe(tip, null);

    const held = await shipWithoutWaiting("--daily");

    expect(held.status).toBe(1);
    expect(held.stderr).toContain(`Ship held: the full check did not finish on ${tip.slice(0, 7)}`);
    expect(held.stderr).toContain("Filed:");
    const created = issues().find(([command]) => command === "create")?.join(" ");
    expect(created).toContain("did not finish in 0 minutes");
    expect(created).toContain(live.slice(0, 7));
    expect(created).toContain("@owner-login");
    expect(created).toContain("a hand run of ship --daily");
    expect(release()).toBe(live);
  });

  it("comments on the open issue the next day's run would otherwise duplicate", async () => {
    const { land, shipWithoutWaiting, fullCheckWillBe, issues, openIssue } = await shippingApp();
    const tip = land("tip", null);
    fullCheckWillBe(tip, null);
    openIssue(2600);

    expect((await shipWithoutWaiting("--daily")).status).toBe(1);
    expect(issues().some(([command]) => command === "create")).toBe(false);
    expect(issues().find(([command]) => command === "comment")).toContain("2600");
  });

  it("only says so when a person ran it by hand, and files nothing", async () => {
    const { land, shipWithoutWaiting, fullCheckWillBe, issues } = await shippingApp();
    const tip = land("tip", null);
    fullCheckWillBe(tip, null);

    const held = await shipWithoutWaiting();

    expect(held.status).toBe(1);
    expect(held.stderr).toContain(`the full check for ${tip.slice(0, 7)} did not finish`);
    expect(issues()).toEqual([]);
  });
});

describe("bin/ship runs from whichever app is the current directory, with that app's health URL and service from its caller", () => {
  it("polls the health URL it was given and, when the deploy never shows, names that URL and the service in the issue", async () => {
    const { land, runAsync, production, issues } = await shippingApp();
    land("green", FULL_CHECK_PASSED);

    const failed = await runAsync(["--daily"], { SHIP_HEALTH_URL: production.healthUrl, SHIP_SERVICE: "worker" });

    expect(failed.status).toBe(1);
    expect(production.requested).toEqual(["/api/health"]);
    const created = issues().find(([command]) => command === "create")?.join(" ");
    expect(created).toContain(`${production.healthUrl} still reports`);
    expect(created).toContain("Railway's deploy log for worker says why");
    expect(created).not.toContain("mezzanine");
  });

  it("names the web service when the caller names none", async () => {
    const { land, ship, issues } = await shippingApp();
    land("green", FULL_CHECK_PASSED);

    expect((await ship("--daily")).status).toBe(1);
    expect(issues().find(([command]) => command === "create")?.join(" ")).toContain("Railway's deploy log for web says why");
  });

  it("refuses a daily run that has no health URL, rather than polling some other app's", () => {
    const { land, run, release, live, dispatched, issues } = shipping();
    land("green", FULL_CHECK_PASSED);

    const refused = run(["--daily"]);

    expect(refused.status).toBe(1);
    expect(refused.stderr).toContain("SHIP_HEALTH_URL");
    expect(release()).toBe(live);
    expect(dispatched()).toEqual([]);
    expect(issues()).toEqual([]);
  });
});

describe("bin/ship --daily on GitHub's schedule is the backstop for the PC's ship clock, since GitHub fires a schedule hours late", () => {
  const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();

  it("ships nothing once a dispatched Ship ran in the last 20 hours, so a late schedule moves no production mid-day", async () => {
    const { land, shipOnSchedule, release, live, shipDispatchedAt } = await shippingApp();
    land("tip", FULL_CHECK_PASSED);
    shipDispatchedAt(hoursAgo(9));

    const skipped = await shipOnSchedule();

    expect(skipped.status, skipped.stderr).toBe(0);
    expect(skipped.stdout).toContain("already ran");
    expect(release()).toBe(live);
  });

  it("still ships when the newest dispatched Ship is older than 20 hours, as when the PC was off at its time", async () => {
    const { land, shipOnSchedule, release, production, shipDispatchedAt } = await shippingApp();
    const tip = land("tip", FULL_CHECK_PASSED);
    production.build = tip;
    shipDispatchedAt(hoursAgo(25));

    const shipped = await shipOnSchedule();

    expect(shipped.status, shipped.stderr).toBe(0);
    expect(release()).toBe(tip);
  });
});
