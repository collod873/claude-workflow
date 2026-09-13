import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { scratchDir } from "./scratch.fixture";
import {
  assertTicketShape,
  CLAIM_LIMIT,
  extractCriteria,
  extractFilesClaimed,
  parseCheckMarker,
  TicketShapeError,
} from "./ticket-shape";
import { pythonShapeProbes, pythonVerdict, type ShapeProbe } from "./ticket-shape.fixture";

function scratchRepoRoot(): string {
  const dir = scratchDir("ticket-shape-py");
  mkdirSync(join(dir, ".git"), { recursive: true });
  return dir;
}

const CRITERIA_HEADINGS = [null, "## Acceptance criteria", "##  Acceptance criteria", "## Acceptance criteria\t"];

const FILES_HEADINGS = [null, "## Files claimed", "##\tFiles claimed", "##  Files claimed "];

const CHECK_MARKERS = [
  "",
  " — check: `make test`",
  " – check: `make test`",
  " - check: `make test`",
  " -- check: `npm run lint`",
  " — check: make test",
  " — check: `a` `b`",
  " — check: `make test` in the checkout",
  " — check:",
  " — check: `grep -q 'export function x' shared/x.ts`",
  "—check: `make test`",
];

const CRITERIA_COUNTS = [0, 1, 2];

const CLAIM_COUNTS = [0, 1, CLAIM_LIMIT - 1, CLAIM_LIMIT, CLAIM_LIMIT + 1];

const SENTINELS = [
  null,
  "None — no files.",
  "None, no files.",
  "`None, no files.`",
  "none, no files",
  "None no files",
  "Nonexistent, no files.",
  "None of these, no files at all.",
];

const PATH_SPELLINGS: ((index: number) => string)[] = [
  (index) => `src/m${index}.ts`,
  (index) => `\`src/m${index}.ts\``,
  (index) => `.github/workflows/w${index}.yml`,
  (index) => `src/*${index}.ts`,
  (index) => `ghost/m${index}.ts`,
  (index) => `\`.claude/settings${index}.json\``,
];

const NEWLINES = ["\n", "\r\n"];

interface Combo {
  criteriaHeading: string | null;
  filesHeading: string | null;
  marker: string;
  criteriaCount: number;
  claimCount: number;
  sentinel: string | null;
  spelling: number;
  newline: string;
}

function render(combo: Combo): string {
  const lines: string[] = [];
  if (combo.criteriaHeading !== null) {
    lines.push(combo.criteriaHeading, "");
    if (combo.criteriaCount === 0) lines.push("Prose, and not one checkbox.");
    for (let index = 0; index < combo.criteriaCount; index++) {
      lines.push(`- [ ] criterion ${index} lands src/m${index}.ts${combo.marker}`);
    }
    lines.push("");
  }
  if (combo.filesHeading !== null) {
    lines.push(combo.filesHeading, "");
    if (combo.sentinel !== null) lines.push(`- ${combo.sentinel}`);
    for (let index = 0; index < combo.claimCount; index++) {
      lines.push(`- ${PATH_SPELLINGS[combo.spelling](index)}`);
    }
    lines.push("");
  }
  return lines.join(combo.newline);
}

function label(combo: Combo): string {
  return [
    combo.criteriaHeading === null ? "no criteria heading" : `criteria heading ${JSON.stringify(combo.criteriaHeading)}`,
    `${combo.criteriaCount} criteria`,
    `marker ${JSON.stringify(combo.marker)}`,
    combo.filesHeading === null ? "no files heading" : `files heading ${JSON.stringify(combo.filesHeading)}`,
    `sentinel ${JSON.stringify(combo.sentinel)}`,
    `${combo.claimCount} claims as ${JSON.stringify(PATH_SPELLINGS[combo.spelling](0))}`,
    combo.newline === "\n" ? "LF" : "CRLF",
  ].join(", ");
}

