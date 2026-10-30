import { describe, expect, it } from "vitest";
import { watching } from "./scenarios.ts";

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
          { name: "CI", jobs: [{ labels: ["ubuntu-latest"], started_at: "2026-10-29T10:00:00Z", completed_at: "2026-10-29T10:04:10Z" }, { labels: ["pc"], started_at: "2026-10-29T10:00:00Z", completed_at: "2026-10-29T11:00:00Z" }] },
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

  it("files nothing on a day no private repo used GitHub-hosted minutes", () => {
    const watch = watching([{ name: "collod873/chess" }], [{ product: "actions", unitType: "Minutes", quantity: 0, repositoryName: "collod873/chess" }]);

    expect(watch.run("minutes", "collod873", "2026-10-29")).toEqual({ status: 0, stdout: "", stderr: "" });
    expect(watch.issue()).toBeUndefined();
  });
});
