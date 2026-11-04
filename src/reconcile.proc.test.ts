import { describe, expect, it } from "vitest";
import { ELSEWHERE, HERE, type Issues, LANDED, linking } from "./reconcile.part.ts";

const edits = (calls: string[][]) => calls.filter((args) => args[0] === "issue" && args[1] === "edit");

describe("bin/reconcile applies the waiting projection of each open ticket's blockers (#1606)", () => {
  it("unlabels a waiting ticket whose cross-repo blocker closed and labels one with an open blocker, leaving an unlinked one alone", () => {
    const { reconcile, calls } = linking({
      tickets: [
        { number: 931, labels: ["ticket", "waiting"], blockers: [{ repo: ELSEWHERE, number: 7, state: "closed" }] },
        { number: 932, labels: ["ticket"], blockers: [{ repo: HERE, number: 5, state: "open" }] },
        { number: 933, labels: ["ticket", "waiting"], blockers: [] },
      ],
    });

    const result = reconcile();

    expect(result.status, result.stderr).toBe(0);
    expect(edits(calls())).toEqual([
      ["issue", "edit", "931", "--repo", HERE, "--remove-label", "waiting"],
      ["issue", "edit", "932", "--repo", HERE, "--add-label", "waiting"],
    ]);
  });

  it("wakes the dependent of Mezzanine#2022's race on the next scheduled pass: its blocker closed, then it was parked behind it, and only waiting comes off", () => {
    const { reconcile, calls } = linking({
      tickets: [
        { number: 2022, labels: ["ticket", "waiting"], blockers: [{ repo: HERE, number: 2021, state: "closed" }] },
        { number: 2023, labels: ["ticket", "waiting"], blockers: [{ repo: HERE, number: 2024, state: "open" }] },
        { number: 2025, labels: ["ticket"], blockers: [{ repo: HERE, number: 2021, state: "closed" }] },
      ],
    });

    const result = reconcile();

    expect(result.status, result.stderr).toBe(0);
    expect(edits(calls())).toEqual([["issue", "edit", "2022", "--repo", HERE, "--remove-label", "waiting"]]);
  });

  it("wakes any waiting issue whose blockers all closed, whatever its kind, and touches no other, where Mezzanine#2080, a spec, sat waiting because only tickets were read", () => {
    const { reconcile, calls } = linking({
      waiting: [
        { number: 2080, labels: ["spec", "waiting"], blockers: [{ repo: ELSEWHERE, number: 347, state: "closed" }] },
        { number: 2090, labels: ["research", "waiting"], blockers: [{ repo: HERE, number: 5, state: "closed" }] },
        { number: 2081, labels: ["spec", "waiting"], blockers: [{ repo: ELSEWHERE, number: 348, state: "open" }] },
      ],
    });

    const result = reconcile();

    expect(result.status, result.stderr).toBe(0);
    expect(edits(calls())).toEqual([
      ["issue", "edit", "2080", "--repo", HERE, "--remove-label", "waiting"],
      ["issue", "edit", "2090", "--repo", HERE, "--remove-label", "waiting"],
    ]);
  });

  it("wakes a dependent in another repo when the issue that closed was its last open blocker, and leaves one still blocked, so a cross-repo wait ends on the close and not the clock", () => {
    const { reconcile, calls } = linking({
      closing: { number: 7, blocking: [
        { repo: ELSEWHERE, number: 2080, labels: ["spec", "waiting"], blockers: [{ repo: HERE, number: 7, state: "closed" }] },
        { repo: ELSEWHERE, number: 2081, labels: ["ticket", "waiting"], blockers: [{ repo: HERE, number: 7, state: "closed" }, { repo: ELSEWHERE, number: 9, state: "open" }] },
      ] },
    });

    const result = reconcile("--closed", "7");

    expect(result.status, result.stderr).toBe(0);
    expect(edits(calls())).toEqual([["issue", "edit", "2080", "--repo", ELSEWHERE, "--remove-label", "waiting"]]);
  });

  it("fails red naming the ticket when the label edit is refused", () => {
    const result = linking({ refused: true, tickets: [{ number: 932, labels: ["ticket"], blockers: [{ repo: HERE, number: 5, state: "open" }] }] }).reconcile();

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`${HERE}#932 could not be labelled waiting`);
  });
});

