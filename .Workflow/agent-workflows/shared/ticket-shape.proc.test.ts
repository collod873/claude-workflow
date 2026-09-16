import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, test } from "vitest";
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

const LINE_TERMINATORS: Record<string, string> = {
  LF: "\n",
  CRLF: "\r\n",
  CR: "\r",
  VT: "\v",
  FF: "\f",
  FS: "\u{1c}",
  GS: "\u{1d}",
  RS: "\u{1e}",
  NEL: "\u{85}",
  LS: "\u{2028}",
  PS: "\u{2029}",
};

const MIXED = "mixed";

const NEWLINES = [...Object.values(LINE_TERMINATORS), MIXED];

function newlineName(newline: string): string {
  return (
    Object.entries(LINE_TERMINATORS).find(([, value]) => value === newline)?.[0] ?? MIXED
  );
}

function joinLines(lines: string[], newline: string): string {
  if (newline !== MIXED) return lines.join(newline);
  const cycle = Object.values(LINE_TERMINATORS);
  return lines.reduce(
    (body, line, index) => (index === 0 ? line : body + cycle[index % cycle.length] + line),
    "",
  );
}

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
  return joinLines(lines, combo.newline);
}

function label(combo: Combo): string {
  return [
    combo.criteriaHeading === null ? "no criteria heading" : `criteria heading ${JSON.stringify(combo.criteriaHeading)}`,
    `${combo.criteriaCount} criteria`,
    `marker ${JSON.stringify(combo.marker)}`,
    combo.filesHeading === null ? "no files heading" : `files heading ${JSON.stringify(combo.filesHeading)}`,
    `sentinel ${JSON.stringify(combo.sentinel)}`,
    `${combo.claimCount} claims as ${JSON.stringify(PATH_SPELLINGS[combo.spelling](0))}`,
    newlineName(combo.newline),
  ].join(", ");
}

interface Axis {
  name: string;
  values: unknown[];
  of: (combo: Combo) => unknown;
  with: (combo: Combo, value: unknown) => Combo;
  exercised: (combo: Combo) => boolean;
}

const AXES: Axis[] = [
  {
    name: "criteria headings",
    values: CRITERIA_HEADINGS,
    of: (combo) => combo.criteriaHeading,
    with: (combo, value) => ({ ...combo, criteriaHeading: value as string | null }),
    exercised: () => true,
  },
  {
    name: "files headings",
    values: FILES_HEADINGS,
    of: (combo) => combo.filesHeading,
    with: (combo, value) => ({ ...combo, filesHeading: value as string | null }),
    exercised: () => true,
  },
  {
    name: "check: markers",
    values: CHECK_MARKERS,
    of: (combo) => combo.marker,
    with: (combo, value) => ({ ...combo, marker: value as string }),
    exercised: (combo) => combo.criteriaHeading !== null && combo.criteriaCount > 0,
  },
  {
    name: "criteria counts",
    values: CRITERIA_COUNTS,
    of: (combo) => combo.criteriaCount,
    with: (combo, value) => ({ ...combo, criteriaCount: value as number }),
    exercised: (combo) => combo.criteriaHeading !== null,
  },
  {
    name: "claim counts",
    values: CLAIM_COUNTS,
    of: (combo) => combo.claimCount,
    with: (combo, value) => ({ ...combo, claimCount: value as number }),
    exercised: (combo) => combo.filesHeading !== null,
  },
  {
    name: "sentinel spellings",
    values: SENTINELS,
    of: (combo) => combo.sentinel,
    with: (combo, value) => ({ ...combo, sentinel: value as string | null }),
    exercised: (combo) => combo.filesHeading !== null,
  },
  {
    name: "path spellings",
    values: PATH_SPELLINGS.map((_spelling, index) => index),
    of: (combo) => combo.spelling,
    with: (combo, value) => ({ ...combo, spelling: value as number }),
    exercised: (combo) => combo.filesHeading !== null && combo.claimCount > 0,
  },
  {
    name: "line endings",
    values: NEWLINES,
    of: (combo) => combo.newline,
    with: (combo, value) => ({ ...combo, newline: value as string }),
    exercised: (combo) => combo.criteriaHeading !== null || combo.filesHeading !== null,
  },
];

const AXIS_PAIRS: [Axis, Axis][] = AXES.flatMap((a, index) =>
  AXES.slice(index + 1).map((b): [Axis, Axis] => [a, b]),
);

const FREE_AXES = AXES.filter((axis) => !["criteria headings", "files headings", "criteria counts", "claim counts"].includes(axis.name));

