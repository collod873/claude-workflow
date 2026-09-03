import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { reason } from "../shared/reason";

/**
 * `bin/ticket_shape.py`'s `validate("spec", …)`, called from lane 02's publisher.
 *
 * The session door has always been held to this: `~/bin/file-issue spec` calls it before ever
 * invoking `gh`. Lane 02's `publishSpec` called `gh issue create` directly and checked nothing, so
 * the same body written by a model on a runner landed unvalidated — and a spec whose one criterion
 * is missing, doubled, or unrunnable is one `bin/close-ticket --spec` has no command to close on,
 * discovered weeks later by a closer with nothing to run. This closes that asymmetry.
 *
 * **The real Python, not a port.** `validate(kind, body, repo_root)` is a clean library function,
 * and `shared/ticket-shape.ts` deliberately restates none of its verdicts — #215 found that belief
 * wrong once already. A TypeScript re-implementation would be a second copy of a contract this repo
 * keeps single, and a new drift surface to hold with a third test.
 *
 * **Red-at-publish stays enabled.** The `spec` branch runs the criterion's own check command
 * (ADR-0130). On a runner with nothing installed that command exits non-zero, which reads as *red*,
 * which is accepted — the check simply catches less there than it does on a workstation. What it
 * still catches everywhere is the shape: no criterion, several criteria, or a marker that does not
 * parse.
 */

const REPO_ROOT = resolve(import.meta.dirname, "../../..");

/** Prints `validate`'s verdict as one JSON line: warnings on success, the message on refusal. */
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

/**
 * What `publishSpec` takes its validation as, so a test can hand it a stub instead of spawning an
 * interpreter and running a criterion's command. Returns the validator's warnings; throws on a
 * refusal.
 */
export type SpecBodyValidator = (body: string) => string[];

/**
 * Runs the real validator over `body` and returns whatever it warned about, or throws naming what
 * it refused.
 *
 * An interpreter that cannot be spawned, or a run that crashes rather than printing a verdict,
 * throws too. A validator that quietly returned "no problems" when it had not looked is the one
 * shape a gate may not have (`CONTEXT.md`) — a publisher would then file exactly the body this
 * exists to stop, and report success.
 */
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
    throw new Error(`the spec validator printed no verdict: ${reason(err)} — ${run.stdout.trim()}`);
  }

  if (!verdict.ok) {
    throw new Error(`refusing to publish a spec body the validator rejects: ${verdict.error}`);
  }
  return verdict.warnings;
};
