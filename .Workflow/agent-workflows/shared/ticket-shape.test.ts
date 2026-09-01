import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  countCriteria,
  extractCriteria,
  isRunnableSpec,
  parseCheckMarker,
  parentPrdNumber,
  TicketShapeError,
  validateTicket,
} from "./ticket-shape";

const heading = "## Acceptance criteria";

describe("isRunnableSpec", () => {
  it("accepts a body with exactly one well-formed check-marked criterion", () => {
    const body = [
      heading,
      "",
      "- [ ] I'll know it works when I can see a verdict on the spec — check: `true`",
      "",
    ].join("\n");

    expect(isRunnableSpec(body)).toBe(true);
  });

  it("rejects a body with no '## Acceptance criteria' heading at all", () => {
    const body = ["## Problem Statement", "Nothing here declares criteria.", ""].join("\n");

    expect(isRunnableSpec(body)).toBe(false);
  });

  it("rejects the heading present with zero '- [ ]' items under it", () => {
    const body = [heading, "", "Some prose and no checkbox at all.", ""].join("\n");

    expect(isRunnableSpec(body)).toBe(false);
  });

  it("rejects two well-formed check-marked criteria — a spec's check runs on exactly one", () => {
    const body = [
      heading,
      "",
      "- [ ] The first thing — check: `true`",
      "- [ ] And the second — check: `true`",
      "",
    ].join("\n");

    expect(isRunnableSpec(body)).toBe(false);
  });

  it("rejects one criterion whose check: marker names no backtick-quoted command", () => {
    const body = [heading, "", "- [ ] I'll know it works — check: true", ""].join("\n");

    expect(isRunnableSpec(body)).toBe(false);
  });

  it("rejects one criterion whose check: marker carries prose after the backticked command", () => {
    const body = [
      heading,
      "",
      "- [ ] I'll know it works — check: `true` and then look at it",
      "",
    ].join("\n");

    expect(isRunnableSpec(body)).toBe(false);
  });

  it("rejects a criterion with no check: marker attempt at all", () => {
    const body = [heading, "", "- [ ] Plain prose, no marker.", ""].join("\n");

    expect(isRunnableSpec(body)).toBe(false);
  });
});

describe("ticket-shape's existing grammar primitives, exercised so this file is a real suite", () => {
  it("countCriteria counts '- [ ]' items and is null when the heading is absent", () => {
    expect(countCriteria([heading, "", "- [ ] one", "- [x] two"].join("\n"))).toBe(2);
    expect(countCriteria("no heading here")).toBeNull();
  });

  it("extractCriteria strips the checkbox and returns the rest verbatim", () => {
    expect(extractCriteria([heading, "", "- [ ] do the thing — check: `true`"].join("\n"))).toEqual([
      "do the thing — check: `true`",
    ]);
  });

  it("parseCheckMarker answers undefined for prose and for a malformed marker alike", () => {
    expect(parseCheckMarker("do the thing")).toBeUndefined();
    expect(parseCheckMarker("do the thing — check: nope")).toBeUndefined();
    expect(parseCheckMarker("do the thing — check: `npm test`")).toBe("npm test");
  });

  it("parentPrdNumber reads the heading render-body.ts writes on every slice", () => {
    expect(parentPrdNumber(["## Parent PRD", "#145", ""].join("\n"))).toBe(145);
    expect(parentPrdNumber("no parent here")).toBeUndefined();
  });
});

/**
 * `validateTicket` is a port of `bin/ticket_shape.py`'s `validate("ticket", body)`, not a
 * re-derivation of the same idea — so nothing here asserts against a second copy of the shape.
 * Every body below is fed to both the real `bin/ticket_shape.py`, in the real interpreter, and to
 * `validateTicket`, and the two verdicts (refuse-or-not, and which warnings) are compared.
 */
