import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { slice } from "./plan.fixture";
import { renderBody, validateCriteriaShape } from "./render-body";

/**
 * The two ends of one contract, driven against each other.
 *
 * Lane 03 writes a ticket's acceptance criteria through `renderBody`.
 * `bin/close-ticket` is the only thing that ever verifies them: it fetches the
 * body back, parses a command out of each criterion with `bin/ticket_shape.py`,
 * runs it, and closes on what passed. Until #215 neither side had ever seen the
 * other's output — the slicer emitted a bare `check: <command>`, the Python
 * reader read it as prose, and every ticket the chain sliced closed on
 * `0 of N criteria verified` against work nobody had checked (#183).
 *
 * So nothing here asserts against a second copy of the pattern. The rendered
 * body goes through the **real** `bin/ticket_shape.py`, and the refusals go
 * through the **real** `bin/close-ticket` with a stubbed `gh` — because a
 * TypeScript belief about what Python parses is exactly the thing that was
 * wrong.
 */

const REPO_ROOT = resolve(import.meta.dirname, "../../..");
const CLOSE_TICKET = join(REPO_ROOT, "bin/close-ticket");

const scratch: string[] = [];
afterEach(() => {
  while (scratch.length) rmSync(scratch.pop()!, { recursive: true, force: true });
});

function scratchDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  scratch.push(dir);
  return dir;
}

/**
 * Every criterion command `bin/ticket_shape.py` recovers from `body`, in the
 * body's own order — the exact pair of calls `bin/close-ticket`'s
 * `render_record` makes (`criteria_blocks`, then `parse_check_marker` on each
 * block with its checkbox stripped), run in the real interpreter against the
 * real module. `null` for a criterion the reader cannot get a command out of.
 */
function commandsPythonRecovers(body: string): (string | null)[] {
  const reader = `
import json, sys
sys.path.insert(0, ${JSON.stringify(join(REPO_ROOT, "bin"))})
import ticket_shape
body = sys.stdin.read()
out = []
for block in ticket_shape.criteria_blocks(body) or []:
    box = ticket_shape.CRITERIA_ITEM_RE.match(block)
    text = block[box.end():].strip() if box else block
    out.append(ticket_shape.parse_check_marker(text))
print(json.dumps(out))
`;
  const run = spawnSync("python3", ["-c", reader], { input: body, encoding: "utf8" });
  expect(run.status, run.stderr).toBe(0);
  return JSON.parse(run.stdout) as (string | null)[];
}

/**
 * A `gh` that answers `issue view --json body` from a fixed body and records
 * every argv it is called with, so a case can assert what was *not* done —
 * `issue comment` and `issue close` are the two writes a refusal must never
 * reach. Pointed at through `AGENT_SKILLS_GH`, `bin/gh_support.py`'s override,
 * so nothing here touches the real tracker.
 */
function stubGh(body: string): { path: string; calls: () => string[] } {
  const dir = scratchDir("close-ticket-gh-");
  const path = join(dir, "gh");
  const log = join(dir, "calls");
  // The payload is a file the stub `cat`s, never a string interpolated into the
  // stub's own source: a criterion carries backticks by construction, and bash
  // would run one as a command substitution — silently handing close-ticket a
  // body with the marker's quoting removed, which is the very defect under test.
  const payload = join(dir, "body.json");
  writeFileSync(payload, JSON.stringify({ body }));
  writeFileSync(
    path,
    `#!/bin/bash\nprintf '%s\\n' "$*" >> '${log}'\ncat '${payload}'\n`,
  );
  chmodSync(path, 0o755);
  return {
    path,
    calls: () => {
      try {
        return readFileSync(log, "utf8").split("\n").filter(Boolean);
      } catch {
        return [];
      }
    },
  };
}

function closeTicket(body: string): {
  status: number | null;
  stderr: string;
  stdout: string;
  calls: string[];
} {
  const gh = stubGh(body);
  const checkout = scratchDir("close-ticket-checkout-");
  const run = spawnSync("python3", [CLOSE_TICKET, "42", "aaaa..bbbb", checkout], {
    encoding: "utf8",
    env: { ...process.env, AGENT_SKILLS_GH: gh.path },
  });
  return { status: run.status, stderr: run.stderr, stdout: run.stdout, calls: gh.calls() };
}

