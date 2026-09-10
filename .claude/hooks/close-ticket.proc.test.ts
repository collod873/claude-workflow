import { spawnSync } from "node:child_process";
import { expect, test } from "vitest";
import { GH_REPO_SLUG, ghStubHarness, namesRepo, type GhCall } from "./gh-stub-harness";

test.fails("#418.3: close-ticket -R is unchanged by the shared fix", () => {
  const harness = ghStubHarness();
  const script = [
    "import sys",
    `sys.path.insert(0, ${JSON.stringify(harness.binDir)})`,
    "import gh_support",
    `gh = gh_support.bind_gh(${JSON.stringify(harness.gh)}, ${JSON.stringify(GH_REPO_SLUG)})`,
    'view = gh("repo", "view", capture_output=True, text=True)',
    'close = gh("issue", "close", "418", capture_output=True, text=True)',
    "sys.stderr.write(view.stderr + close.stderr)",
    "sys.exit(view.returncode or close.returncode)",
  ].join("\n");

  const run = spawnSync("python3", ["-c", script], { env: harness.env(), encoding: "utf8" });
  const calls: GhCall[] = harness.calls();

  expect(calls.map((call) => call.argv.slice(0, 2))).toEqual([
    ["repo", "view"],
    ["issue", "close"],
  ]);

  expect(calls[0].argv).not.toContain("-R");
  expect(calls[0].argv).not.toContain("--repo");

  for (const call of calls) {
    expect(namesRepo(call), JSON.stringify(call.argv)).toBe(true);
  }

  expect(String(run.stderr)).not.toContain("unknown shorthand flag");
  expect(run.status, String(run.stderr)).toBe(0);
});
