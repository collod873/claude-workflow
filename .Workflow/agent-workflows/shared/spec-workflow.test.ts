import { describe, expect, it } from "vitest";
import { readWorkflow } from "./read-workflow";

/**
 * `spec.yml`'s trigger must be the same two-sided, owner/`author_association` shape ADR-0073
 * gives `shape.yml` — a label event gated on `github.event.sender` being the repository owner, an
 * `issue_comment` event gated on `author_association`, with the bot exclusion and the
 * `!github.event.issue.pull_request` guard riding along. This reads the workflow's own YAML `if:`
 * rather than grepping the file for strings, so a reformatting that preserves meaning does not
 * fail it, and a reformatting that loses meaning does.
 */

const { workflow } = readWorkflow<{
  jobs: { spec: { if?: string } };
}>("spec.yml");

const condition = workflow.jobs.spec.if ?? "";

describe("spec.yml's trigger, the two-sided owner/author_association shape", () => {
  it("gates the label event on the sender being the repository owner", () => {
    expect(condition).toContain("github.event_name == 'issues'");
    expect(condition).toContain("github.event.label.name == 'to-spec'");
    expect(condition).toContain("github.event.sender.login == github.repository_owner");
  });

  it("gates the issue_comment event on author_association, excluding a bot and a pull request comment", () => {
    expect(condition).toContain("github.event_name == 'issue_comment'");
    expect(condition).toContain("!github.event.issue.pull_request");
    expect(condition).toContain("github.event.comment.user.type != 'Bot'");
    expect(condition).toMatch(
      /contains\(fromJSON\('\["OWNER", "MEMBER", "COLLABORATOR"\]'\),\s*\n?\s*github\.event\.comment\.author_association\)/,
    );
  });

  it("scopes the comment branch to an issue already carrying the prd label", () => {
    expect(condition).toContain("contains(github.event.issue.labels.*.name, 'prd')");
  });

  it("ORs the two sides together, rather than ANDing them into an unfireable condition", () => {
    // Both branches are parenthesized and joined by `||` at the top level — never `&&`, which
    // would require both an `issues` and an `issue_comment` event_name on the same event.
    const orIndex = condition.indexOf(") ||");
    expect(orIndex).toBeGreaterThan(-1);

    const beforeOr = condition.slice(0, orIndex);
    const afterOr = condition.slice(orIndex);
    expect(beforeOr).toContain("github.event_name == 'issues'");
    expect(afterOr).toContain("github.event_name == 'issue_comment'");
  });
});
