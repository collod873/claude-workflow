import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createFakeStage } from "../shared/stage.fake";
import {
  DELIVERY_CLOSE_REASON,
  REFUSED_LABEL,
  SALVAGE_MODEL,
  runCloseGate,
} from "./close-gate";
import { bodyWithCriteria, recordComment, salvageResponse } from "./record.fixture";
import { createFakeTracker, type FakeTrackerOptions } from "./tracker.fake";

const silent = () => {};

/** Runs the gate against a completed close, with no salvage stage expected. */
function gate(options: FakeTrackerOptions & { stateReason?: string | null; response?: string }) {
  const tracker = createFakeTracker(options);
  const stage = createFakeStage(options.response ?? "");
  const outcome = runCloseGate({
    issueNumber: 42,
    stateReason: options.stateReason === undefined ? DELIVERY_CLOSE_REASON : options.stateReason,
    runUrl: "https://github.com/o/r/actions/runs/1",
    gh: tracker.gh,
    exec: stage.exec,
    log: silent,
  });
  return { outcome, tracker, stage };
}

describe("scope — which closes are judged at all", () => {
  it("ignores a close marked not planned, without reading the issue", () => {
    const { outcome, tracker } = gate({ stateReason: "not_planned" });
    expect(outcome).toMatchObject({ action: "pass", code: "not-a-delivery-claim" });
    expect(tracker.calls).toEqual([]);
  });

  it("ignores a close marked duplicate", () => {
    expect(gate({ stateReason: "duplicate" }).outcome.action).toBe("pass");
  });

  it("ignores a close whose reason the payload did not carry", () => {
    expect(gate({ stateReason: null }).outcome.action).toBe("pass");
  });

  it("spends no model on a close it does not judge", () => {
    expect(gate({ stateReason: "not_planned" }).stage.calls).toEqual([]);
  });
});

describe("a record that exists is judged as written", () => {
  it("passes a well-shaped record without touching the issue or a model", () => {
    const { outcome, tracker, stage } = gate({
      body: bodyWithCriteria(1),
      comments: [recordComment({ bullets: ["Criterion 1 — MET: `src/thing.ts:12`"] })],
    });
    expect(outcome).toMatchObject({ action: "pass", code: "met", salvaged: false });
    expect(tracker.reopenedWith).toBeNull();
    expect(tracker.commentsPosted).toEqual([]);
    expect(stage.calls).toEqual([]);
  });

  it("reopens, comments and labels when the record fails", () => {
    const { outcome, tracker } = gate({
      body: bodyWithCriteria(1),
      comments: [recordComment({ bullets: ["Criterion 1 — UNMET: not built"] })],
    });
    expect(outcome).toMatchObject({ action: "refuse", code: "unmet-criterion" });
    expect(tracker.reopenedWith).toContain("unmet-criterion");
    expect(tracker.reopenedWith).toContain("RECORD-GRAMMAR.md");
    expect(tracker.labelsAdded).toEqual([REFUSED_LABEL]);
  });

  it("never spends a model rewriting a record somebody actually posted", () => {
    const { stage } = gate({
      body: bodyWithCriteria(1),
      comments: [recordComment({ bullets: ["Criterion 1 — UNMET: not built"] })],
    });
    expect(stage.calls).toEqual([]);
  });

  it("keeps a refusal green — a refusal is the gate working", () => {
    const { outcome } = gate({
      body: bodyWithCriteria(1),
      comments: [recordComment({ bullets: ["Criterion 1 — UNMET: not built"] })],
    });
    expect(outcome.action).not.toBe("degraded");
  });
});

