import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { expect } from "vitest";

/**
 * The real `bin/ticket_shape.py`, run in the real interpreter, for the three suites that hold
 * `shared/ticket-shape.ts` (and everything rendered for it) to what the Python actually decides:
 * `render-body.proc.test.ts`, `ticket-shape.proc.test.ts` and `ticket-contract-drift.proc.test.ts`.
 * A TypeScript restatement of the Python's verdict is exactly the belief #215 found wrong, so none
 * of them carries one — and none of them spawns the interpreter itself, because a `*.test.ts` may
 * not import `node:child_process`.
 *
 * @fixture Reached only from the suites, by design.
 */

const REPO_ROOT = resolve(import.meta.dirname, "../../..");

const IMPORT_TICKET_SHAPE = `
import json, sys
sys.path.insert(0, ${JSON.stringify(join(REPO_ROOT, "bin"))})
import ticket_shape
`;

function withTicketShape(script: string, input = ""): string {
  const run = spawnSync("python3", ["-c", `${IMPORT_TICKET_SHAPE}\n${script}`], { input, encoding: "utf8" });
  expect(run.status, run.stderr).toBe(0);
  return run.stdout;
}

export function commandsPythonRecovers(body: string): (string | null)[] {
  const stdout = withTicketShape(
    `body = sys.stdin.read()
out = []
for block in ticket_shape.criteria_blocks(body) or []:
    box = ticket_shape.CRITERIA_ITEM_RE.match(block)
    text = block[box.end():].strip() if box else block
    out.append(ticket_shape.parse_check_marker(text))
print(json.dumps(out))`,
    body,
  );
  return JSON.parse(stdout) as (string | null)[];
}

export function pythonCheckMarkerDelim(): string {
  return withTicketShape(`print(ticket_shape.CHECK_MARKER_DELIM)`).trim();
}

export function pythonParseCheckMarker(criterion: string): string | null {
  return JSON.parse(withTicketShape(`print(json.dumps(ticket_shape.parse_check_marker(sys.stdin.read())))`, criterion));
}

export type Verdict = { ok: true; warnings: string[] } | { ok: false; error: string };

export type Kind = "note" | "question" | "ticket" | "spec";

export function pythonVerdict(
  kind: Kind,
  body: string,
  repoRoot: string,
  opts: { timeoutSeconds?: number } = {},
): Verdict {
  const stdout = withTicketShape(
    `from pathlib import Path
${opts.timeoutSeconds !== undefined ? `ticket_shape.RED_AT_PUBLISH_TIMEOUT_SECONDS = ${opts.timeoutSeconds}` : ""}
body = sys.stdin.read()
try:
    warnings = ticket_shape.validate(${JSON.stringify(kind)}, body, repo_root=Path(${JSON.stringify(repoRoot)}))
    print(json.dumps({"ok": True, "warnings": warnings}))
except ticket_shape.ValidationError as e:
    print(json.dumps({"ok": False, "error": str(e)}))`,
    body,
  );
  return JSON.parse(stdout) as Verdict;
}
