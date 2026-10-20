import { existsSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { waitsOnFault } from "./builder.ts";
import { CLOSE_RUN, closing, type FaultOrigin } from "./closer.part.ts";
import { type CheckRun, checksOf } from "./closer.ts";
import { faultOf } from "./post.ts";
import { git, holds, workflowJobs } from "./scenarios.ts";
import { HELD, PAUSED, STUCK } from "./spelled.ts";

const REPO = join(import.meta.dirname, "..");

const machineOn = () => (parse(readFileSync(join(REPO, ".github", "workflows", "machine.yml"), "utf8")) as { on: Record<string, { workflows?: string[]; types?: string[] }> }).on;

function closeJob() {
  const close = workflowJobs("tickets.yml").close;
  if (close === undefined) throw new Error("no close job in tickets.yml");
  const queueOnly = String(close.steps.find((ran) => (ran.run ?? "").includes("bin/close"))?.env?.QUEUE_ONLY ?? "");
  return { closes: (event: Parameters<typeof holds>[1]) => holds(close.if ?? "true", event), queues: (event: Parameters<typeof holds>[1]) => holds(queueOnly, event) };
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

describe("bin/close brings ticket PRs left behind by a merge up to date itself, judges the result with the full check and posts that as the new head's check status, so no Actions check has to start (#858, #1345)", () => {
  it("merges main into the PR's branch, runs the full check on the tree, pushes the merge and posts check green for its head, as the App", () => {
    const { calls, tokens, heads, branchHead, parentsOf, checked, session, run } = closing({ ticket: "819", openPrs: [{ number: "901", ticket: "820" }] });

    const result = run();

    expect(result.status, result.stderr).toBe(0);
    const head = branchHead("ticket/820");
    expect(parentsOf(head), "the new head is the old head merged with main").toEqual([heads[0], git(session, "rev-parse", "origin/main")]);
    expect(checked()).toEqual([`${realpathSync(session)} --full --publish`]);
    const posted = calls().findIndex((call) => call.startsWith(`api\n-X\nPOST\nrepos/{owner}/{repo}/statuses/${head}\n`));
    expect(posted, "the check is posted for the exact head it judged").toBeGreaterThanOrEqual(0);
    expect(calls()[posted]).toContain("state=success");
    expect(calls()[posted]).toContain("context=check");
    expect(tokens()[posted]).toBe("app");
    expect(calls().some((call) => call.startsWith("pr\nupdate-branch\n"))).toBe(false);
  });

  it("pushes the merge with a red check status, says so on the ticket and wakes its builder, so a PR main broke carries no green check and does not merge", () => {
    const { calls, tokens, branchHead, heads, run } = closing({ ticket: "819", check: "red", openPrs: [{ number: "902", ticket: "821", labels: ["queued"] }] });

    const result = run();

    expect(result.status, result.stderr).toBe(0);
    const head = branchHead("ticket/821");
    expect(head).not.toBe(heads[0]);
    expect(calls().find((call) => call.startsWith(`api\n-X\nPOST\nrepos/{owner}/{repo}/statuses/${head}\n`))).toContain("state=failure");
    const told = calls().find((call) => call.startsWith("issue\ncomment\n821\n"));
    expect(told).toContain("carries no green check and does not merge: check: red test src/stops.test.ts:4");
    const wake = calls().findIndex((call) => call.startsWith("workflow\nrun\nmachine.yml") && call.includes("ticket=821"));
    expect(calls()[wake]).toContain("check: red test src/stops.test.ts:4");
    expect(tokens()[wake]).toBe("app");
    expect(calls().some((call) => call.startsWith("api\n-X\nPOST\nrepos/{owner}/{repo}/issues/821/labels\n") && call.includes("labels[]=resolving"))).toBe(true);
  });

  it("ends red naming the ticket when the status it judged cannot be posted after the push, since a head with no status never merges", () => {
    const { output, run } = closing({ ticket: "819", afterCheck: true, statusRefused: true, openPrs: [{ number: "904", ticket: "823" }] });

    const { status, stderr } = run();

    expect(status).toBe(1);
    expect(stderr).toContain("PR #904 could not be brought up to date with main");
    expect(stderr).toContain("HTTP 502");
    expect(output()).toBe("ticket=823\n");
  });
});

describe("bin/close queues ticket PRs alone, since a session landing merges at once on its own statuses and never waits behind main (#869, #1344)", () => {
  it("leaves alone a land PR and a PR from a branch the machine did not open", () => {
    const { calls, run } = closing({ ticket: "819", openPrs: [{ number: "905", ticket: "", branch: "land/ba9876543210" }, { number: "906", ticket: "", branch: "dependabot/npm_and_yarn/vitest-5.0.0" }] });

    expect(run().status).toBe(0);
    expect(calls().some((call) => call.includes("\n905") || call.includes("\n906"))).toBe(false);
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
    const { closes, queues } = closeJob();

    expect(closes({ event: "issues", action: "closed" })).toBe(true);
    expect(closes({ event: "issues", action: "opened" })).toBe(false);
    expect(queues({ event: "issues", action: "closed" })).toBe(true);
    expect(queues({ event: "push" })).toBe(false);
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
    const { closes, queues } = closeJob();
    const unreviewed = { needs: { review: { result: "skipped" } } };

    expect(closes({ event: "pull_request_target", action: "closed", ...unreviewed })).toBe(true);
    expect(closes({ event: "pull_request_target", action: "opened", ...unreviewed })).toBe(false);
    expect(queues({ event: "pull_request_target", action: "closed" })).toBe(true);
  });
});

describe("bin/close wakes the ticket's builder directly, instead of reopening it or leaving it a comment, when it cannot bring the ticket up to date (#957)", () => {
  const woken = (calls: string[], ticket: string) => calls.find((call) => call.startsWith("workflow\nrun\nmachine.yml") && call.includes(`ticket=${ticket}`));

  it("wakes the ticket's builder instead of commenting, when its PR cannot be brought up to date by a merge, and names on the PR the update it could not make, its head and the Close run (#980, #1015)", () => {
    const { calls, tokens, run } = closing({
      ticket: "819",
      openPrs: [{ number: "909", ticket: "830", conflicts: true }],
    });

    const result = run();

    expect(result.status).toBe(0);
    const wake = woken(calls(), "830");
    expect(wake, "dispatches the caller file, naming the ticket").toBeDefined();
    expect(wake).toContain("909");
    expect(wake).toContain("Merge conflict in src/clash.ts");
    expect(tokens()[calls().indexOf(wake ?? "")], "runs as the App, so the caller file actually starts").toBe("app");
    expect(calls().some((call) => call.startsWith("issue\nreopen\n830"))).toBe(false);
    expect(calls().some((call) => call.startsWith("issue\ncomment\n830\n"))).toBe(false);
    const commented = calls().find((call) => call.startsWith("pr\ncomment\n909\n"));
    expect(commented, "leaves the same comment a non-ticket PR gets").toBeDefined();
    expect(commented).toContain("PR #909 could not be brought up to date with main");
    expect(commented).toContain("Merge conflict in src/clash.ts");
    expect(commented, "names the head, so a later run knows it was already reported").toMatch(/Head: `[0-9a-f]{40}`/);
    expect(commented).toContain(CLOSE_RUN);
  });
});

describe("bin/close wakes no builder for a conflict on a ticket the owner was called for (#1058)", () => {
  for (const held of HELD) {
    it(`leaves the failed branch update on the PR but starts no builder and marks nothing when the ticket carries ${held} (#1166)`, () => {
      const { calls, run } = closing({
        ticket: "819",
        openPrs: [{ number: "912", ticket: "834", held, conflicts: true }],
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

const updated = (calls: string[]) => calls.filter((call) => call.startsWith("pr\ncomment\n") && call.includes("brought up to date with main by")).map((call) => call.split("\n")[2]);

describe("bin/close merges machine PRs one at a time, bringing only the oldest green one up to date, judged from git (#1011)", () => {

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
        { number: "927", ticket: "847", conflicts: true },
        { number: "928", ticket: "848" },
        { number: "929", ticket: "849" },
      ],
    });

    expect(run().status).toBe(0);
    expect(updated(calls())).toEqual(["928"]);
    expect(calls().some((call) => call.startsWith("workflow\nrun\nmachine.yml") && call.includes("ticket=847"))).toBe(true);
  });

  it("wakes no builder again for a conflict it already reported at the PR's head, and brings the next green PR up to date", () => {
    const { calls, run } = closing({
      ticket: "819",
      openPrs: [
        { number: "935", ticket: "855", conflicts: true, refusedBefore: true },
        { number: "936", ticket: "856" },
      ],
    });

    expect(run().status).toBe(0);
    expect(updated(calls())).toEqual(["936"]);
    expect(calls().some((call) => call.startsWith("workflow\nrun\nmachine.yml"))).toBe(false);
    expect(calls().some((call) => call.startsWith("pr\ncomment\n935\n"))).toBe(false);
  });

  it("tries again a PR whose push failed at its head for a passing reason, not a conflict, and wakes no builder for it (#1014)", () => {
    const { calls, pushes, run } = closing({
      ticket: "819",
      openPrs: [
        { number: "938", ticket: "858", refused: "Post \"https://api.github.com/graphql\": dial tcp: i/o timeout", refusedBefore: true },
        { number: "939", ticket: "859" },
      ],
    });

    expect(run().status).toBe(0);
    expect(pushes(), "the push is tried at the head whose earlier failure was reported, then the next PR's").toEqual(["refs/heads/ticket/858", "refs/heads/ticket/859"]);
    expect(updated(calls())).toEqual(["939"]);
    expect(calls().some((call) => call.startsWith("workflow\nrun\nmachine.yml")), "a builder cannot fix a network error").toBe(false);
    expect(calls().some((call) => call.startsWith("pr\ncomment\n938\n")), "leaves no comment to pile up or count as a failed branch update").toBe(false);
  });

  it("judges a conflict from git, whatever GitHub's wording, so it wakes the builder and is skipped at its head after (#1014)", () => {
    const first = closing({ ticket: "819", openPrs: [{ number: "940", ticket: "860", conflicts: true }] });
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

describe("bin/close reads a required check as GitHub rules on it: a commit status counts, a check run of the same name still pending holds the PR, and either red is red (#1345)", () => {
  const status = (state: string): CheckRun => ({ context: "check", state });
  const run = (name: string, status: string, conclusion = ""): CheckRun => ({ name, status, conclusion });
  const reviewed = run("review", "COMPLETED", "SUCCESS");

  it("takes a green status as the check, holds while a same-named check run is still in progress, and reads a red status or run as red", () => {
    expect(checksOf([status("SUCCESS"), reviewed])).toBe("green");
    expect(checksOf([status("SUCCESS"), run("check", "IN_PROGRESS"), reviewed])).toBe("pending");
    expect(checksOf([status("PENDING"), reviewed])).toBe("pending");
    expect(checksOf([status("FAILURE"), reviewed])).toBe("red");
    expect(checksOf([status("SUCCESS"), run("check", "COMPLETED", "FAILURE"), reviewed])).toBe("red");
    expect(checksOf([reviewed])).toBe("pending");
    expect(checksOf([status("SUCCESS")])).toBe("pending");
  });

  it("merges a PR up to date with main on its builder's check status and a green review, and waits while an Actions check run of the same name has not ended", () => {
    const merging = closing({ ticket: "819", afterCheck: true, openPrs: [{ number: "981", ticket: "901", upToDate: true }] });
    const held = closing({ ticket: "819", afterCheck: true, openPrs: [{ number: "982", ticket: "902", upToDate: true, checkRun: "IN_PROGRESS" }] });

    expect(merging.run().stdout).toContain("PR #981 merged");
    expect(held.run().stdout).toContain("PR #982 is up to date with main, so the queue waits for it");
  });
});

describe("a finished Check run moves the queue on, and a red one wakes its builder, so a red PR never holds the queue (#1011)", () => {
  it("runs the closer's queue, closing no ticket, whenever a Check run completes, red or green", () => {
    const { closes, queues } = closeJob();

    expect(machineOn().workflow_run?.workflows).toContain("Check");
    for (const conclusion of ["success", "failure"]) {
      expect(closes({ event: "workflow_run", conclusion })).toBe(true);
      expect(queues({ event: "workflow_run", conclusion })).toBe(true);
    }
    expect(closes({ event: "workflow_run", conclusion: "success", own: true }), "its own completion runs no queue again").toBe(false);
  });

  it("wakes the builder of a ticket whose Check run goes red, which is how a PR that fails after its update leaves the line", () => {
    const { which, fix } = workflowJobs("tickets.yml");
    if (which === undefined || fix === undefined) throw new Error("no which or fix job in tickets.yml");
    const skipped = { build: { result: "skipped" }, review: { result: "skipped" } };
    const woken = (conclusion: string, fork = false) => holds(which.if ?? "true", { event: "workflow_run", conclusion, needs: skipped, fork });

    expect(woken("failure")).toBe(true);
    expect(woken("timed_out")).toBe(true);
    expect(woken("success")).toBe(false);
    expect(woken("failure", true), "a fork's run wakes nothing here").toBe(false);
    expect(fix.needs).toBe("which");
    expect(holds(fix.if ?? "true", { needs: { which: { result: "success", outputs: { ticket: "822" } } } })).toBe(true);
    expect(holds(fix.if ?? "true", { needs: { which: { result: "success", outputs: { ticket: "" } } } })).toBe(false);
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

});

describe("bin/close marks what the queue does to each ticket, so waiting its turn, being landed and having a conflict resolved read apart (#1063)", () => {
  const labelled = (calls: string[], ticket: string) => calls.flatMap((call, at) => (call.startsWith(`api\n-X\nPOST\nrepos/{owner}/{repo}/issues/${ticket}/labels\n`) ? [{ at, labels: call.split("\n").filter((line) => line.startsWith("labels[]=")) }] : []));
  const touched = (calls: string[], ticket: string) => calls.filter((call) => call.includes(`repos/{owner}/{repo}/issues/${ticket}/labels`));

  it("marks a ticket resolving before it wakes its builder for a conflict, and adds no try", () => {
    const { calls, tokens, run } = closing({ ticket: "819", openPrs: [{ number: "950", ticket: "870", labels: ["queued", "try-2"], conflicts: true }] });

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
        { number: "958", ticket: "878", conflicts: true, refusedBefore: true, labels: ["resolving"] },
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
        { number: "971", ticket: "891", conflicts: true, refusedBefore: true, labels: ["resolving"] },
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
    expect(updated(calls())).toEqual(["974"]);
    expect(touched(calls(), "894")).toEqual([]);
  });
});

describe("bin/close writes each mark on the ticket's open PR too, and says in its log when a mark fails (#1077)", () => {
  it("passes on bin/mark's refusal in its log, and still brings the PR up to date", () => {
    const { calls, run } = closing({ ticket: "823", afterCheck: true, openPrs: [{ number: "973", ticket: "893", labels: ["queued"] }], prLookupRefused: "HTTP 403: Resource not accessible by integration" });

    const { status, stderr } = run();

    expect(status).toBe(0);
    expect(stderr).toBe("mark: #893's open PR not labelled landing: HTTP 403: Resource not accessible by integration\n");
    expect(updated(calls())).toEqual(["973"]);
  });
});

describe("bin/close stops red at the first read it cannot make, and marks nothing after it (#1099)", () => {
  const marked = (calls: string[]) => calls.filter((call) => /^api\n-X\n(POST|DELETE)\nrepos\/\{owner\}\/\{repo\}\/issues\//.test(call));

  it("leaves stuck on a ticket whose labels cannot be read, naming the label read and the ticket", () => {
    const { calls, run } = closing({ ticket: "819", afterCheck: true, openPrs: [{ number: "975", ticket: "895", held: STUCK, labelsUnreadable: true }] });

    const { status, stderr } = run();

    expect(status).toBe(1);
    expect(stderr).toBe("close: the labels of #895 could not be read, so nothing is marked\n");
    expect(marked(calls())).toEqual([]);
  });

  it("closes no ticket and wakes no builder once a queued ticket's labels cannot be read", () => {
    const { calls, run } = closing({ ticket: "819", openPrs: [{ number: "976", ticket: "896", labelsUnreadable: true, conflicts: true }] });

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
  const calledFrom = "collod873/Lumaria/.github/workflows/robot.yml@refs/heads/main";
  const conflicted = { number: "909", ticket: "830", conflicts: true };

  it("dispatches the caller file for a conflicted ticket, as the App", () => {
    const { calls, tokens, run } = closing({ ticket: "819", openPrs: [conflicted], calledFrom });

    expect(run().status).toBe(0);
    const wake = calls().find((call) => call.startsWith("workflow\nrun\nrobot.yml\n") && call.includes("ticket=830"));
    expect(wake).toContain("Merge conflict in src/clash.ts");
    expect(tokens()[calls().indexOf(wake ?? "")]).toBe("app");
  });

  it("closes the ticket and starts no re-slice, leaving it to the caller's own issues: closed (#1220)", () => {
    const { calls, run } = closing({ ticket: "819", calledFrom });

    expect(run().status).toBe(0);
    expect(calls().some((call) => call.startsWith("issue\nclose\n819\n"))).toBe(true);
    expect(calls().some((call) => call.startsWith("workflow\nrun\n"))).toBe(false);
  });

  it.each([
    ["pending", false],
    ["green", true],
  ] as const)("brings a PR up to date only once the caller's own review is green as well as its check: %s (#1285)", (checks, moved) => {
    const { calls, run } = closing({ ticket: "819", afterCheck: true, openPrs: [{ number: "936", ticket: "856", checks }], calledFrom });

    expect(run().status).toBe(0);
    expect(updated(calls())).toEqual(moved ? ["936"] : []);
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
    expect(updated(calls())).toEqual([]);
  });
});

describe("bin/close, called from a caller file in the machine's own repo, is home: it waits for the review but wakes builders through that file (#1215)", () => {
  const calledFrom = "collod873/claude-workflow/.github/workflows/home.yml@refs/heads/main";

  it("waits for the review before bringing a PR up to date, as this repo's own workflows do", () => {
    const { calls, run } = closing({ ticket: "819", afterCheck: true, openPrs: [{ number: "936", ticket: "856", unreviewed: true }], calledFrom });

    expect(run().status).toBe(0);
    expect(updated(calls())).toEqual([]);
  });

  it("dispatches the caller file it runs under for a conflicted ticket", () => {
    const { calls, run } = closing({ ticket: "819", openPrs: [{ number: "909", ticket: "830", conflicts: true }], calledFrom });

    expect(run().status).toBe(0);
    expect(calls().some((call) => call.startsWith("workflow\nrun\nhome.yml\n") && call.includes("ticket=830"))).toBe(true);
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

describe("bin/close wakes a foreign ticket waiting on a machine fault its builder filed, once every fault it filed has closed, since ADR-0005 leaves nothing waiting on the owner", () => {
  const fault = (filed: string) => `https://github.com/collod873/claude-workflow/issues/${filed}`;
  const parked = `${waitsOnFault("1015", [fault("812"), fault("813")])} its stage hooks were missing`;
  const faultBody = ["## Why", "", faultOf("collod873/Lumaria#1015"), "", "> The stage hooks were missing.", "", "## Done when", "", "- They are there.", ""].join("\n");
  const origin = (filed: Record<string, string>): FaultOrigin => ({ repo: "collod873/Lumaria", ticket: "1015", labels: ["ticket", "waiting"], said: [parked], filed });
  const woken = (calls: string[]) => calls.findIndex((call) => call.trimEnd() === "issue\nedit\n1015\n--remove-label\nwaiting");
  const told = (calls: string[]) => calls.findIndex((call) => call.startsWith("issue\ncomment\n1015\n"));

  it("wakes it in its own repo when the last fault merges, telling it how each fault ended first, and leaves it waiting while another is open", () => {
    const last = closing({ ticket: "812", ticketBody: faultBody, faultOrigin: origin({ "813": "CLOSED NOT_PLANNED" }) });
    const early = closing({ ticket: "812", ticketBody: faultBody, faultOrigin: origin({ "813": "OPEN " }) });

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
    const { run, calls } = closing({ ticket: "812", ticketBody: faultBody, closedIssue: "813", faultOrigin: origin({ "812": "CLOSED COMPLETED", "813": "CLOSED NOT_PLANNED" }) });

    const result = run();

    expect(result.status, result.stderr).toBe(0);
    expect(woken(calls())).toBeGreaterThanOrEqual(0);
    expect(calls()[told(calls())]).toContain("#812 merged, #813 closed unbuilt");
  });
});

describe("bin/close moves the row a merged ticket names on main, so no ticket's PR edits docs/buckets.md (#1382)", () => {
  const BUCKETS = ["# Buckets", "", "| Bucket | Evidence | Prevention | State |", "|---|---|---|---|", "| Parallel work conflicts on one file | three PRs went `DIRTY` | one writer | ruled by Collin 2026-10-20 |", "| Another row | its evidence | its prevention | unruled |", ""].join("\n");
  const naming = (row: string) => ["## Why", "", `Row: "${row}" (ruled by Collin 2026-10-20).`, "", '> "one writer for docs/buckets.md"', "", "## Done when", "", "- It lands.", ""].join("\n");

  it("lands main plus that row's state moved, docs/buckets.md alone, judged and merged at once like a session landing", () => {
    const { calls, landed, session, run } = closing({ ticket: "812", buckets: BUCKETS, ticketBody: naming("Parallel work conflicts on one file") });

    const result = run();

    expect(result.status).toBe(0);
    const [land, ...more] = landed();
    expect(more).toEqual([]);
    expect(land?.parents).toEqual([git(session, "rev-parse", "origin/main")]);
    expect(land?.changed).toBe("docs/buckets.md");
    expect(land?.buckets).toBe(BUCKETS.replace("| ruled by Collin 2026-10-20 |", "| ruled by Collin 2026-10-20; built in #812 (PR #900), unmeasured |").trimEnd());
    const head = land?.head ?? "";
    const posted = calls().filter((call) => call.includes(`statuses/${head}`)).map((call) => call.split("\n").find((arg) => arg.startsWith("context=")));
    expect(posted.sort()).toEqual(["context=check", "context=review"]);
    expect(result.stdout).toContain('; moved the row "Parallel work conflicts on one file"');
  });

  it("moves no row for a ticket that names none, or one the table lacks, and says which", () => {
    const unnamed = closing({ ticket: "812", buckets: BUCKETS });
    expect(unnamed.run().status).toBe(0);
    expect(unnamed.landed()).toEqual([]);

    const missing = closing({ ticket: "812", buckets: BUCKETS, ticketBody: naming("No such row") });
    const result = missing.run();
    expect(result.status).toBe(0);
    expect(missing.landed()).toEqual([]);
    expect(result.stdout).toContain('; #812 names the row "No such row", which docs/buckets.md on main lacks, so no row moved');
  });

  it("moves no row a second time when the closer runs again on a ticket it already moved", () => {
    const moved = BUCKETS.replace("| ruled by Collin 2026-10-20 |", "| ruled by Collin 2026-10-20; built in #812 (PR #900), unmeasured |");
    const { landed, calls, run } = closing({ ticket: "812", buckets: moved, ticketBody: naming("Parallel work conflicts on one file") });

    const result = run();

    expect(result.status).toBe(0);
    expect(landed()).toEqual([]);
    expect(calls().some((call) => call.startsWith("pr\ncreate\n"))).toBe(false);
    expect(result.stdout).toContain('; #812 names the row "Parallel work conflicts on one file", which already says #812 built it');
  });

  it("lands the move from a fresh main when its first merge is refused, leaving no refused branch behind", () => {
    const { landed, run } = closing({ ticket: "812", buckets: BUCKETS, ticketBody: naming("Parallel work conflicts on one file"), rowMergesRefused: 1 });

    const result = run();

    expect(result.status).toBe(0);
    expect(landed()).toHaveLength(1);
    expect(result.stdout).toContain('; moved the row "Parallel work conflicts on one file"');
  });

  it("tells the ticket its row did not move when every round's merge is refused, and leaves no branch behind", () => {
    const { landed, calls, run } = closing({ ticket: "812", buckets: BUCKETS, ticketBody: naming("Parallel work conflicts on one file"), rowMergesRefused: 3 });

    const result = run();

    expect(result.status).toBe(0);
    expect(landed()).toEqual([]);
    const told = calls().filter((call) => call.startsWith("issue\ncomment\n812\n")).at(-1);
    expect(told).toContain('The closer could not move the row "Parallel work conflicts on one file" in docs/buckets.md');
    expect(told).toContain("Pull request is not mergeable");
  });
});
