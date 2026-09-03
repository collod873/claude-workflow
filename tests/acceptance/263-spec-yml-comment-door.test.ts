import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { jobs, topLevelBlock, workflowPath } from "./workflow-shape.fixture";

/**
 * #263, criterion 6. With the round loop gone there is nothing for an answering comment to answer,
 * so the comment door is removed from the workflow: no `issue_comment` trigger, and nothing in any
 * job reading a comment or its author's association.
 *
 * Read as text rather than as a parsed document, and with the file's own prose comments blanked
 * first: this file explains its triggers at length, and a matcher that reads the explanation
 * cannot tell it from the declaration.
 *
 * **Lane 02 is two files now.** ADR-0055 (amended by ADR-0132) republished it as a *reusable*
 * workflow: `spec.yml` declares `on: workflow_call:` and nothing else, and every door it used to
 * open moved to the caller stub beside it, `spec-caller.yml`. A run reached through `uses:` is
 * attributed to the caller, so the stub is where "which events open this lane" is now decided —
 * and it is where an `issue_comment` trigger would have to reappear for the door to be back. Both
 * files are read here: the stub for the trigger, and both for anything that reads a comment,
 * because either half could smuggle the door back in.
 */
function withoutComments(yml: string): string {
  return yml
    .split("\n")
    .map((line) => (line.trimStart().startsWith("#") ? "" : line))
    .join("\n");
}

describe("#263 - spec.yml drops the comment-triggered re-run", () => {
  // "spec.yml no longer routes a comment on a prd issue into lane 02 — check: `npx vitest run .Workflow/agent-workflows/shared/spec-workflow.test.ts`"
  it("spec.yml no longer routes a comment on a prd issue into lane 02 — check: `npx vitest run .Workflow/agent-workflows/shared/spec-workflow.test.ts`", () => {
    const yml = withoutComments(readFileSync(workflowPath("spec.yml"), "utf8"));
    const caller = withoutComments(readFileSync(workflowPath("spec-caller.yml"), "utf8"));

    // The stub really is lane 02's entrance, rather than some other file whose triggers would say
    // nothing about this lane.
    expect(caller, "spec-caller.yml calls spec.yml").toMatch(
      /uses:\s*\S*\.github\/workflows\/spec\.yml@/,
    );

    // The key is written quoted, because YAML 1.1 reads a bare `on` as the boolean true.
    const triggers = topLevelBlock(caller, "on");
    expect(triggers, "spec-caller.yml declares no trigger block").not.toBeNull();

    const lines = (triggers ?? "").split("\n");
    expect(
      lines.some((line) => /^\s*issues\s*:/.test(line)),
      "the label door went with the comment door",
    ).toBe(true);
    expect(lines.filter((line) => /^\s*issue_comment\s*:/.test(line))).toEqual([]);

    // Neither half of the lane names the event, reads a comment off it, or gates on who wrote one.
    for (const [file, text] of [
      ["spec-caller.yml", caller],
      ["spec.yml", yml],
    ] as const) {
      expect(text, `${file} still names issue_comment`).not.toContain("issue_comment");
      expect(text, `${file} still reads github.event.comment`).not.toContain("github.event.comment");
      expect(
        Object.values(jobs(text)).join("\n"),
        `${file} still gates a job on author_association`,
      ).not.toContain("author_association");
    }
  });
});
