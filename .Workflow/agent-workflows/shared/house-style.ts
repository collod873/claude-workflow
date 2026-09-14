export const STYLE_RULES_HEADING = "## Style rules the gauntlet enforces and cannot fix for you";

export const STYLE_RULES = [
  "- Code carries no prose: no comments, no docstrings, no explanatory headers, in any language, tests included (ADR-0151). The why goes in the commit message. The prose gate holds the count at zero.",
  "- A test that drives a process is named `*.proc.test.ts`; every other test imports its subject and calls it.",
  "- A test may not read tracked source, YAML or Markdown as text; import the constant the subject exports.",
  "- One fake gh: import it from `shared/gh.fake.ts` or `shared/stub-gh.fixture.ts`, never define your own.",
  "- Narrow an error with `reason(err)` or `errorMessage(err)` from `shared/reason.ts`, never inline `instanceof Error`.",
  "- Quote style, spacing and other mechanical findings are autofixed by the gauntlet before it judges; do not spend turns on them.",
].join("\n");

export const CHECK_CONTRACT_HEADING = "## What the gauntlet runs here, slot by slot";

export const CHECK_CONTRACT_LEAD = [
  "Iterate with `bin/gauntlet stop`, which runs the turn-venue slots on what you changed. The push",
  "gate that judges this run is the `all` slot, run once by the wire after you answer; you do not run",
  "it yourself. These commands are settled, so reach for this list rather than rediscovering it from",
  "`.claude/contract.json`, `bin/gauntlet` or `package.json`.",
].join("\n");

export const AUTHOR_CHECK_CONTRACT_LEAD = [
  "These are the checks your batch is judged against. You cannot run them: you have no tools but",
  "the one you answer through. They are here so you write a batch that passes them the first time,",
  "rather than discovering them from a red judgement you get one round to repair.",
].join("\n");
