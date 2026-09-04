import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { reason } from "../shared/reason";

const REPO_ROOT = resolve(import.meta.dirname, "../../..");

const SCRIPT = `
import json, sys
sys.path.insert(0, ${JSON.stringify(join(REPO_ROOT, "bin"))})
import ticket_shape
body = sys.stdin.read()
try:
    print(json.dumps({"ok": True, "warnings": ticket_shape.validate("spec", body)}))
except ticket_shape.ValidationError as e:
    print(json.dumps({"ok": False, "error": str(e)}))
`;

export type SpecBodyValidator = (body: string) => string[];

export const validateSpecBody: SpecBodyValidator = (body) => {
  const run = spawnSync("python3", ["-c", SCRIPT], { input: body, encoding: "utf8" });
  if (run.error !== undefined) {
    throw new Error(`the spec validator could not be run: ${reason(run.error)}`);
  }
  if (run.status !== 0) {
    throw new Error(`the spec validator exited ${run.status}: ${run.stderr.trim()}`);
  }

  let verdict: { ok: true; warnings: string[] } | { ok: false; error: string };
  try {
    verdict = JSON.parse(run.stdout) as typeof verdict;
  } catch (err) {
    throw new Error(`the spec validator printed no verdict: ${reason(err)}, ${run.stdout.trim()}`);
  }

  if (!verdict.ok) {
    throw new Error(`refusing to publish a spec body the validator rejects: ${verdict.error}`);
  }
  return verdict.warnings;
};
