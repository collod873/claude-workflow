import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { GhExec } from "../shared/gh";
import {
  CLOSE_STATE_REASON,
  PRD_LABEL,
  runReleaseOnPrdClose,
} from "./release-on-prd-close";
import type { RunReleaseOptions, RunReleaseResult } from "./run-release";

const silent = () => {};

/** A minimal recording `GhExec` — mirrors `run-release.test.ts`'s `fakeGh`. */
function fakeGh(): { gh: GhExec; calls: string[][] } {
  const calls: string[][] = [];
  const gh: GhExec = (args) => {
    calls.push(args);
    return "";
  };
  return { gh, calls };
}

/** Records every call `runReleaseOnPrdClose` makes into the release seam, without exercising `runRelease`'s real git/gh behaviour. */
function fakeRelease(result: RunReleaseResult): { runRelease: (options: RunReleaseOptions) => RunReleaseResult; calls: RunReleaseOptions[] } {
  const calls: RunReleaseOptions[] = [];
  return {
    runRelease: (options) => {
      calls.push(options);
      return result;
    },
    calls,
  };
}

describe("scope — which PRD closes fire a release at all", () => {
  it("ignores a close marked not planned, without calling the release module", () => {
    const { gh, calls: ghCalls } = fakeGh();
    const { runRelease, calls } = fakeRelease({ opened: true, releasedCount: 5 });

    const outcome = runReleaseOnPrdClose({
      stateReason: "not_planned",
      labels: [PRD_LABEL],
      head: "abc123",
      repoDir: "/repo",
      gh,
      runRelease,
      log: silent,
    });

    expect(outcome).toEqual({ ran: false });
    expect(calls).toEqual([]);
    expect(ghCalls).toEqual([]);
  });

  it("ignores a close whose reason the payload did not carry", () => {
    const { runRelease, calls } = fakeRelease({ opened: false, releasedCount: 0 });
    const outcome = runReleaseOnPrdClose({
      stateReason: null,
      labels: [PRD_LABEL],
      head: "abc123",
      repoDir: "/repo",
      runRelease,
      log: silent,
    });
    expect(outcome.ran).toBe(false);
    expect(calls).toEqual([]);
  });

  it("ignores a completed close that never carried the prd label", () => {
    const { gh, calls: ghCalls } = fakeGh();
    const { runRelease, calls } = fakeRelease({ opened: true, releasedCount: 5 });

    const outcome = runReleaseOnPrdClose({
      stateReason: CLOSE_STATE_REASON,
      labels: ["enhancement"],
      head: "abc123",
      repoDir: "/repo",
      gh,
      runRelease,
      log: silent,
    });

    expect(outcome).toEqual({ ran: false });
    expect(calls).toEqual([]);
    expect(ghCalls).toEqual([]);
  });

  it("ignores a close marked duplicate carrying no labels at all", () => {
    const { runRelease, calls } = fakeRelease({ opened: false, releasedCount: 0 });
    const outcome = runReleaseOnPrdClose({
      stateReason: "duplicate",
      labels: [],
      head: "abc123",
      repoDir: "/repo",
      runRelease,
      log: silent,
    });
    expect(outcome.ran).toBe(false);
    expect(calls).toEqual([]);
  });
});

describe("in scope — a completed close of an issue labelled prd", () => {
  it("calls the release module exactly once, forwarding prdClosed: true", () => {
    const { runRelease, calls } = fakeRelease({
      opened: true,
      releasedCount: 5,
      output: "https://github.com/o/r/pull/9\n",
    });

    const outcome = runReleaseOnPrdClose({
      issueNumber: 63,
      stateReason: CLOSE_STATE_REASON,
      labels: [PRD_LABEL, "enhancement"],
      head: "abc123",
      repoDir: "/repo",
      threshold: 20,
      prBase: "main",
      runRelease,
      log: silent,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      repoDir: "/repo",
      head: "abc123",
      prdClosed: true,
      threshold: 20,
      prBase: "main",
    });
    expect(outcome).toEqual({
      ran: true,
      opened: true,
      releasedCount: 5,
      output: "https://github.com/o/r/pull/9\n",
    });
  });

  it("makes no gh call when the release module itself opens nothing", () => {
    const { gh, calls: ghCalls } = fakeGh();
    const { runRelease } = fakeRelease({ opened: false, releasedCount: 0 });

    const outcome = runReleaseOnPrdClose({
      stateReason: CLOSE_STATE_REASON,
      labels: [PRD_LABEL],
      head: "abc123",
      repoDir: "/repo",
      gh,
      runRelease,
      log: silent,
    });

    expect(outcome).toEqual({ ran: true, opened: false, releasedCount: 0, output: undefined });
    // The release module's own `gh` never ran anything through the fake threaded here — the
    // connector only forwards it, it makes no write of its own.
    expect(ghCalls).toEqual([]);
  });

  it("still calls the release module exactly once when prd is not the only label", () => {
    const { runRelease, calls } = fakeRelease({ opened: true, releasedCount: 1 });
    runReleaseOnPrdClose({
      stateReason: CLOSE_STATE_REASON,
      labels: ["needs-triage", PRD_LABEL],
      head: "def456",
      repoDir: "/repo",
      runRelease,
      log: silent,
    });
    expect(calls).toHaveLength(1);
  });
});

// The scope rule is enforced twice — once by the workflow's job-level `if`, so a close that
// claims nothing never starts a runner, and once by the two constants above. No compiler sees
// across that language boundary, so a test does — the same shape as
// `close-gate.test.ts`'s own `close-gate.yml` agreement test.
describe("release-on-prd-close.yml agrees with the scope rule it is a copy of", () => {
  const workflow = readFileSync(
    fileURLToPath(new URL("../../../.github/workflows/release-on-prd-close.yml", import.meta.url)),
    "utf8",
  );

  it("fires on issues.closed and nothing else", () => {
    expect(workflow).toMatch(/issues:\s*\n\s*types:\s*\[closed\]/);
  });

  it("gates the job on the same state_reason this connector reads", () => {
    expect(workflow).toContain(`state_reason == '${CLOSE_STATE_REASON}'`);
  });

  it("gates the job on the same prd label this connector reads", () => {
    expect(workflow).toContain(`contains(github.event.issue.labels.*.name, '${PRD_LABEL}')`);
  });

  it("requires both conditions together, not either alone", () => {
    expect(workflow).toMatch(
      new RegExp(
        `if:\\s*github\\.event\\.issue\\.state_reason == '${CLOSE_STATE_REASON}' && contains\\(github\\.event\\.issue\\.labels\\.\\*\\.name, '${PRD_LABEL}'\\)`,
      ),
    );
  });
});
