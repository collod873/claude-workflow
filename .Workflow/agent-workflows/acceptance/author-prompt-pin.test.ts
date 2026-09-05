import { describe, expect, it } from "vitest";
import { authoredCriterionTitleRe } from "../shared/affected-tests";
import { promptSource } from "../shared/prompts.fixture";

const PROMPT = promptSource("acceptance/author/prompt.md");

const TITLE_RE = /(?:test|it)\.fails\(\s*["'`]#\d+\.\d+:[^"'`\n]*/g;

const NUMBERED_RE = /#(\d+)\.(\d+):/;

const ISSUE = 4211;

const INDEX = 3;

function mandatedTitles(): string[] {
  const instructions = PROMPT.replace(/```[\s\S]*?```/g, "")
    .replace(/\n\s+/g, " ")
    .replaceAll("{{ISSUE_NUMBER}}", String(ISSUE))
    .replaceAll("<index>", String(INDEX));
  return [...instructions.matchAll(TITLE_RE)].map((match) => match[0]);
}

function workedExample(): string {
  const fenced = [...PROMPT.matchAll(/^```structured-output\n([\s\S]*?)\n```$/gm)];
  const files = fenced.flatMap((match) => (JSON.parse(match[1]) as { files: Array<{ content: string }> }).files);
  return files.map((file) => file.content).join("\n");
}

describe("the criterion title grammar the author prompt mandates", () => {
  it("is the grammar acceptance greps its batch for", () => {
    const titles = mandatedTitles();

    expect(titles.length).toBeGreaterThan(0);
    for (const title of titles) expect(authoredCriterionTitleRe(ISSUE, INDEX).test(title)).toBe(true);
  });

  it("is what the prompt's own worked example writes", () => {
    const example = workedExample();
    const numbered = NUMBERED_RE.exec(example);

    expect(numbered).not.toBeNull();
    const [, issue, index] = numbered as RegExpExecArray;
    expect(authoredCriterionTitleRe(Number(issue), Number(index)).test(example)).toBe(true);
  });
});
