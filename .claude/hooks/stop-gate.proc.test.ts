import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const HOOKS = dirname(fileURLToPath(import.meta.url));

const PROBE = [
  "import importlib.util, json, sys",
  "hooks = sys.argv[1]",
  "sys.path.insert(0, hooks)",
  "spec = importlib.util.spec_from_file_location('stop_gate', hooks + '/stop-gate.py')",
  "mod = importlib.util.module_from_spec(spec)",
  "spec.loader.exec_module(mod)",
  "cmd, err, verdict = mod._check_command(json.load(sys.stdin))",
  "print(json.dumps({'slot': mod.SLOT, 'cmd': cmd, 'err': err}))",
].join("\n");

test("#555.4: the stop venue still runs and still reports through stop-gate.py", () => {
  const contract = readFileSync(join(HOOKS, "..", "contract.json"), "utf8");
  const printed = execFileSync("python3", ["-c", PROBE, HOOKS], { input: contract, encoding: "utf8" });
  const lines = printed.split("\n").filter((line) => line.trim().length > 0);
  const probe = JSON.parse(lines.at(-1) ?? "") as { slot: string; cmd: string | null; err: string | null };

  expect(probe.err).toBeNull();
  expect(probe.slot).toBe("stop");
  expect(probe.cmd).toBe("bin/gauntlet stop");

  const why = (JSON.parse(contract) as Record<string, { why?: string }>).stop?.why ?? "";
  expect(why.match(/[\w.-]+\.py/g) ?? []).toContain("stop-gate.py");
});
