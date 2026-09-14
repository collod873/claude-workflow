import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { scratchDir } from "../../.Workflow/agent-workflows/shared/scratch.fixture";
import { EDIT_TOOLS } from "./gauntlet-report.mjs";

const HOOKS = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HOOKS, "../..");

interface Firing {
  verdict: string;
  argv: string[][];
}

function fire(toolName: string, toolInput: Record<string, string>, projectDir = REPO_ROOT): Firing {
  const dir = scratchDir("gauntlet-turn");
  const calls = join(dir, "calls");
  const stub = join(dir, "gauntlet-stub");
  const record = JSON.stringify(calls);
  writeFileSync(stub, `#!/bin/bash\nprintf '%s\\x1f' "$@" >>${record}\nprintf '\\n' >>${record}\nexit 0\n`);
  chmodSync(stub, 0o755);

  const env = {
    ...process.env,
    GAUNTLET_BIN: stub,
    STOP_GATE_LOG_DIR: dir,
    WORKFLOW_STAGE: "",
    CLAUDE_PROJECT_DIR: "",
  };

  const run = spawnSync(join(HOOKS, "gauntlet.sh"), [], {
    input: JSON.stringify({
      hook_event_name: "PostToolUse",
      cwd: projectDir,
      tool_name: toolName,
      tool_input: toolInput,
    }),
    encoding: "utf8",
    env,
  });
  expect(run.status, run.stderr).toBe(0);

  const rows = readdirSync(dir)
    .filter((name) => name.endsWith(".jsonl"))
    .flatMap((name) => readFileSync(join(dir, name), "utf8").split("\n").filter(Boolean))
    .map((line) => JSON.parse(line));

  return {
    verdict: rows.at(-1)?.verdict ?? "",
    argv: existsSync(calls)
      ? readFileSync(calls, "utf8").split("\n").filter(Boolean).map((line) => line.split("\x1f").filter(Boolean))
      : [],
  };
}

test("#555.3: gauntlet.sh no longer answers to stop", () => {
  const script = readFileSync(join(HOOKS, "gauntlet.sh"), "utf8");

  expect(script.match(/= "stop"/g) ?? []).toEqual([]);
  expect(script).not.toMatch(/\$\{1:-\}"?\s*=\s*"?stop/);
});

describe("#558: what the turn venue fires on, now that dispatch hands it every tool", () => {
  test("the tools it judges are exactly _hook.EDIT_TOOLS, the one roster ADR-0170 defines", () => {
    const python = spawnSync("python3", ["-c", "import _hook, json; print(json.dumps(list(_hook.EDIT_TOOLS)))"], {
      cwd: HOOKS,
      encoding: "utf8",
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
    });
    expect(python.status, python.stderr).toBe(0);

    expect(EDIT_TOOLS).toEqual(JSON.parse(python.stdout));
  });

  for (const tool of ["Edit", "Write", "MultiEdit"]) {
    test(`${tool} on a TypeScript file in this repo runs the gauntlet`, () => {
      const fired = fire(tool, { file_path: `${REPO_ROOT}/a.ts` });

      expect(fired.verdict).toBe("clean");
      expect(fired.argv).toEqual([["turn", `${REPO_ROOT}/a.ts`]]);
    });
  }

  test("NotebookEdit is judged on its notebook_path and stops at scope, not at the tool name", () => {
    const fired = fire("NotebookEdit", { notebook_path: `${REPO_ROOT}/a.ipynb` });

    expect(fired.verdict).toBe("out-of-scope");
    expect(fired.argv).toEqual([]);
  });

  for (const tool of ["Read", "Grep", "Bash", "Task"]) {
    test(`${tool} never reaches the venue, even naming a file the venue would judge`, () => {
      const fired = fire(tool, { file_path: `${REPO_ROOT}/a.ts` });

      expect(fired.verdict).toBe("not-an-edit");
      expect(fired.argv).toEqual([]);
    });
  }
});

describe("#558: the hook dispatch runs lives in one checkout and judges whichever it is handed", () => {
  test("an edit in another enrolled checkout is judged against that checkout's contract", () => {
    const project = scratchDir("gauntlet-elsewhere");
    mkdirSync(join(project, ".claude"), { recursive: true });
    writeFileSync(join(project, ".claude/contract.json"), "{}");

    const fired = fire("Edit", { file_path: `${project}/a.ts` }, project);

    expect(fired.verdict).toBe("clean");
    expect(fired.argv).toEqual([["turn", `${project}/a.ts`]]);
  });

  test("an edit in this checkout is out of scope for a session rooted somewhere else", () => {
    const elsewhere = scratchDir("gauntlet-elsewhere");

    expect(fire("Edit", { file_path: `${REPO_ROOT}/a.ts` }, elsewhere).verdict).toBe("out-of-scope");
  });

  test("a checkout carrying no contract is left alone rather than run against the wrong one", () => {
    const project = scratchDir("gauntlet-unenrolled");

    expect(fire("Edit", { file_path: `${project}/a.ts` }, project).verdict).toBe("no-contract");
  });
});