describe("bin/reconcile holds a ticket waiting on another repo's full checks until that many have run (#1648)", () => {
  const MEZZANINE = "collod873/Mezzanine";
  const waits = "## Why\n\n> measure it\n\nWaits on 2 full checks of collod873/Mezzanine after collod873/agent-hooks@da77e6c.";
  const waited = (runs: string) => `## Why\n\n> measure it\n\nWaited on 2 full checks of collod873/Mezzanine after collod873/agent-hooks@da77e6c: runs ${runs}. Each run's \`check-logs\` artifact holds its check's ledger rows: \`gh run download <run> --repo ${MEZZANINE} --name check-logs\`.`;
  const reads = (calls: string[][]) => calls.filter((args) => args[0] === "api" && args.some((arg) => arg.includes("/actions/") || arg.includes("/commits/")));

  it("counts only CI runs started after the commit landed that left a check's ledger rows, and leaves the ticket waiting while too few have", () => {
    const { reconcile, calls } = linking({ checks: { started: [41, 42], ledgered: [30, 41] }, tickets: [{ number: 931, labels: ["ticket", "waiting"], body: waits, blockers: [{ repo: ELSEWHERE, number: 7, state: "closed" }] }] });

    const result = reconcile();

    expect(result.status, result.stderr).toBe(0);
    expect(edits(calls())).toEqual([]);
    expect(reads(calls())).toEqual([
      ["api", "repos/collod873/agent-hooks/commits/da77e6c", "--jq", ".commit.committer.date"],
      ["api", "--paginate", `repos/${MEZZANINE}/actions/workflows/ci.yml/runs?created=>=${LANDED}&per_page=100`, "--jq", ".workflow_runs[].id"],
      ["api", "--paginate", `repos/${MEZZANINE}/actions/artifacts?name=check-logs&per_page=100`, "--jq", ".artifacts[].workflow_run.id"],
    ]);
  });

  it("writes the runs that met it and how to read their ledger rows into the body before it takes waiting off", () => {
    const { reconcile, calls } = linking({ checks: { started: [43, 41, 42], ledgered: [42, 43, 41] }, tickets: [{ number: 931, labels: ["ticket", "waiting"], body: waits, blockers: [] }] });

    const result = reconcile();

    expect(result.status, result.stderr).toBe(0);
    expect(edits(calls())).toEqual([
      ["issue", "edit", "931", "--repo", HERE, "--body", `${waited("41, 42")}\n`],
      ["issue", "edit", "931", "--repo", HERE, "--remove-label", "waiting"],
    ]);
  });

  it("wakes a waiting ticket whose wait was written met when its wake was lost, and reads no runs for it", () => {
    const { reconcile, calls } = linking({ tickets: [{ number: 931, labels: ["ticket", "waiting"], body: waited("41, 42"), blockers: [] }] });

    const result = reconcile();

    expect(result.status, result.stderr).toBe(0);
    expect(reads(calls())).toEqual([]);
    expect(edits(calls())).toEqual([["issue", "edit", "931", "--repo", HERE, "--remove-label", "waiting"]]);
  });

  it("keeps a dependent in another repo waiting on its checks when its last blocker closes, as agent-hooks#401 behind #1648", () => {
    const { reconcile, calls } = linking({
      checks: { started: [41], ledgered: [41] },
      closing: { number: 1648, blocking: [{ repo: ELSEWHERE, number: 401, labels: ["ticket", "waiting"], body: waits, blockers: [{ repo: HERE, number: 1648, state: "closed" }] }] },
    });

    const result = reconcile("--closed", "1648");

    expect(result.status, result.stderr).toBe(0);
    expect(edits(calls())).toEqual([]);
  });
});

describe("bin/reconcile restarts a stale build once, then flags it to the owner (#1606)", () => {
  const stale = { event: "labeled", label: { name: "building" }, created_at: "2026-01-01T00:00:00Z" };
  const changes = (calls: string[][]) => calls.filter((args) => ["edit", "comment"].includes(args[1] ?? "") || args[0] === "workflow");

  it("records the marker line and relabels the ticket so its wake job builds it again, then flags stuck with an owner comment after one restart, leaving a live build alone", () => {
    const { reconcile, calls } = linking({
      liveTitles: ["labeled #933: live one"],
      tickets: [
        { number: 931, labels: ["ticket", "building"], blockers: [], timeline: [stale] },
        { number: 932, labels: ["ticket", "building"], blockers: [], timeline: [stale, { event: "commented", body: "<!-- reconcile: restarted -->\nReconcile restarted #932" }] },
        { number: 933, labels: ["ticket", "building"], blockers: [], timeline: [stale] },
      ],
    });

    const result = reconcile();

    expect(result.status, result.stderr).toBe(0);
    const [marker, unbuilding, untick, tick, stuck, owner, ...rest] = changes(calls());
    expect(marker?.slice(0, 4)).toEqual(["issue", "comment", "931", "--repo"]);
    expect([unbuilding, untick, tick]).toEqual([
      ["issue", "edit", "931", "--repo", HERE, "--remove-label", "building"],
      ["issue", "edit", "931", "--repo", HERE, "--remove-label", "ticket"],
      ["issue", "edit", "931", "--repo", HERE, "--add-label", "ticket"],
    ]);
    expect(marker?.at(-1)).toMatch(/^<!-- reconcile: restarted -->\n/);
    expect(stuck).toEqual(["issue", "edit", "932", "--repo", HERE, "--add-label", "stuck"]);
    expect(owner?.slice(0, 3)).toEqual(["issue", "comment", "932"]);
    expect(owner?.at(-1)).toMatch(/^@collod873 /);
    expect(rest).toEqual([]);
  });
});

