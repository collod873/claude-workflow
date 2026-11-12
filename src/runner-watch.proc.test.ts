import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { watching } from "./runner-watch.part.ts";
import { holds } from "./scenarios.ts";

const pc = (status: string) => ({ status, labels: ["self-hosted", "pc"] });

describe("bin/runner-watch keeps private repos off paid minutes without Collin watching (#1590)", () => {
  it("sends a repo whose PC runners are all offline to GitHub's runners, and back to pc once one returns, logging each flip with the time", () => {
    const watch = watching([{ name: "collod873/chess", runners: [pc("offline"), pc("offline")], variable: "pc" }]);

    const off = watch.run("flip");
    expect(off.stderr).toBe("");
    expect(off.stdout).toMatch(/^runner-watch: \d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ collod873\/chess pc -> github, its PC runners are offline\n$/);
    expect(watch.variable("collod873/chess")).toBe("ubuntu-latest");

    const unchanged = watching([{ name: "collod873/chess", runners: [pc("offline")], variable: "ubuntu-latest" }]);
    expect(unchanged.run("flip").stdout).toBe("");

    const back = watching([{ name: "collod873/chess", runners: [pc("offline"), pc("online")], variable: "ubuntu-latest" }]);
    expect(back.run("flip").stdout).toMatch(/ collod873\/chess github -> pc, its PC runners are back\n$/);
    expect(back.variable("collod873/chess")).toBe("pc");
  });

  it("leaves a repo switched to GitHub by hand, or with no PC runners, where it is", () => {
    const watch = watching([
      { name: "collod873/lodato-life", runners: [pc("online")] },
      { name: "collod873/design-kit", runners: [{ status: "offline", labels: ["self-hosted", "other"] }], variable: "pc" },
    ]);

    expect(watch.run("flip")).toEqual({ status: 0, stdout: "", stderr: "" });
    expect(watch.variable("collod873/lodato-life")).toBeUndefined();
    expect(watch.variable("collod873/design-kit")).toBe("pc");
  });

  it("still flips the other repos when GitHub refuses one, then fails on one line", () => {
    const watch = watching([{ name: "collod873/chess", runners: [pc("offline")], variable: "pc" }]);
    watch.refuse("collod873/secret");

    const ran = watch.run("flip");
    expect(watch.variable("collod873/chess")).toBe("ubuntu-latest");
    expect(ran.status).toBe(1);
    expect(ran.stderr).toMatch(/^runner-watch: 1 of 2 repos unchecked, first: gh api repos\/collod873\/secret\/actions\/runners: .*\n$/);
  });

  it("files one issue to Collin naming each private repo, workflow and GitHub-hosted minutes of the day, counting each job's started minute", () => {
    const watch = watching(
      [{ name: "collod873/chess" }, { name: "collod873/claude-workflow", private: false }],
      [
        { product: "actions", unitType: "Minutes", quantity: 7, repositoryName: "collod873/chess" },
        { product: "actions", unitType: "Minutes", quantity: 40, repositoryName: "collod873/claude-workflow" },
        { product: "git_lfs", unitType: "GigabyteHours", quantity: 3, repositoryName: "collod873/chess" },
      ],
      {
        "collod873/chess": [
          { name: "CI", jobs: [{ labels: ["ubuntu-latest"], started_at: "2026-10-29T10:00:00Z", completed_at: "2026-10-29T10:04:10Z" }, { labels: ["pc"], started_at: "2026-10-29T10:00:00Z", completed_at: "2026-10-29T11:00:00Z" }, { labels: ["pc-reconcile"], started_at: "2026-10-29T10:00:00Z", completed_at: "2026-10-29T10:00:12Z" }] },
          { name: "Nightly", jobs: [{ labels: ["ubuntu-latest"], started_at: "2026-10-29T03:00:00Z", completed_at: "2026-10-29T03:02:00Z" }] },
        ],
      },
    );

    const ran = watch.run("minutes", "collod873", "2026-10-29");

    expect(ran.stderr).toBe("");
    const issue = watch.issue() ?? "";
    expect(issue).toContain("GitHub-hosted minutes on 2026-10-29");
    expect(issue).toContain("collod873");
    expect(issue).toContain("collod873/chess: 7 minutes");
    expect(issue).toContain("CI: 5 minutes");
    expect(issue).toContain("Nightly: 2 minutes");
    expect(issue).not.toContain("claude-workflow:");
  });

  it("counts every run of a busy day, past the first page and a megabyte of run list", () => {
    const hosted = { labels: ["ubuntu-latest"], started_at: "2026-10-29T10:00:00Z", completed_at: "2026-10-29T10:00:30Z" };
    const watch = watching([{ name: "collod873/Mezzanine" }], [{ product: "actions", unitType: "Minutes", quantity: 150, repositoryName: "Mezzanine" }], {
      "collod873/Mezzanine": Array.from({ length: 150 }, () => ({ name: "Busy", display_title: "x".repeat(8000), jobs: [hosted] })),
    });

    expect(watch.run("minutes", "collod873", "2026-10-29").stderr).toBe("");
    expect(watch.issue()).toContain("Busy: 150 minutes");
  });

  it("rides out a job list GitHub answers with HTTP 502 once, and names gh's own line when one keeps failing (#1711)", () => {
    const hosted = { labels: ["ubuntu-latest"], started_at: "2026-10-29T10:00:00Z", completed_at: "2026-10-29T10:01:30Z" };
    const day = (): ReturnType<typeof watching> => watching([{ name: "collod873/chess" }], [{ product: "actions", unitType: "Minutes", quantity: 2, repositoryName: "chess" }], { "collod873/chess": [{ name: "CI", jobs: [hosted] }] });
    const jobs = "api repos/collod873/chess/actions/runs/0/jobs?per_page=100";

    const blipped = day();
    blipped.fails(jobs, "HTTP 502: Bad Gateway", 1);
    expect(blipped.run("minutes", "collod873", "2026-10-29").status).toBe(0);
    expect(blipped.issue()).toContain("CI: 2 minutes");

    const refused = day();
    refused.fails(jobs, "HTTP 403: Resource not accessible by integration", 9);
    const ran = refused.run("minutes", "collod873", "2026-10-29");
    expect(ran.status).toBe(1);
    expect(ran.stderr).toContain(`runner-watch: gh ${jobs}: HTTP 403: Resource not accessible by integration\n`);
  });

  it("files nothing on a day no private repo used GitHub-hosted minutes", () => {
    const watch = watching([{ name: "collod873/chess" }], [{ product: "actions", unitType: "Minutes", quantity: 0, repositoryName: "collod873/chess" }]);

    expect(watch.run("minutes", "collod873", "2026-10-29")).toEqual({ status: 0, stdout: "", stderr: "" });
    expect(watch.issue()).toBeUndefined();
  });
});