/** The criteria the slicer's own worked example teaches the model to emit. */
function promptExampleCriteria(promptPath: string): string[] {
  const source = readFileSync(fileURLToPath(new URL(`../${promptPath}`, import.meta.url)), "utf8");
  const blocks = [...source.matchAll(/^```structured-output\n([\s\S]*?)\n```$/gm)];
  return blocks.flatMap((match) => {
    const parsed = JSON.parse(match[1]) as { slices: { acceptanceCriteria: string[] }[] };
    return parsed.slices.flatMap((s) => s.acceptanceCriteria);
  });
}

describe("a published body, read by the script that closes it", () => {
  it("hands the Python reader a command for every criterion it renders", () => {
    const body = renderBody(
      slice({
        title: "Thread the sheet's decisions through gateSpec",
        acceptanceCriteria: [
          "`gateSpec` passes the sheet's decisions to `gateCount` — check: `npx vitest run spec/spec.test.ts`",
          "A held round names every unfiled mark — check: `npx vitest run spec/render.test.ts`",
        ],
      }),
      189,
    );

    expect(commandsPythonRecovers(body)).toEqual([
      "npx vitest run spec/spec.test.ts",
      "npx vitest run spec/render.test.ts",
    ]);
  });

  it("hands it a command for the criteria in the slicer's own worked example", () => {
    const criteria = promptExampleCriteria("to-tickets/slice/prompt.md");
    expect(criteria.length).toBeGreaterThan(0);

    const body = renderBody(slice({ title: "The example", acceptanceCriteria: criteria }), 1);
    expect(commandsPythonRecovers(body)).not.toContain(null);
  });

  it("refuses the shape lane 03 actually emitted, before anything is published", () => {
    const plan = [
      slice({
        title: "Lift readTicket into shared/ticket-shape.ts",
        acceptanceCriteria: [
          "check: grep -q 'export function parentPrdNumber' shared/ticket-shape.ts",
        ],
      }),
    ];

    expect(() => validateCriteriaShape(plan)).toThrow(/names no `check:` marker/);
  });

  it.each([
    ["an unquoted command", "readTicket is exported — check: grep -q readTicket shared/x.ts"],
    ["two backtick spans after the label", "It works — check: `npm test` and `npm run lint`"],
    ["prose after the command", "It works — check: `npm test` in the checkout"],
    ["no marker at all", "readTicket is exported from shared/ticket-shape.ts"],
    ["a wrapped criterion", "readTicket is exported —\ncheck: `npm test`"],
  ])("refuses %s", (_label, criterion) => {
    expect(() => renderBody(slice({ title: "A slice", acceptanceCriteria: [criterion] }), 1))
      .toThrow(/acceptance criterion/);
  });

  it("names every offending slice in one refusal, not just the first", () => {
    const plan = [
      slice({ title: "First", acceptanceCriteria: ["It works."] }),
      slice({ title: "Second", acceptanceCriteria: ["It works — check: `npm test`"] }),
      slice({ title: "Third", acceptanceCriteria: ["check: npm test"] }),
    ];

    expect(() => validateCriteriaShape(plan)).toThrow(/First[\s\S]*Third/);
  });
});

describe("close-ticket, on a body it cannot verify", () => {
  it("reports an unparseable check as a failure, not as an absent one", () => {
    const body = renderBody(
      slice({ title: "Published before #215", acceptanceCriteria: ["It works — check: `npm test`"] }),
      1,
    ).replace("— check: `npm test`", "check: grep -q parentPrdNumber shared/ticket-shape.ts");

    const run = closeTicket(body);

    expect(run.status).not.toBe(0);
    expect(run.stderr).toMatch(/cannot run/);
    expect(run.stdout).toBe("");
    expect(run.calls.some((call) => call.startsWith("issue comment"))).toBe(false);
    expect(run.calls.some((call) => call.startsWith("issue close"))).toBe(false);
  });

  it("does not close a ticket whose every criterion came back unverified", () => {
    const body = [
      "## Acceptance criteria",
      "- [ ] The thing is wired up",
      "- [ ] The other thing is wired up",
      "",
      "## Files claimed",
      "- shared/x.ts",
    ].join("\n");

    const run = closeTicket(body);

    expect(run.status).not.toBe(0);
    expect(run.stderr).toMatch(/every criterion unverified/);
    expect(run.calls.some((call) => call.startsWith("issue close"))).toBe(false);
  });

  it("still closes on a criterion whose command it can run", () => {
    const body = renderBody(
      slice({ title: "A real one", acceptanceCriteria: ["It works — check: `true`"] }),
      1,
    );

    const run = closeTicket(body);

    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout).toContain("1 of 1 criteria verified");
    expect(run.calls.some((call) => call.startsWith("issue close"))).toBe(true);
  });
});