describe("bin/reconcile re-admits a refused ticket once its chain is valid (#1606)", () => {
  const refusal = { event: "commented", body: "#931 does not build, since its checks would run as shell with the App's token and the App filed it as a sub-issue of collod873/design-kit#12, where the App opened it as no follow-up the machine builds." };
  const chain = (origin: string): Issues => ({ [`${HERE}/issues/931`]: { user: { login: "collod873-machine[bot]" }, body: "## Why\n" }, [`${ELSEWHERE}/issues/12`]: { user: { login: origin }, body: "## Why\n" } });
  const changes = (calls: string[][]) => calls.filter((args) => ["edit", "comment"].includes(args[1] ?? ""));

  it("relabels a refused ticket whose origin became the owner's, posting no new refusal", () => {
    const { reconcile, calls } = linking({ issues: chain("collod873"), tickets: [{ number: 931, labels: ["ticket"], blockers: [], timeline: [refusal] }] });

    const result = reconcile();

    expect(result.status, result.stderr).toBe(0);
    const [marker, ...relabel] = changes(calls());
    expect(marker?.at(-1)).toMatch(/^<!-- reconcile: readmitted -->\n/);
    expect(marker?.at(-1)).not.toContain("does not build");
    expect(relabel).toEqual([
      ["issue", "edit", "931", "--repo", HERE, "--remove-label", "ticket"],
      ["issue", "edit", "931", "--repo", HERE, "--add-label", "ticket"],
    ]);
  });

  it("leaves a refused ticket whose chain is still invalid, and one already re-admitted, without a word", () => {
    const still = linking({ issues: chain("collod873-machine[bot]"), tickets: [{ number: 931, labels: ["ticket"], blockers: [], timeline: [refusal] }] });
    const again = linking({ issues: chain("collod873"), tickets: [{ number: 931, labels: ["ticket"], blockers: [], timeline: [refusal, { event: "commented", body: "<!-- reconcile: readmitted -->\nReconcile re-admitted #931" }] }] });

    for (const { reconcile, calls } of [still, again]) {
      const result = reconcile();
      expect(result.status, result.stderr).toBe(0);
      expect(changes(calls())).toEqual([]);
    }
  });
});

describe("bin/issue-links reads and adds blocked-by links and sub-issue parents across repos (#1606)", () => {
  it("reads a ticket's blockers with the repo each lives in", () => {
    const { links } = linking({ tickets: [{ number: 931, labels: [], blockers: [{ repo: ELSEWHERE, number: 7, state: "closed" }] }] });

    expect(links("blockers", HERE, "931").stdout).toBe(`${JSON.stringify([{ repo: ELSEWHERE, number: 7, open: false }])}\n`);
  });

  it("adds a blocker from another repo by its issue id", () => {
    const { links, calls } = linking();

    expect(links("add-blocker", HERE, "931", ELSEWHERE, "7").status).toBe(0);
    expect(calls()).toEqual([
      ["api", `repos/${ELSEWHERE}/issues/7`, "--jq", ".id"],
      ["api", "--method", "POST", `repos/${HERE}/issues/931/dependencies/blocked_by`, "-F", "issue_id=4242"],
    ]);
  });

  it("takes a blocker already linked as linked, so parking twice behind one issue does not fail the run", () => {
    const { links } = linking({ alreadyLinked: true });

    const result = links("add-blocker", HERE, "931", ELSEWHERE, "7");

    expect(result.status, result.stderr).toBe(0);
  });

  it("files a ticket under a parent in another repo by the ticket's issue id", () => {
    const { links, calls } = linking();

    expect(links("add-parent", HERE, "931", ELSEWHERE, "12").status).toBe(0);
    expect(calls()).toEqual([
      ["api", `repos/${HERE}/issues/931`, "--jq", ".id"],
      ["api", "--method", "POST", `repos/${ELSEWHERE}/issues/12/sub_issues`, "-F", "sub_issue_id=4242"],
    ]);
  });

  it.each([
    ["its parent in another repo", false, `${JSON.stringify({ repo: ELSEWHERE, number: 12, open: true })}\n`],
    ["null for a ticket with no parent", true, "null\n"],
  ])("reads %s", (_, parentless, said) => {
    expect(linking({ parentless }).links("parent", HERE, "931").stdout).toBe(said);
  });
});
