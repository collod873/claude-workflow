import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect } from "vitest";
import { REPO_ROOT } from "../../../.Workflow/agent-workflows/shared/repo-sources";
import { scratchDir } from "../../../.Workflow/agent-workflows/shared/scratch.fixture";

/**
 * @fixture Reached only from the suite, by design.
 */
const HOOK_LIB_MJS = join(REPO_ROOT, ".claude/hooks/lib/_hook.mjs");

const RUN_ROW_PROBE = `
import { runRow } from ${JSON.stringify(HOOK_LIB_MJS)};

process.stdout.write(
  JSON.stringify(
    runRow(JSON.parse(process.env.PROBE_PAYLOAD), process.env.PROBE_VERDICT, JSON.parse(process.env.PROBE_EXTRA)),
  ),
);
`;

export function runRowThroughSeededLib(
  payload: Record<string, unknown>,
  verdict: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  const probe = join(scratchDir("gauntlet-run-row-probe"), "probe.mjs");
  writeFileSync(probe, RUN_ROW_PROBE);

  const run = spawnSync(process.execPath, [probe], {
    encoding: "utf8",
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      PROBE_PAYLOAD: JSON.stringify(payload),
      PROBE_VERDICT: verdict,
      PROBE_EXTRA: JSON.stringify(extra),
    },
  });

  expect(run.status, run.stderr).toBe(0);
  return JSON.parse(run.stdout) as Record<string, unknown>;
}
