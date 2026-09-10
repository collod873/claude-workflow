import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const SUBJECT =
  [resolve(HERE, "../bin/ticket_shape.py"), resolve(HERE, "../../bin/ticket_shape.py")].find(
    (candidate) => existsSync(candidate),
  ) ?? resolve(HERE, "../bin/ticket_shape.py");

const PROBE = [
  "import importlib.util, json, sys",
  "spec = importlib.util.spec_from_file_location('ticket_shape', sys.argv[1])",
  "module = importlib.util.module_from_spec(spec)",
  "spec.loader.exec_module(module)",
  "paths = json.loads(sys.argv[2])",
  "print(json.dumps({",
  "    'venue': {p: module.classify_venue([p]) for p in paths},",
  "    'immutable': {p: module.touches_immutable_set([p]) for p in paths},",
  "}))",
].join("\n");

type Classification = {
  venue: Record<string, string | null>;
  immutable: Record<string, string[]>;
};

function classify(paths: string[]): Classification {
  const out = execFileSync("python3", ["-c", PROBE, SUBJECT, JSON.stringify(paths)], {
    cwd: dirname(dirname(SUBJECT)),
    encoding: "utf8",
  });
  return JSON.parse(out) as Classification;
}

test(
  "#438.2: ticket_shape's venue predicate classifies a home-dir or `.claude/` settings path as workstation, independent of immutable-set",
  () => {
    const homeDir = "~/.claude/settings.json";
    const claudeSettings = ".claude/settings.json";
    const ordinary = "src/router.ts";

    const result = classify([homeDir, claudeSettings, ordinary]);

    expect(result.venue[homeDir]).toBe("workstation");
    expect(result.venue[claudeSettings]).toBe("workstation");
    expect(result.immutable[homeDir]).toEqual([]);
    expect(result.venue[ordinary]).not.toBe("workstation");
  },
);
