import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { scratch } from "./scenarios.ts";
import { hired } from "./stage.ts";

const HOOKCHECK = `import json, sys
if "--emit-stages" not in sys.argv:
    sys.exit(1)
root = sys.argv[sys.argv.index("--root") + 1]
hook = {"type": "command", "command": f"python3 {root}/hooks/no-prose.py"}
gate = {"type": "command", "command": f"python3 {root}/hooks/check-gate.py"}
every = {"PreToolUse": [{"matcher": "Write|Edit", "hooks": [hook]}]}
print(json.dumps({"hooks": every, "gated": {**every, "Stop": [{"hooks": [gate]}]}}))
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
writeFileSync("stopped-by.txt", JSON.stringify(hooks.Stop ?? []));
writeFileSync("argv.json", JSON.stringify(argv));
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
  vi.stubEnv("AGENT_SKILLS", undefined);
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

  it("gives the gate hooks the release declares gated to a gated stage alone", () => {
    const root = onThisPc();
    const cwd = process.cwd();
    process.chdir(root);
    try {
      const stopped = (gated: boolean) => {
        const stage = hired({ name: "builder", transcript: join(root, "transcript.jsonl"), gated });
        if (typeof stage === "string") throw new Error(stage);
        stage("build it");
        return readFileSync(join(root, "stopped-by.txt"), "utf8");
      };

      expect(stopped(true)).toContain("/hooks/check-gate.py");
      expect(stopped(false)).not.toContain("check-gate");
    } finally {
      process.chdir(cwd);
    }
  });

  it("leaves every prompt it was handed beside its transcript, so the machine logs show what each round was told", () => {
    const root = onThisPc();
    const cwd = process.cwd();
    process.chdir(root);
    try {
      const stage = hired({ name: "builder", transcript: join(root, "fix-7.jsonl") });
      if (typeof stage === "string") throw new Error(stage);
      stage("# Ticket #7\n\nbuild it");
      stage("## How it failed\n\ncheck: red unit");

      const handed = readFileSync(join(root, "fix-7.handed.md"), "utf8");
      expect(handed).toContain("# Ticket #7\n\nbuild it");
      expect(handed).toContain("## How it failed\n\ncheck: red unit");
    } finally {
      process.chdir(cwd);
    }
  });

  it("refuses to start when nothing set AGENT_HOOKS_SETTINGS and this PC has no live release, rather than run with no owner hooks", () => {
    const root = onThisPc();
    vi.stubEnv("HOME", join(root, "elsewhere"));

    expect(hired({ name: "reviewer", transcript: join(root, "transcript.jsonl") })).toMatch(/hooks-live/);
  });

  it("hands a stage the skills it is hired with from the owner's skills, and no others", () => {
    const root = onThisPc();
    for (const name of ["testing", "tdd"]) {
      mkdirSync(join(root, "home", ".agents", "skills", name), { recursive: true });
      writeFileSync(join(root, "home", ".agents", "skills", name, "SKILL.md"), `# ${name}`);
    }
    const cwd = process.cwd();
    process.chdir(root);
    try {
      const stage = hired({ name: "builder", transcript: join(root, "transcript.jsonl"), skills: ["testing"] });
      if (typeof stage === "string") throw new Error(stage);
      stage("build it");

      const argv = JSON.parse(readFileSync(join(root, "argv.json"), "utf8")) as string[];
      const added = join(argv[argv.indexOf("--add-dir") + 1] ?? "", ".claude", "skills");
      expect(readFileSync(join(added, "testing", "SKILL.md"), "utf8")).toBe("# testing");
      expect(readdirSync(added)).toEqual(["testing"]);
    } finally {
      process.chdir(cwd);
    }
  });

  it("refuses to start a stage hired with a skill the owner's skills lack, rather than run without its standard", () => {
    const root = onThisPc();

    expect(hired({ name: "reviewer", transcript: join(root, "transcript.jsonl"), skills: ["testing"] })).toMatch(/testing skill is not in .*\.agents\/skills/);
  });
});
