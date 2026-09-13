import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { expect } from "vitest";

/**
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

export interface ShapeProbe {
  refusal: string | null;
  claimed: string[];
  checks: (string | null)[];
}

export function pythonShapeProbes(bodies: string[], repoRoot: string): ShapeProbe[] {
  const stdout = withTicketShape(
    `from pathlib import Path
root = Path(${JSON.stringify(repoRoot)})
out = []
for body in json.loads(sys.stdin.read()):
    try:
        ticket_shape.validate("ticket", body, repo_root=root)
        refusal = None
    except ticket_shape.ValidationError as e:
        refusal = str(e)
    checks = []
    for block in ticket_shape.criteria_blocks(body) or []:
        box = ticket_shape.CRITERIA_ITEM_RE.match(block)
        text = block[box.end():].strip() if box else block
        checks.append(ticket_shape.parse_check_marker(text))
    out.append({
        "refusal": refusal,
        "claimed": ticket_shape.claimed_paths(body),
        "checks": checks,
    })
print(json.dumps(out))`,
    JSON.stringify(bodies),
  );
  return JSON.parse(stdout) as ShapeProbe[];
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
