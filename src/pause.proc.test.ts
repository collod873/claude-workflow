import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { PAUSED_HEAD, pausing } from "./pause.part.ts";

const merges = (calls: string[][]) => calls.filter((args) => args[0] === "pr" && args[1] === "merge");
const wakes = (calls: string[][]) => calls.filter((args) => args[0] === "workflow" && args[1] === "run");

function resumedWithoutBuilding(scenario: ReturnType<typeof pausing>): string[][] {
  const result = scenario.resume();
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toBe("builds=false\n");
  return scenario.calls();
}

describe("bin/pause stops a paused ticket's PR merging (#1174)", () => {
  it("turns auto-merge off on the ticket's open PR, so neither GitHub nor the closer merges it", () => {
    const { calls, pause } = pausing();

    const result = pause();

    expect(result.status, result.stderr).toBe(0);
    expect(merges(calls())).toEqual([["pr", "merge", "931", "--disable-auto"]]);
    expect(result.stdout.trim().split("\n")).toEqual([expect.stringContaining("auto-merge off")]);
  });

  it("changes nothing when the ticket has no PR, or its PR already has auto-merge off", () => {
    for (const scenario of [pausing({ pr: "none" }), pausing({ autoMerge: false })]) {
      const result = scenario.pause();

      expect(result.status, result.stderr).toBe(0);
      expect(merges(scenario.calls())).toEqual([]);
    }
  });

  it("ends red at unread when the PR cannot be read, and ends red naming the refusal when GitHub keeps auto-merge on", () => {
    expect(pausing({ pr: "unreadable" }).pause()).toEqual({ status: 1, stdout: "", stderr: "pause: the PR of #811 could not be read, so its auto-merge is left as it is\n" });
    const refused = pausing({ refused: "GraphQL: Resource not accessible by integration" }).pause();
    expect(refused.status).toBe(1);
    expect(refused.stderr).toContain("Resource not accessible by integration");
  });
});

describe("bin/resume picks a ticket up from where it stands once paused or stuck comes off (#1174)", () => {
  it("has the job build a ticket with no PR, as taking waiting off does", () => {
    const { calls, resume } = pausing({ pr: "none" });

    const result = resume();

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe("builds=true\n");
    expect([...merges(calls()), ...wakes(calls())]).toEqual([]);
  });

  it("does nothing for a ticket whose PR already merged or was closed, so no fresh build starts beside it", () => {
    for (const state of ["MERGED", "CLOSED"]) {
      const calls = resumedWithoutBuilding(pausing({ state }));

      expect([...merges(calls), ...wakes(calls)], state).toEqual([]);
    }
  });

  it("wakes the builder on a red PR, so its session resumes on it, and builds nothing new", () => {
    const calls = resumedWithoutBuilding(pausing({ pr: "red" }));

    expect(merges(calls)).toEqual([]);
    expect(wakes(calls)).toEqual([["workflow", "run", "fix.yml", "-f", "ticket=811", "-f", expect.stringMatching(/^reason=.*PR #931 red at 4f2a9c1e/)]]);
  });

  it("wakes the builder with exactly the inputs fix.yml and the caller file declare, which fix.yml hands the builder as its reason beside the session it saved for the branch", () => {
    const [wake] = wakes(resumedWithoutBuilding(pausing({ pr: "red" })));
    const sent = (wake ?? []).filter((arg) => arg.includes("=")).map((arg) => arg.split("=")[0]);
    const github = join(import.meta.dirname, "..", ".github");
    const declared = (file: string) => Object.keys((parse(readFileSync(join(github, file), "utf8")) as { on: { workflow_dispatch: { inputs: Record<string, unknown> } } }).on.workflow_dispatch.inputs);
    const fix = readFileSync(join(github, "workflows", "fix.yml"), "utf8");

    expect(sent).toEqual(declared("workflows/fix.yml"));
    expect(sent).toEqual(declared("caller.yml"));
    expect(fix).toContain("REASON: ${{ github.event.inputs.reason }}");
    expect(fix).toContain("restore-keys: builder-${{ env.HEAD_REF }}-");
  });

  it("wakes the builder through the caller file in a repo that calls the machine", () => {
    const { calls, resume } = pausing({ pr: "red", calledFrom: "collod873/Lumaria/.github/workflows/machine.yml@refs/heads/main" });

    expect(resume().status).toBe(0);
    expect(wakes(calls()).map((args) => args[2])).toEqual(["machine.yml"]);
  });

  it("turns auto-merge back on at the head of a green or still-checking PR, so the closer's queue takes it", () => {
    for (const pr of ["green", "pending"] as const) {
      const calls = resumedWithoutBuilding(pausing({ pr, autoMerge: false }));

      expect(merges(calls)).toEqual([["pr", "merge", "931", "--auto", "--merge", "--match-head-commit", PAUSED_HEAD]]);
      expect(wakes(calls)).toEqual([]);
    }
  });

  it("ends red, building nothing, when the PR cannot be read or GitHub refuses the resume", () => {
    expect(pausing({ pr: "unreadable" }).resume()).toEqual({ status: 1, stdout: "", stderr: "resume: the PR of #811 could not be read, so nothing resumes\n" });
    for (const pr of ["green", "red"] as const) {
      const refused = pausing({ pr, refused: "GraphQL: Resource not accessible by integration" }).resume();
      expect(refused.status).toBe(1);
      expect(refused.stdout).toBe("");
      expect(refused.stderr).toContain("Resource not accessible by integration");
    }
  });
});
