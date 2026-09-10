import { execFileSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const hooksDir = fileURLToPath(new URL(".", import.meta.url));
const repoRoot =
  [resolve(hooksDir, ".."), resolve(hooksDir, "..", "..")].find((candidate) =>
    existsSync(join(candidate, "bin", "link-workstation")),
  ) ?? resolve(hooksDir, "..");

const DISPATCHER_ENTRY_AS_JSON = [
  "import importlib.machinery, importlib.util, json, sys",
  'loader = importlib.machinery.SourceFileLoader("link_workstation", sys.argv[1])',
  'spec = importlib.util.spec_from_loader("link_workstation", loader)',
  "module = importlib.util.module_from_spec(spec)",
  "loader.exec_module(module)",
  "print(json.dumps(module.dispatcher_entry(sys.argv[2])))",
].join("\n");

function shellWords(command: string, stubBin: string): string[] {
  const stdout = execFileSync("/bin/sh", ["-c", command], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${stubBin}:${process.env.PATH ?? ""}` },
  });
  return stdout.split("\n").filter((word) => word.length > 0);
}

test.fails(
  "#421.1: dispatcher_entry's command parses to exactly python3, the dispatcher path and the event when the hooks directory contains a space",
  () => {
    const scratch = realpathSync(mkdtempSync(join(tmpdir(), "link-workstation-")));
    const cloneRoot = join(scratch, "Claude Projects", "Workflow");
    const script = join(cloneRoot, "bin", "link-workstation");
    mkdirSync(join(cloneRoot, "bin"), { recursive: true });
    mkdirSync(join(cloneRoot, ".claude", "hooks"), { recursive: true });
    copyFileSync(join(repoRoot, "bin", "link-workstation"), script);

    const stubBin = join(scratch, "stub-bin");
    mkdirSync(stubBin);
    const stubPython = join(stubBin, "python3");
    writeFileSync(stubPython, '#!/bin/sh\nprintf "%s\\n" "$@"\n');
    chmodSync(stubPython, 0o755);

    const entry = JSON.parse(
      execFileSync("python3", ["-c", DISPATCHER_ENTRY_AS_JSON, script, "PreToolUse"], {
        encoding: "utf8",
      }),
    );
    const command: string = entry.hooks[0].command;

    expect(shellWords(command, stubBin)).toEqual([
      join(cloneRoot, ".claude", "hooks", "dispatch.py"),
      "PreToolUse",
    ]);
  },
);

test.fails("#421.2: the test suite exercises a clone root containing a space", () => {
  const suite = readFileSync(join(repoRoot, ".claude", "hooks", "test_link_workstation.py"), "utf8");

  expect(suite).toMatch(/Claude Projects|with a space|with space/);
});