describe("validateTicket, driven against the real bin/ticket_shape.py", () => {
  const REPO_ROOT = resolve(import.meta.dirname, "../../..");
  const TICKET_SHAPE_PY = join(REPO_ROOT, "bin");

  const scratch: string[] = [];
  afterEach(() => {
    while (scratch.length) rmSync(scratch.pop()!, { recursive: true, force: true });
  });

  function scratchRepoRoot(existingPaths: string[]): string {
    const dir = mkdtempSync(join(tmpdir(), "ticket-shape-py-"));
    scratch.push(dir);
    mkdirSync(join(dir, ".git"));
    for (const path of existingPaths) {
      const full = join(dir, path);
      mkdirSync(resolve(full, ".."), { recursive: true });
      writeFileSync(full, "");
    }
    return dir;
  }

  /**
   * The real Python validator's verdict: `{ok: true, warnings}` or `{ok: false, error}`, for
   * `kind` — `"ticket"` (compared against `validateTicket` below) or `"spec"` (#306's
   * red-at-publish branch, which has no TypeScript port to compare against, so it is driven for
   * its own sake rather than for a diff).
   *
   * `timeoutSeconds`, when given, overrides `ticket_shape.RED_AT_PUBLISH_TIMEOUT_SECONDS` before
   * `validate` runs — only `"spec"` reads it, and only the timeout-path test below sets it, to
   * keep that one test fast without touching the 30s production budget (ADR-0130).
   */
  function pythonVerdict(
    kind: "ticket" | "spec",
    body: string,
    repoRoot: string,
    opts: { timeoutSeconds?: number } = {},
  ): { ok: true; warnings: string[] } | { ok: false; error: string } {
    const reader = `
import json, sys
sys.path.insert(0, ${JSON.stringify(TICKET_SHAPE_PY)})
import ticket_shape
from pathlib import Path
${opts.timeoutSeconds !== undefined ? `ticket_shape.RED_AT_PUBLISH_TIMEOUT_SECONDS = ${opts.timeoutSeconds}` : ""}
body = sys.stdin.read()
try:
    warnings = ticket_shape.validate(${JSON.stringify(kind)}, body, repo_root=Path(${JSON.stringify(repoRoot)}))
    print(json.dumps({"ok": True, "warnings": warnings}))
except ticket_shape.ValidationError as e:
    print(json.dumps({"ok": False, "error": str(e)}))
`;
    const run = spawnSync("python3", ["-c", reader], { input: body, encoding: "utf8" });
    expect(run.status, run.stderr).toBe(0);
    return JSON.parse(run.stdout);
  }

  /** `validateTicket`'s own verdict, in the same shape as `pythonVerdict`'s, for a side-by-side diff. */
  function tsVerdict(body: string, repoRoot: string): { ok: true; warnings: string[] } | { ok: false; error: string } {
    try {
      return { ok: true, warnings: validateTicket(body, repoRoot) };
    } catch (err) {
      if (err instanceof TicketShapeError) return { ok: false, error: err.message };
      throw err;
    }
  }

  const VALID_BODY = [
    "## Acceptance criteria",
    "",
    "- [ ] `render` is exported from src/render.ts — check: `npm test`",
    "",
    "## Files claimed",
    "- src/render.ts",
    "",
  ].join("\n");

  const CASES: Array<{ label: string; body: string; existingPaths?: string[] }> = [
    { label: "a well-formed ticket with evidence and a resolvable claim", body: VALID_BODY, existingPaths: ["src/render.ts"] },
    {
      label: "missing the Acceptance criteria heading",
      body: ["## Files claimed", "- src/render.ts", ""].join("\n"),
    },
    {
      label: "an Acceptance criteria heading with no checkbox items",
      body: ["## Acceptance criteria", "", "Some prose, no checkbox.", "", "## Files claimed", "- None — no files.", ""].join("\n"),
    },
    {
      label: "missing the Files claimed heading",
      body: ["## Acceptance criteria", "", "- [ ] It works — check: `npm test`", ""].join("\n"),
    },
    {
      label: "no criterion carries evidence",
      body: ["## Acceptance criteria", "", "- [ ] It works.", "", "## Files claimed", "- None — no files.", ""].join("\n"),
    },
    {
      label: "a malformed check: marker (two commands)",
      body: [
        "## Acceptance criteria",
        "",
        "- [ ] It works — check: `npm test` and `npm run lint`",
        "",
        "## Files claimed",
        "- None — no files.",
        "",
      ].join("\n"),
    },
    {
      label: "a claimed path that doesn't resolve",
      body: ["## Acceptance criteria", "", "- [ ] It works — check: `npm test`", "", "## Files claimed", "- src/ghost.ts", ""].join("\n"),
    },
    {
      label: "a migration-shaped body whose criteria are satisfied only by their own artifact",
      body: [
        "## Acceptance criteria",
        "",
        "- [ ] The scrub script exists at scripts/scrub.ts — check: `npx vitest run scripts/scrub.test.ts`",
        "",
        "## Files claimed",
        "- scripts/scrub.ts",
        "",
      ].join("\n"),
      existingPaths: ["scripts/scrub.ts"],
    },
    {
      label: "a migration-shaped body carrying real post-state evidence",
      body: [
        "## Acceptance criteria",
        "",
        "- [ ] `git rev-list --all --objects | grep -c legacy.txt` prints 0 — check: `git rev-list --all --objects | grep -c legacy.txt`",
        "",
        "## Files claimed",
        "- None — no files.",
        "",
      ].join("\n"),
    },
  ];

  it.each(CASES)("$label", ({ body, existingPaths }) => {
    const repoRoot = scratchRepoRoot(existingPaths ?? []);
    expect(tsVerdict(body, repoRoot)).toEqual(pythonVerdict("ticket", body, repoRoot));
  });

  // Red-at-publish (#306, ADR-0130): the one refusal `validate` reaches only for `spec`, by
  // actually running the criterion's `check:` command in `repoRoot` rather than reading it as
  // text. There is no TypeScript port of this branch to compare against — `bin/ticket_shape.py`
  // is the only place it is decided — so `pythonVerdict("spec", …)` above is driven for its own
  // sake rather than for a side-by-side diff, the same reason `close-ticket.test.ts` drives
  // `undelivered`/`fetch_closing_pr` through `inCloseTicket` directly.

  function specBody(command: string): string {
    return [heading, "", `- [ ] I'll know it works when I can see a verdict — check: \`${command}\``, ""].join("\n");
  }

  it("refuses a spec whose one criterion's check already exits 0 before any work exists", () => {
    const repoRoot = scratchRepoRoot([]);

    const verdict = pythonVerdict("spec", specBody("true"), repoRoot);

    expect(verdict.ok).toBe(false);
    expect((verdict as { ok: false; error: string }).error).toContain("already true before any work exists");
    expect((verdict as { ok: false; error: string }).error).toContain("`true`");
  });

  it("passes a spec whose criterion is honestly red at filing", () => {
    const repoRoot = scratchRepoRoot([]);

    expect(pythonVerdict("spec", specBody("false"), repoRoot)).toEqual({ ok: true, warnings: [] });
  });

  it("warns rather than refuses when the check cannot be run to a verdict at all", () => {
    // The 30s production budget (ADR-0130) is overridden to keep this test fast; the shape under
    // test is the timeout path itself, not the specific number of seconds it waits.
    const repoRoot = scratchRepoRoot([]);

    const verdict = pythonVerdict("spec", specBody("sleep 3"), repoRoot, { timeoutSeconds: 1 });

    expect(verdict.ok).toBe(true);
    expect((verdict as { ok: true; warnings: string[] }).warnings.join(" ")).toContain("did not finish within");
  });
});
