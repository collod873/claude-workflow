import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ticketFormat } from "../to-tickets/to-tickets";
import { CHECK_MARKER_DELIM, parseCheckMarker } from "./ticket-shape";

/**
 * §3 of #226: the ticket contract used to be written down four times —
 * `bin/ticket_shape.py`, `shared/ticket-shape.ts`, `docs/agents/ticket-format.md`, and
 * `to-tickets/slice/prompt.md` — and only two pairs of those four were ever cross-checked:
 * `render-body.test.ts:147` drives `shared/ticket-shape.ts` (via `render-body.ts`) against the
 * real `bin/ticket_shape.py`, and `ticket-shape-vendor.test.ts` pins `bin/ticket_shape.py`'s
 * own bytes. Neither touches `docs/agents/ticket-format.md` or `to-tickets/slice/prompt.md` at
 * all. This file is what covers all four at once, so a drift in any single one of them —
 * not just between the two already-watched pairs — goes red here.
 */

const REPO_ROOT = resolve(import.meta.dirname, "../../..");
const TICKET_SHAPE_PY_DIR = resolve(REPO_ROOT, "bin");
const TICKET_FORMAT_PATH = resolve(REPO_ROOT, "docs/agents/ticket-format.md");
const SLICE_PROMPT_PATH = resolve(REPO_ROOT, ".Workflow/agent-workflows/to-tickets/slice/prompt.md");

function read(path: string): string {
  return readFileSync(path, "utf8");
}

/** The check-marker delimiter `bin/ticket_shape.py`'s `CHECK_MARKER_DELIM` holds, read live off
 * the module rather than copied into this file — a copy here would be exactly the drift risk
 * this suite exists to catch. */
function pythonCheckMarkerDelim(): string {
  const reader = `
import sys
sys.path.insert(0, ${JSON.stringify(TICKET_SHAPE_PY_DIR)})
import ticket_shape
print(ticket_shape.CHECK_MARKER_DELIM)
`;
  const run = spawnSync("python3", ["-c", reader], { encoding: "utf8" });
  expect(run.status, run.stderr).toBe(0);
  return run.stdout.trim();
}

/** The command `bin/ticket_shape.py`'s `parse_check_marker` recovers from `criterion`, or `null`. */
function pythonParseCheckMarker(criterion: string): string | null {
  const reader = `
import json, sys
sys.path.insert(0, ${JSON.stringify(TICKET_SHAPE_PY_DIR)})
import ticket_shape
print(json.dumps(ticket_shape.parse_check_marker(sys.stdin.read())))
`;
  const run = spawnSync("python3", ["-c", reader], { input: criterion, encoding: "utf8" });
  expect(run.status, run.stderr).toBe(0);
  return JSON.parse(run.stdout);
}

describe("bin/ticket_shape.py and shared/ticket-shape.ts agree on the check-marker delimiter", () => {
  it("hold the exact same CHECK_MARKER_DELIM alternation", () => {
    expect(CHECK_MARKER_DELIM).toBe(pythonCheckMarkerDelim());
  });
});

describe("docs/agents/ticket-format.md's own worked example, read by both parsers", () => {
  it("the check-marker example the doc teaches parses identically in Python and TypeScript", () => {
    const doc = read(TICKET_FORMAT_PATH);
    const example = /^- \[ \] .*— check: `[^`]+`$/m.exec(doc);
    expect(example, "docs/agents/ticket-format.md's check-marker example is missing or moved").not.toBeNull();
    const criterion = example![0].replace(/^- \[ \] /, "");

    expect(parseCheckMarker(criterion)).toBe(pythonParseCheckMarker(criterion));
    expect(parseCheckMarker(criterion)).toBeTruthy();
  });
});

describe("to-tickets/slice/prompt.md carries the injected contract, front to back", () => {
  it("names the {{TICKET_FORMAT}} placeholder the prompt is missing without it", () => {
    expect(read(SLICE_PROMPT_PATH)).toContain("{{TICKET_FORMAT}}");
  });

  it("ticketFormat() draws from docs/agents/ticket-format.md's own spec-sub-issue heading, not a copy of it", () => {
    // Reads docs/agents/ticket-format.md's own current heading text, live, rather than a string
    // literal here — a rename of the variant would otherwise leave this test silently passing
    // against a heading that no longer exists in the doc.
    const doc = read(TICKET_FORMAT_PATH);
    const headingLine = /^### (Spec sub-issue.*)$/m.exec(doc);
    expect(headingLine, "docs/agents/ticket-format.md has no ### Spec sub-issue heading").not.toBeNull();
    expect(ticketFormat()).toContain(headingLine![1]);
  });

  it("the worked example's every criterion parses the same command in Python as in TypeScript", () => {
    const source = read(SLICE_PROMPT_PATH);
    const blocks = [...source.matchAll(/^```structured-output\n([\s\S]*?)\n```$/gm)];
    expect(blocks.length).toBeGreaterThan(0);
    const criteria = blocks.flatMap((match) => {
      const parsed = JSON.parse(match[1]) as { slices: { acceptanceCriteria: string[] }[] };
      return parsed.slices.flatMap((slice) => slice.acceptanceCriteria);
    });
    expect(criteria.length).toBeGreaterThan(0);

    for (const criterion of criteria) {
      expect(parseCheckMarker(criterion)).toBe(pythonParseCheckMarker(criterion));
    }
  });
});
