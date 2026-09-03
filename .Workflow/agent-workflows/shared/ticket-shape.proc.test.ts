import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { scratchDir } from "./scratch.fixture";
import { TicketShapeError, validateTicket } from "./ticket-shape";
import { pythonVerdict, type Verdict } from "./ticket-shape.fixture";

/**
 * `validateTicket` is a port of `bin/ticket_shape.py`'s `validate("ticket", body)`, not a
 * re-derivation of the same idea — so nothing here asserts against a second copy of the shape.
 * Every body below is fed to both the real `bin/ticket_shape.py`, in the real interpreter
 * (`ticket-shape.fixture.ts`), and to `validateTicket`, and the two verdicts (refuse-or-not, and
 * which warnings) are compared.
 */

const heading = "## Acceptance criteria";

/** A directory shaped like a repository root — a `.git/` and `existingPaths` as empty files — for the claim-resolution half of `validate`. */
function scratchRepoRoot(existingPaths: string[]): string {
  const dir = scratchDir("ticket-shape-py");
  mkdirSync(join(dir, ".git"));
  for (const path of existingPaths) {
    const full = join(dir, path);
    mkdirSync(resolve(full, ".."), { recursive: true });
    writeFileSync(full, "");
  }
  return dir;
}

/** `validateTicket`'s own verdict, in the same shape as `pythonVerdict`'s, for a side-by-side diff. */
function tsVerdict(body: string, repoRoot: string): Verdict {
  try {
    return { ok: true, warnings: validateTicket(body, repoRoot) };
  } catch (err) {
    if (err instanceof TicketShapeError) return { ok: false, error: err.message };
    throw err;
  }
}

/** A body with `criteria` under the heading and `claims` under Files claimed. */
function body(criteria: string[], claims: string[] = ["None — no files."]): string {
  return [heading, "", ...criteria, "", "## Files claimed", ...claims.map((c) => `- ${c}`), ""].join("\n");
}

describe("validateTicket, driven against the real bin/ticket_shape.py", () => {
  const CASES: Array<{ label: string; body: string; existingPaths?: string[] }> = [
    {
      label: "a well-formed ticket with evidence and a resolvable claim",
      body: body(["- [ ] `render` is exported from src/render.ts — check: `make test`"], ["src/render.ts"]),
      existingPaths: ["src/render.ts"],
    },
    { label: "missing the Acceptance criteria heading", body: ["## Files claimed", "- src/render.ts", ""].join("\n") },
    { label: "an Acceptance criteria heading with no checkbox items", body: body(["Some prose, no checkbox."]) },
    { label: "missing the Files claimed heading", body: [heading, "", "- [ ] It works — check: `make test`", ""].join("\n") },
    { label: "no criterion carries evidence", body: body(["- [ ] It works."]) },
    { label: "a malformed check: marker (two commands)", body: body(["- [ ] It works — check: `make test` and `npm run lint`"]) },
    { label: "a claimed path that doesn't resolve", body: body(["- [ ] It works — check: `make test`"], ["src/ghost.ts"]) },
    {
      label: "a migration-shaped body whose criteria are satisfied only by their own artifact",
      body: body(
        ["- [ ] The scrub script exists at scripts/scrub.ts — check: `npx vitest --run scripts/scrub.test.ts`"],
        ["scripts/scrub.ts"],
      ),
      existingPaths: ["scripts/scrub.ts"],
    },
    {
      label: "a migration-shaped body carrying real post-state evidence",
      body: body([
        "- [ ] `git rev-list --all --objects | grep -c legacy.txt` prints 0 — check: `git rev-list --all --objects | grep -c legacy.txt`",
      ]),
    },
  ];

  it.each(CASES)("$label", ({ body: ticket, existingPaths }) => {
    const repoRoot = scratchRepoRoot(existingPaths ?? []);
    expect(tsVerdict(ticket, repoRoot)).toEqual(pythonVerdict("ticket", ticket, repoRoot));
  });
});

/**
 * Red-at-publish (#306, ADR-0130): the one refusal `validate` reaches only for `spec`, by actually
 * running the criterion's `check:` command in `repoRoot` rather than reading it as text. There is
 * no TypeScript port of this branch to compare against — `bin/ticket_shape.py` is the only place
 * it is decided — so `pythonVerdict("spec", …)` is driven for its own sake rather than for a
 * side-by-side diff, the same reason `close-ticket.proc.test.ts` drives `undelivered` and
 * `fetch_closing_pr` through `inCloseTicket` directly.
 */
describe("validate('spec', …), the red-at-publish branch only the Python decides", () => {
  function specBody(command: string): string {
    return [heading, "", `- [ ] I'll know it works when I can see a verdict — check: \`${command}\``, ""].join("\n");
  }

  it("refuses a spec whose one criterion's check already exits 0 before any work exists", () => {
    const verdict = pythonVerdict("spec", specBody("true"), scratchRepoRoot([]));

    expect(verdict.ok).toBe(false);
    expect((verdict as { ok: false; error: string }).error).toContain("already true before any work exists");
    expect((verdict as { ok: false; error: string }).error).toContain("`true`");
  });

  it("passes a spec whose criterion is honestly red at filing", () => {
    expect(pythonVerdict("spec", specBody("false"), scratchRepoRoot([]))).toEqual({ ok: true, warnings: [] });
  });

  it("warns rather than refuses when the check cannot be run to a verdict at all", () => {
    // The 30s production budget (ADR-0130) is overridden to keep this test fast; the shape under
    // test is the timeout path itself, not the specific number of seconds it waits.
    const verdict = pythonVerdict("spec", specBody("sleep 3"), scratchRepoRoot([]), { timeoutSeconds: 1 });

    expect(verdict.ok).toBe(true);
    expect((verdict as { ok: true; warnings: string[] }).warnings.join(" ")).toContain("did not finish within");
  });
});
