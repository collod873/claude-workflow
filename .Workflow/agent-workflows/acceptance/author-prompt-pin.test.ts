import { describe, expect, it, test } from "vitest";
import { authoredTicketTitleRe } from "../shared/affected-tests";
import { promptSource } from "../shared/prompts.fixture";
import { HOUSE_RULES_PATH } from "./acceptance";

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
  return [...PROMPT.matchAll(/^```ts\n([\s\S]*?)\n```$/gm)].map((match) => match[1]).join("\n");
}

function houseRulesSource(): string {
  return promptSource(HOUSE_RULES_PATH.replace(".Workflow/agent-workflows/", ""));
}

describe("the criterion title grammar the author prompt mandates", () => {
  it("is the grammar acceptance greps its batch for", () => {
    const titles = mandatedTitles();

    expect(titles.length).toBeGreaterThan(0);
    for (const title of titles) {
      expect(authoredTicketTitleRe(ISSUE).test(title)).toBe(true);
      expect(NUMBERED_RE.exec(title)?.slice(1)).toEqual([String(ISSUE), String(INDEX)]);
    }
  });

  it("is what the prompt's own worked example writes", () => {
    const example = workedExample();
    const numbered = NUMBERED_RE.exec(example);

    expect(numbered).not.toBeNull();
    const [, issue, index] = numbered as RegExpExecArray;
    expect(authoredTicketTitleRe(Number(issue)).test(example)).toBe(true);
    expect(Number(index)).toBeGreaterThan(0);
  });
});

describe("the house rules the author prompt hands the author", () => {
  test("#448.1: a hook, a bin/ script or a check-marker program gets no stub, and Python is a .proc.test.ts", () => {
    const rules = houseRulesSource().replace(/\s+/g, " ");

    expect(rules).toContain(".claude/hooks/");
    expect(rules).toContain("bin/");
    expect(rules).toContain(".proc.test.ts");
    expect(rules).toMatch(/\b(?:no|never|not|without)\b[^.]{0,200}stub|stub[^.]{0,200}\b(?:never|not)\b/i);
    expect(rules).toMatch(/python/i);
    expect(rules).toMatch(/check[ -]?marker|check:/i);
  });
});
