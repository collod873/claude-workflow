import { createRequire } from "node:module";
import { expect, test } from "vitest";
import { retirementBody as deadLaneRetirementBody, type RunSummary } from "../watchdog/dead-lanes";
import { retirementBody as unreachableRetirementBody } from "./unreachable";

interface ClosingRecordRules {
  heading: string;
  noDiff: string;
  grammar: unknown;
}

interface Grammar {
  key: string;
  pattern: string;
}

const loadJson = createRequire(import.meta.url);

const RANGE_LINE = "`3fc1769..7f9d443`";

const BULLET_LINE = "- a criterion (MET: `true` exit 0)";

const SUPERSEDED_LINE = "Superseded by #123";

const LANE = ".github/workflows/verify-caller.yml";

const LIVE_RUN: RunSummary = {
  id: 4242,
  name: "Verify",
  path: LANE,
  status: "completed",
  conclusion: "success",
  htmlUrl: "https://github.com/example/example/actions/runs/4242",
  headBranch: "main",
  createdAt: "2026-09-14T09:00:00Z",
  jobCount: 3,
};

function rules(): ClosingRecordRules {
  return loadJson("./closing-record.rules.json") as ClosingRecordRules;
}

function grammars(value: unknown, key = ""): Grammar[] {
  if (typeof value === "string") return [{ key, pattern: value }];
  if (Array.isArray(value)) {
    return (value as unknown[]).flatMap((item, index) => grammars(item, `${key}.${index}`));
  }
  if (value !== null && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).flatMap(([name, item]) =>
      grammars(item, key === "" ? name : `${key}.${name}`),
    );
  }
  return [];
}

function matches(pattern: string, text: string): boolean {
  try {
    return new RegExp(pattern, "m").test(text);
  } catch {
    return false;
  }
}

function spells(source: ClosingRecordRules, named: RegExp, sample: string): boolean {
  return grammars(source.grammar).some((entry) => named.test(entry.key) || matches(entry.pattern, sample));
}

function spelling(source: ClosingRecordRules, sample: string): string[] {
  return grammars(source.grammar)
    .filter((entry) => matches(entry.pattern, sample))
    .map((entry) => entry.pattern);
}

function meaningful(pattern: string): boolean {
  return /[\\^$()|*+?{}[\]]/.test(pattern);
}

function recordLines(body: string): string[] {
  return body.split("\n").filter((line) => line.trim() !== "");
}

test("#556.1: the rules source spells the heading, No diff. sentinel and three ASCII-explicit grammars", () => {
  const source = rules();
  expect(source.heading).toContain("Closing record");
  expect(source.noDiff).toContain("No diff.");
  expect(grammars(source.grammar).length).toBeGreaterThanOrEqual(3);
  expect(spells(source, /range/i, RANGE_LINE)).toBe(true);
  expect(spells(source, /bullet/i, BULLET_LINE)).toBe(true);
  expect(spells(source, /supersed/i, SUPERSEDED_LINE)).toBe(true);
  const record = [
    ...spelling(source, RANGE_LINE),
    ...spelling(source, BULLET_LINE),
    ...spelling(source, SUPERSEDED_LINE),
  ];
  for (const pattern of record) {
    expect(pattern).not.toMatch(/\\[dDwWsS]/);
  }
});

test("#556.3: the writers read the heading and No diff. sentinel from the rules source", () => {
  const source = rules();
  const written = [unreachableRetirementBody(), deadLaneRetirementBody(LANE, LIVE_RUN)];
  expect(written.length).toBe(2);
  for (const body of written) {
    const lines = recordLines(body);
    expect(lines[0]).toBe(source.heading);
    expect(lines[1]).toBe(source.noDiff.trim());
  }
});

test("#556.6: the check contract holds: every grammar compiles and no line means two things", () => {
  const source = rules();
  const all = grammars(source.grammar);
  expect(all.length).toBeGreaterThanOrEqual(3);
  for (const entry of all) {
    if (!meaningful(entry.pattern)) continue;
    expect(() => new RegExp(entry.pattern, "m")).not.toThrow();
  }
  expect(source.heading).not.toBe(source.noDiff);
  for (const pattern of spelling(source, RANGE_LINE)) {
    expect(matches(pattern, `- ${RANGE_LINE}`)).toBe(false);
    expect(matches(pattern, source.heading)).toBe(false);
  }
  for (const pattern of spelling(source, BULLET_LINE)) {
    expect(matches(pattern, RANGE_LINE)).toBe(false);
    expect(matches(pattern, source.heading)).toBe(false);
  }
  for (const pattern of spelling(source, SUPERSEDED_LINE)) {
    expect(matches(pattern, `- ${SUPERSEDED_LINE}`)).toBe(false);
    expect(matches(pattern, source.heading)).toBe(false);
  }
});