describe("bin/runner-watch flip on GitHub's schedule is the backstop for the PC's machine clock, since GitHub fires a schedule hours late (#1695)", () => {
  const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
  const offline = [{ name: "collod873/chess", runners: [pc("offline")], variable: "pc" }];

  it("flips nothing when the machine clock's dispatched runner watch ran in the last 20 minutes", () => {
    const watch = watching(offline, [], {}, { scheduled: true, dispatched: [{ created_at: minutesAgo(9), display_title: "Runner watch" }] });

    const ran = watch.run("flip");

    expect(ran.status, ran.stderr).toBe(0);
    expect(ran.stdout).toContain("already ran");
    expect(watch.variable("collod873/chess")).toBe("pc");
  });

  it("still flips when the newest dispatched runner watch is older than 20 minutes, as when the PC is off", () => {
    const watch = watching(offline, [], {}, { scheduled: true, dispatched: [{ created_at: minutesAgo(40), display_title: "Runner watch" }] });

    expect(watch.run("flip").status).toBe(0);
    expect(watch.variable("collod873/chess")).toBe("ubuntu-latest");
  });

  it("files the day's minutes on its daily schedule and a dispatch by hand, never on the machine clock's dispatch every 15 minutes", () => {
    const steps = (parse(readFileSync(join(import.meta.dirname, "..", ".github", "workflows", "runner-watch.yml"), "utf8")) as { jobs: { watch: { steps: { if?: string; run?: string }[] } } }).jobs.watch.steps;
    const minutesIf = steps.find(({ run }) => run?.includes("runner-watch minutes"))?.if ?? "";
    const files = (fired: { event: string; inputs?: Record<string, string>; schedule?: string }) => holds(minutesIf, fired);

    expect(holds(minutesIf.replace("github.event.schedule", "'17 6 * * *'"), { event: "schedule" })).toBe(true);
    expect(holds(minutesIf.replace("github.event.schedule", "'*/15 * * * *'"), { event: "schedule" })).toBe(false);
    expect(files({ event: "workflow_dispatch", inputs: { minutes: "true" } })).toBe(true);
    expect(files({ event: "workflow_dispatch", inputs: { minutes: "false" } })).toBe(false);
  });
});