const ENABLERS: Combo[] = CRITERIA_HEADINGS.flatMap((criteriaHeading) =>
  CRITERIA_COUNTS.flatMap((criteriaCount) =>
    FILES_HEADINGS.flatMap((filesHeading) =>
      CLAIM_COUNTS.map((claimCount): Combo => ({
        criteriaHeading,
        filesHeading,
        marker: CHECK_MARKERS[0],
        criteriaCount,
        claimCount,
        sentinel: SENTINELS[0],
        spelling: 0,
        newline: NEWLINES[0],
      })),
    ),
  ),
);

function bothExercised(a: Axis, b: Axis, combo: Combo): boolean {
  return a.exercised(combo) && b.exercised(combo);
}

function reachablePairs(a: Axis, b: Axis): [unknown, unknown][] {
  const pairs: [unknown, unknown][] = [];
  for (const va of a.values) {
    for (const vb of b.values) {
      if (ENABLERS.some((seed) => bothExercised(a, b, a.with(b.with(seed, vb), va)))) {
        pairs.push([va, vb]);
      }
    }
  }
  return pairs;
}

function exercisedPairs(a: Axis, b: Axis, combos: Combo[]): Set<string> {
  const seen = new Set<string>();
  for (const combo of combos) {
    if (bothExercised(a, b, combo)) seen.add(JSON.stringify([a.of(combo), b.of(combo)]));
  }
  return seen;
}

function draws(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

const SEED = Number(process.env.TICKET_SHAPE_SEED ?? 0x51_1c_7e_71) >>> 0;

function grammar(count: number): Combo[] {
  const next = draws(SEED);
  const pick = <T,>(values: T[]): T => values[Math.floor(next() * values.length)];
  const bodies = new Set<string>();
  const combos: Combo[] = [];

  const keep = (combo: Combo): boolean => {
    const body = render(combo);
    if (bodies.has(body)) return false;
    bodies.add(body);
    combos.push(combo);
    return true;
  };

  while (combos.length < count) {
    keep({
      criteriaHeading: pick(CRITERIA_HEADINGS),
      filesHeading: pick(FILES_HEADINGS),
      marker: pick(CHECK_MARKERS),
      criteriaCount: pick(CRITERIA_COUNTS),
      claimCount: pick(CLAIM_COUNTS),
      sentinel: pick(SENTINELS),
      spelling: Math.floor(next() * PATH_SPELLINGS.length),
      newline: pick(NEWLINES),
    });
  }

  for (const [a, b] of AXIS_PAIRS) {
    const covered = exercisedPairs(a, b, combos);
    for (const pair of reachablePairs(a, b)) {
      if (covered.has(JSON.stringify(pair))) continue;
      for (const seed of ENABLERS) {
        let candidate = a.with(b.with(seed, pair[1]), pair[0]);
        if (!bothExercised(a, b, candidate)) continue;
        for (const axis of FREE_AXES) {
          if (axis === a || axis === b) continue;
          candidate = axis.with(candidate, pick(axis.values));
        }
        if (keep(candidate)) break;
      }
      covered.add(JSON.stringify(pair));
    }
  }

  return combos;
}

const COMBOS = grammar(300);
const BODIES = COMBOS.map(render);

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

describe(`every verdict shared/ticket-shape.ts still renders, rendered the same by bin/ticket_shape.py (seed 0x${SEED.toString(16)}, TICKET_SHAPE_SEED overrides)`, () => {
  let repoRoot = "";
  let python: ShapeProbe[] = [];

  beforeAll(() => {
    repoRoot = mkdtempSync(join(tmpdir(), "ticket-shape-grammar-"));
    python = pythonShapeProbes(BODIES, repoRoot);
  });

  afterAll(() => {
    if (repoRoot) rmSync(repoRoot, { recursive: true, force: true });
  });

  const AXIS_CASES: [name: string, axis: Axis][] = AXES.map((axis) => [axis.name, axis]);

  it.each(AXIS_CASES)("%s change the rendered body exactly when this grammar calls them exercised", (_name, axis) => {
    const disagreeing = COMBOS.filter((combo) => {
      const body = render(combo);
      const varies = axis.values.some((value) => render(axis.with(combo, value)) !== body);
      return varies !== axis.exercised(combo);
    });

    expect(disagreeing.map(label)).toEqual([]);
  });

  const PAIR_CASES: [name: string, a: Axis, b: Axis][] = AXIS_PAIRS.map(([a, b]) => [
    `${a.name} × ${b.name}`,
    a,
    b,
  ]);

  it.each(PAIR_CASES)("exercises every reachable %s pair", (_name, a, b) => {
    const exercised = exercisedPairs(a, b, COMBOS);
    const missing = reachablePairs(a, b).filter((pair) => !exercised.has(JSON.stringify(pair)));

    expect(missing).toEqual([]);
  });

  const COMBO_CASES: [label: string, index: number][] = COMBOS.map((combo, index) => [
    label(combo),
    index,
  ]);

  it.each(COMBO_CASES)("%s", (_label, index) => {
    expect(tsProbe(BODIES[index])).toEqual(python[index]);
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