describe("salvage — the one Haiku, where no record was posted", () => {
  it("spends exactly one call, on Haiku, when there is no record", () => {
    const { stage } = gate({
      body: bodyWithCriteria(1),
      comments: ["Merged in #7."],
      response: salvageResponse(recordComment({ bullets: ["Criterion 1 — MET: `src/a.ts:1`"] })),
    });
    expect(stage.calls).toHaveLength(1);
    expect(stage.calls[0]).toContain("--model");
    expect(stage.calls[0][stage.calls[0].indexOf("--model") + 1]).toBe(SALVAGE_MODEL);
  });

  it("passes the close and posts what it read, so a re-close costs no model", () => {
    const { outcome, tracker } = gate({
      body: bodyWithCriteria(1),
      comments: ["Merged in #7."],
      response: salvageResponse(recordComment({ bullets: ["Criterion 1 — MET: `src/a.ts:1`"] })),
    });
    expect(outcome).toMatchObject({ action: "pass", code: "met", salvaged: true });
    expect(tracker.reopenedWith).toBeNull();
    expect(tracker.commentsPosted).toHaveLength(1);
    expect(tracker.commentsPosted[0]).toContain("## Closing record");
    expect(tracker.commentsPosted[0]).toContain("close gate");
  });

  it("refuses when the record it salvaged does not clear the grammar", () => {
    const { outcome, tracker } = gate({
      body: bodyWithCriteria(1),
      comments: ["Merged in #7."],
      response: salvageResponse(recordComment({ bullets: ["Criterion 1 — UNMET: no evidence"] })),
    });
    expect(outcome).toMatchObject({ action: "refuse", code: "unmet-criterion", salvaged: true });
    expect(tracker.reopenedWith).toContain("the gate read the issue");
    expect(tracker.commentsPosted).toEqual([]);
  });

  it("cannot be talked past — the model's own verdict is not consulted", () => {
    // A salvage that says MET but shows nothing shaped like evidence is
    // refused by the same rule that refuses a human's. The model translates;
    // the grammar judges.
    const { outcome } = gate({
      body: bodyWithCriteria(1),
      comments: ["Merged in #7."],
      response: salvageResponse(
        recordComment({ bullets: ["Criterion 1 — MET: I read the PR and it looks done"] }),
      ),
    });
    expect(outcome).toMatchObject({ action: "refuse", code: "bad-evidence-shape" });
  });
});

describe("degraded — the gate could not do its job", () => {
  it("fails closed and goes red when the tracker will not answer", () => {
    const { outcome, tracker } = gate({ viewFails: true });
    expect(outcome).toMatchObject({ action: "degraded", code: "tracker-unreadable" });
    expect(tracker.reopenedWith).toContain("could not verify");
  });

  it("fails closed on an answer it cannot parse", () => {
    expect(gate({ viewReturns: "not json" }).outcome.action).toBe("degraded");
  });

  it("fails closed when the salvage stage dies", () => {
    const { outcome, tracker } = gate({
      body: bodyWithCriteria(1),
      comments: ["Merged in #7."],
      response: "the model said something conversational and no <output> block",
    });
    expect(outcome).toMatchObject({ action: "degraded", code: "salvage-failed" });
    expect(tracker.reopenedWith).toContain("could not verify");
  });

  it("fails closed when salvage returns text that is not a record", () => {
    const { outcome } = gate({
      body: bodyWithCriteria(1),
      comments: ["Merged in #7."],
      response: salvageResponse("I could not find any evidence for this close."),
    });
    expect(outcome).toMatchObject({ action: "degraded", code: "salvage-failed" });
  });
});

describe("a missing label never costs the refusal", () => {
  it("still reopens when the label write fails", () => {
    const tracker = createFakeTracker({
      body: bodyWithCriteria(1),
      comments: [recordComment({ bullets: ["Criterion 1 — UNMET: not built"] })],
      labelFails: true,
    });
    const outcome = runCloseGate({
      issueNumber: 42,
      stateReason: DELIVERY_CLOSE_REASON,
      gh: tracker.gh,
      exec: createFakeStage("").exec,
      log: silent,
    });
    expect(outcome.action).toBe("refuse");
    expect(tracker.reopenedWith).not.toBeNull();
  });
});

// The scope rule is enforced twice — once by the workflow's job-level `if`,
// so a close that claims nothing never starts a runner, and once by the
// constant above. No compiler sees across that language boundary, so a test
// does, the same way `to-tickets.yml`'s stage steps are pinned to the stage
// record.
describe("close-gate.yml agrees with the scope rule it is a copy of", () => {
  const workflow = readFileSync(
    fileURLToPath(new URL("../../../.github/workflows/close-gate.yml", import.meta.url)),
    "utf8",
  );

  it("fires on issues.closed and nothing else", () => {
    expect(workflow).toMatch(/issues:\s*\n\s*types:\s*\[closed\]/);
  });

  it("gates the job on the same state_reason the gate judges", () => {
    expect(workflow).toContain(`state_reason == '${DELIVERY_CLOSE_REASON}'`);
  });

  it("creates the label a refusal applies, so the first refusal cannot fail", () => {
    expect(workflow).toContain(`gh label create ${REFUSED_LABEL}`);
  });
});
