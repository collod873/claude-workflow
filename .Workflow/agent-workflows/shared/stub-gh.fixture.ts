import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { onTestFinished } from "vitest";

/**
 * The `gh` double this repo's two close-path suites drive their subject against.
 *
 * `.claude/hooks/close-gate.test.ts` and `shared/close-ticket.test.ts` both spawn a real process
 * — a hook, a CLI — whose only route to the tracker is `bin/gh_support.py`'s `AGENT_SKILLS_GH`
 * override. Each grew its own stub, and the clone gate found them: the same temp dir, the same
 * `printf` script, the same teardown, written twice. Two stubs are also two answers to "what does
 * `gh` do here", and the interesting half — *which calls were never made* — existed in only one
 * of them.
 *
 * @fixture Reached only from the suites, by design. `knip.config.ts` asks whether a lane reaches
 * an export, and no lane may: a stub `gh` on a lane's path would be a lane that never talked to
 * the tracker.
 */

/** A `{ body, comments }` payload as `gh issue view --json body[,comments]` returns it. */
export interface IssuePayload {
  body: string;
  comments?: { body: string; createdAt: string }[];
}

export interface GhStub {
  /** Absolute path to the stub, for `AGENT_SKILLS_GH`. */
  path: string;
  /**
   * Every invocation's arguments, in the order they were made — `["issue", "view", "300", …]`.
   *
   * Read rather than pushed to, because the calls are made by a child process: a spy in this
   * process would see nothing. This is the observable a refusal is asserted on, since "posted
   * nothing, closed nothing" is a claim about calls that did not happen, and the only way to see
   * one of those is to record the ones that did.
   */
  calls: () => string[][];
}

/**
 * A `gh` that answers every call from `payload` and logs each invocation's argv.
 *
 * One canned answer for every subcommand, not a router: each suite's subject makes one *read*
 * (`issue view`) and the rest are writes whose output nobody parses, so a router would be a
 * second, more elaborate belief about a call sequence the log already reports exactly.
 *
 * Removed when the test finishes, pass or fail (`onTestFinished`) — the caller keeps no teardown
 * of its own.
 */
export function stubGh(payload: IssuePayload | string): GhStub {
  const issue: IssuePayload = typeof payload === "string" ? { body: payload } : payload;
  const dir = mkdtempSync(join(tmpdir(), "stub-gh-"));
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }));

  const path = join(dir, "gh");
  const log = join(dir, "argv.jsonl");
  const answer = JSON.stringify(
    JSON.stringify({ body: issue.body, comments: issue.comments ?? [] }),
  );
  // `python3` rather than `jq` to render the argv line: both suites already spawn python3 as a
  // hard dependency, and jq is not on every runner.
  writeFileSync(
    path,
    `#!/bin/bash\npython3 -c 'import json,sys; print(json.dumps(sys.argv[1:]))' "$@" >> ${JSON.stringify(log)}\nprintf '%s' ${answer}\n`,
  );
  chmodSync(path, 0o755);

  return {
    path,
    calls: () => {
      let text = "";
      try {
        text = readFileSync(log, "utf8");
      } catch {
        // No log at all means no invocation — the shape a refusal that never reached `gh` takes.
        return [];
      }
      return text
        .split("\n")
        .filter((line) => line.trim() !== "")
        .map((line) => JSON.parse(line) as string[]);
    },
  };
}