function draws(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function grammar(count: number): Combo[] {
  const next = draws(0x51_1c_7e_71);
  const pick = <T,>(values: T[]): T => values[Math.floor(next() * values.length)];
  const seen = new Set<string>();
  const combos: Combo[] = [];
  while (combos.length < count) {
    const combo: Combo = {
      criteriaHeading: pick(CRITERIA_HEADINGS),
      filesHeading: pick(FILES_HEADINGS),
      marker: pick(CHECK_MARKERS),
      criteriaCount: pick(CRITERIA_COUNTS),
      claimCount: pick(CLAIM_COUNTS),
      sentinel: pick(SENTINELS),
      spelling: Math.floor(next() * PATH_SPELLINGS.length),
      newline: pick(NEWLINES),
    };
    const key = label(combo);
    if (seen.has(key)) continue;
    seen.add(key);
    combos.push(combo);
  }
  return combos;
}

function tsProbe(body: string): ShapeProbe {
  let refusal: string | null = null;
  try {
    assertTicketShape(body);
  } catch (err) {
    if (!(err instanceof TicketShapeError)) throw err;
    refusal = err.message;
  }
  return {
    refusal,
    claimed: extractFilesClaimed(body),
    checks: extractCriteria(body).map((criterion) => parseCheckMarker(criterion) ?? null),
  };
}

const GRAMMAR_ROOT = mkdtempSync(join(tmpdir(), "ticket-shape-grammar-"));
afterAll(() => rmSync(GRAMMAR_ROOT, { recursive: true, force: true }));

const COMBOS = grammar(300);
const BODIES = COMBOS.map(render);
const PYTHON = pythonShapeProbes(BODIES, GRAMMAR_ROOT);

describe("every verdict shared/ticket-shape.ts still renders, rendered the same by bin/ticket_shape.py", () => {
  const AXES: [axis: string, values: unknown[], of: (combo: Combo) => unknown][] = [
    ["criteria headings", CRITERIA_HEADINGS, (combo) => combo.criteriaHeading],
    ["files headings", FILES_HEADINGS, (combo) => combo.filesHeading],
    ["check: markers", CHECK_MARKERS, (combo) => combo.marker],
    ["criteria counts", CRITERIA_COUNTS, (combo) => combo.criteriaCount],
    ["claim counts", CLAIM_COUNTS, (combo) => combo.claimCount],
    ["sentinel spellings", SENTINELS, (combo) => combo.sentinel],
    ["path spellings", PATH_SPELLINGS.map((_spelling, index) => index), (combo) => combo.spelling],
    ["line endings", NEWLINES, (combo) => combo.newline],
  ];

  it.each(AXES)("draws every one of the grammar's %s", (_axis, values, of) => {
    const drawn = new Set(COMBOS.map(of));
    expect(values.filter((value) => !drawn.has(value))).toEqual([]);
  });

  it.each(COMBOS.map((combo, index) => [label(combo), index] as const))("%s", (_label, index) => {
    expect(tsProbe(BODIES[index])).toEqual(PYTHON[index]);
  });
});

describe("validate('spec', …), the red-at-publish branch only the Python decides", () => {
  function specBody(command: string): string {
    return [
      "## Acceptance criteria",
      "",
      `- [ ] I'll know it works when I can see a verdict — check: \`${command}\``,
      "",
    ].join("\n");
  }

  it("refuses a spec whose one criterion's check already exits 0 before any work exists", () => {
    const verdict = pythonVerdict("spec", specBody("true"), scratchRepoRoot());

    expect(verdict.ok).toBe(false);
    expect((verdict as { ok: false; error: string }).error).toContain("already true before any work exists");
    expect((verdict as { ok: false; error: string }).error).toContain("`true`");
  });

  it("passes a spec whose criterion is honestly red at filing", () => {
    expect(pythonVerdict("spec", specBody("false"), scratchRepoRoot())).toEqual({ ok: true, warnings: [] });
  });

  it("warns rather than refuses when the check cannot be run to a verdict at all", () => {
    const verdict = pythonVerdict("spec", specBody("sleep 3"), scratchRepoRoot(), { timeoutSeconds: 1 });

    expect(verdict.ok).toBe(true);
    expect((verdict as { ok: true; warnings: string[] }).warnings.join(" ")).toContain("did not finish within");
  });
});
