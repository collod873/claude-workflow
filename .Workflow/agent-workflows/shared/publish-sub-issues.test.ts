import { expect, test } from "vitest";
import type { GhExec } from "./gh";
import type { Plan } from "./plan-schema";
import { publishSubIssues } from "./publish-sub-issues";

const PRD_NUMBER = 434;

const CREATED_ISSUE_URL = "https://github.com/owner/repo/issues/501";

function recordingGh(): { calls: string[][]; gh: GhExec } {
  const calls: string[][] = [];
  const gh: GhExec = (args) => {
    calls.push([...args]);
    if (args[0] === "issue" && args[1] === "create") return `${CREATED_ISSUE_URL}\n`;
    if (args[0] === "api" && args[args.indexOf("--jq") + 1] === ".id") return "9001\n";
    if (args[0] === "api") return "[]";
    return "";
  };
  return { calls, gh };
}

function planClaiming(title: string, filesClaimed: string[]): Plan {
  const criterion =
    "It holds - check: `npx vitest run .Workflow/agent-workflows/shared/publish-sub-issues.test.ts`";
  const build = "Wire the slice.";
  return [
    {
      title,
      dependsOn: [],
      filesClaimed,
      files: filesClaimed,
      whatToBuild: build,
      build,
      acceptanceCriteria: [criterion],
      criteria: [criterion],
      seamsConsumed: [],
      seams: [],
    },
  ] as unknown as Plan;
}

function mentionsByHand(calls: string[][]): boolean {
  return calls.some((call) => call.some((arg) => arg.includes("by-hand")));
}

test.fails("#437.1: publishSubIssues labels `by-hand` when the claim names a workstation or immutable-set path, and labels nothing when it does not", () => {
  for (const claimed of [["vitest.config.ts"], ["~/.claude/settings.json"]]) {
    const workstation = recordingGh();

    publishSubIssues(planClaiming("Rewire the workstation", claimed), PRD_NUMBER, workstation.gh);

    expect(mentionsByHand(workstation.calls), `${claimed[0]} is a claim only a human can build`).toBe(true);
  }

  const ordinary = recordingGh();

  publishSubIssues(
    planClaiming("An ordinary slice", [".Workflow/agent-workflows/shared/gh.ts"]),
    PRD_NUMBER,
    ordinary.gh,
  );

  expect(mentionsByHand(ordinary.calls)).toBe(false);
});
