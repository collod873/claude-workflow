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

    // The key is written quoted, because YAML 1.1 reads a bare `on` as the boolean true.
    const triggers = topLevelBlock(yml, "on");
    expect(triggers, "spec.yml declares no trigger block").not.toBeNull();

    const lines = (triggers ?? "").split("\n");
    expect(
      lines.some((line) => /^\s*issues\s*:/.test(line)),
      "the label door went with the comment door",
    ).toBe(true);
    expect(lines.filter((line) => /^\s*issue_comment\s*:/.test(line))).toEqual([]);

    expect(yml).not.toContain("issue_comment");
    expect(yml).not.toContain("github.event.comment");
    expect(Object.values(jobs(yml)).join("\n")).not.toContain("author_association");
  });
});
