import { describe, expect, it } from "vitest";
import {
  DECISION_MARKER,
  deadRunsOf,
  decisionBody,
  hasStandingDecision,
  recordedRunIds,
  RUNGS,
  rungFor,
  signatureFromLog,
  strikeBody,
  strikesIn,
  ticketsInFlight,
  type LaneRun,
} from "./strikes";

const url = (id: number) => `https://github.com/o/r/actions/runs/${id}`;

describe("the rung table", () => {
  it("climbs implementer, fresh eyes, mechanic, decision, one rung per strike, and stays on decision", () => {
    expect([0, 1, 2, 3, 4, 9].map(rungFor)).toEqual(["implementer", "fresh-eyes", "mechanic", "decision", "decision", "decision"]);
    expect(RUNGS).toHaveLength(4);
  });
});

describe("a strike on the ticket", () => {
  const strike = { runId: 42, conclusion: "cancelled", signature: "implement failed: EISDIR bin/close-ticket" };

  it("is one comment carrying a marker the next recompute can count, the signature, and the rung that follows", () => {
    const body = strikeBody(strike, url(42), "fresh-eyes");

    expect(strikesIn([body])).toEqual([strike]);
    expect(recordedRunIds([body])).toEqual(new Set([42]));
    expect(body).toContain(url(42));
    expect(body).toContain("second model with a clean context");
  });

  it("never carries a signature that could close the marker's own comment", () => {
    const body = strikeBody({ ...strike, signature: "boom --> <!-- x" }, url(42), "mechanic");

    expect(strikesIn([body])[0].signature).toBe("boom <!-- x");
  });

  it("is read from the log's last `failed:` line, and from the conclusion when no line says why", () => {
    expect(signatureFromLog("x\nimplement failed: fetch: 403\nimplement failed: EISDIR\n", "failure")).toBe("EISDIR");
    expect(signatureFromLog("mechanic failed: fence\n", "failure")).toBe("fence");
    expect(signatureFromLog("", "cancelled")).toBe("cancelled before answering");
  });

  it("counts only strikes after the last decision, so clearing needs-human restarts the ladder", () => {
    const before = [strikeBody({ ...strike, runId: 1 }, url(1), "fresh-eyes"), strikeBody({ ...strike, runId: 2 }, url(2), "mechanic")];
    const decision = decisionBody(7, strikesIn(before), url);
    const after = strikeBody({ ...strike, runId: 3 }, url(3), "fresh-eyes");

    expect(strikesIn([...before, decision]).map((s) => s.runId)).toEqual([]);
    expect(strikesIn([...before, decision, after]).map((s) => s.runId)).toEqual([3]);
    expect(recordedRunIds([...before, decision, after])).toEqual(new Set([1, 2, 3]));
  });

  it("knows whether a decision still stands, which is whether nothing died since it was posted", () => {
    const decision = decisionBody(7, [strike], url);
    const later = strikeBody({ ...strike, runId: 9 }, url(9), "fresh-eyes");

    expect(hasStandingDecision([decision])).toBe(true);
    expect(hasStandingDecision([decision, later])).toBe(false);
    expect(hasStandingDecision([later])).toBe(false);
  });
});

describe("the decision", () => {
  it("lists every strike with its run, says whether the cause is deterministic, and offers lettered options with a recommendation", () => {
    const same = [1, 2, 3].map((runId) => ({ runId, conclusion: "failure", signature: "EISDIR" }));
    const body = decisionBody(7, same, url);

    expect(body).toContain(DECISION_MARKER);
    expect(body).toContain(url(3));
    expect(body).toContain("deterministic");
    expect(body).toMatch(/- A\. .*\n- B\. .*\n- C\. /);
    expect(body).toContain("Recommendation:");
  });

  it("says the signatures differ when they do", () => {
    const differing = [
      { runId: 1, conclusion: "failure", signature: "a" },
      { runId: 2, conclusion: "cancelled", signature: "b" },
    ];

    expect(decisionBody(7, differing, url)).toContain("signatures differ");
  });
});

describe("reading the runs API", () => {
  const runs: LaneRun[] = [
    { databaseId: 1, displayTitle: "Implement #20", status: "in_progress", conclusion: null, url: url(1) },
    { databaseId: 2, displayTitle: "Acceptance #21", status: "queued", conclusion: null, url: url(2) },
    { databaseId: 3, displayTitle: "Implement #22", status: "completed", conclusion: "failure", url: url(3) },
    { databaseId: 4, displayTitle: "Mechanic #22", status: "completed", conclusion: "cancelled", url: url(4) },
    { databaseId: 5, displayTitle: "Implement #22", status: "completed", conclusion: "success", url: url(5) },
    { databaseId: 6, displayTitle: "Verify", status: "completed", conclusion: "failure", url: url(6) },
    { databaseId: 7, displayTitle: "Mechanic #23", status: "in_progress", conclusion: null, url: url(7) },
  ];

  it("reads a ticket as in flight from any non-completed run whose title carries it", () => {
    expect(ticketsInFlight(runs)).toEqual(new Set([20, 21, 23]));
  });

  it("reads a ticket's dead runs as its completed Implement or Mechanic runs that did not succeed", () => {
    expect(deadRunsOf(runs, 22).map((run) => run.databaseId)).toEqual([3, 4]);
    expect(deadRunsOf(runs, 20)).toEqual([]);
  });
});
