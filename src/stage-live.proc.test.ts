import { chmodSync, existsSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { scratch } from "./scenarios.ts";
import { hired } from "./stage.ts";

const HOOKCHECK = `import json, sys
root = sys.argv[sys.argv.index("--root") + 1]
hook = {"type": "command", "command": f"python3 {root}/hooks/no-prose.py"}
print(json.dumps({"hooks": {"PreToolUse": [{"matcher": "Write|Edit", "hooks": [hook]}]}}))
`;

const NO_PROSE = `import sys
sys.stdin.read()
sys.stderr.write("no-prose: say it in code, not prose\\n")
sys.exit(2)
`;

const CLAUDE = `#!/usr/bin/env node
const { spawnSync } = require("child_process");
const { writeFileSync } = require("fs");
const argv = process.argv.slice(2);
const { hooks } = JSON.parse(argv[argv.indexOf("--settings") + 1]);
const input = { tool_name: "Write", tool_input: { file_path: "notes.md", content: "A paragraph of prose." } };
for (const { matcher, hooks: commands } of hooks.PreToolUse ?? []) {
  if (matcher !== undefined && !new RegExp(matcher).test("Write")) continue;
  for (const { command } of commands) {
    const ran = spawnSync("bash", ["-c", command], { input: JSON.stringify(input), encoding: "utf8" });
    if (ran.status === 2) {
      console.log(JSON.stringify({ type: "result", result: "blocked: " + ran.stderr.trim() }));
      process.exit(0);
    }
  }
}
writeFileSync(input.tool_input.file_path, input.tool_input.content);
console.log(JSON.stringify({ type: "result", result: "wrote" }));
`;

function onThisPc(): string {
  const root = scratch("stage-live-");
  const release = join(root, "releases", "a9884a2");
  mkdirSync(join(release, "hooks"), { recursive: true });
  writeFileSync(join(release, "hookcheck.py"), HOOKCHECK);
  writeFileSync(join(release, "hooks", "no-prose.py"), NO_PROSE);
  mkdirSync(join(root, "home", ".agents"), { recursive: true });
  symlinkSync(release, join(root, "home", ".agents", "hooks-live"));
  mkdirSync(join(root, "bin"));
  writeFileSync(join(root, "bin", "claude"), CLAUDE);
  chmodSync(join(root, "bin", "claude"), 0o755);
  vi.stubEnv("HOME", join(root, "home"));
  vi.stubEnv("PATH", `${join(root, "bin")}:${process.env.PATH}`);
  vi.stubEnv("AGENT_HOOKS_SETTINGS", undefined);
  vi.stubEnv("STAGE_MINUTES", undefined);
  return root;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("a stage started on this PC runs under the owner's hooks from the live release (#1096)", () => {
  it("is refused by no-prose when it writes prose, though nothing set AGENT_HOOKS_SETTINGS", () => {
    const root = onThisPc();
    const cwd = process.cwd();
    process.chdir(root);
    try {
      const stage = hired({ name: "reviewer", transcript: join(root, "transcript.jsonl") });
      if (typeof stage === "string") throw new Error(stage);
      const { stdout, refusal } = stage("write the notes");

      expect(refusal).toBeUndefined();
      expect(stdout).toContain("blocked: no-prose: say it in code, not prose");
      expect(existsSync(join(root, "notes.md"))).toBe(false);
    } finally {
      process.chdir(cwd);
    }
  });

  it("refuses to start when nothing set AGENT_HOOKS_SETTINGS and this PC has no live release, rather than run with no owner hooks", () => {
    const root = onThisPc();
    vi.stubEnv("HOME", join(root, "elsewhere"));

    expect(hired({ name: "reviewer", transcript: join(root, "transcript.jsonl") })).toMatch(/hooks-live/);
  });
});
