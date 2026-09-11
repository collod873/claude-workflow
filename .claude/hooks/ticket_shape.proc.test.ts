import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { touchesWorkstation } from "../../.Workflow/agent-workflows/shared/immutable-set";

type Outcome = { refused: boolean; message: string; warnings: string[] };

type Predicates = { workstation: boolean[]; venue: (string | null)[] };

const DRIVER = `import importlib.util
import json
import sys
from pathlib import Path

here = Path(sys.argv[1]).resolve()
root = next(d for d in (here, *here.parents) if (d / "bin" / "ticket_shape.py").is_file())
spec = importlib.util.spec_from_file_location("ticket_shape", str(root / "bin" / "ticket_shape.py"))
ticket_shape = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ticket_shape)

request = json.loads(sys.stdin.read())
verdict = {"refused": False, "message": "", "warnings": []}
try:
    verdict["warnings"] = list(ticket_shape.validate(request["kind"], request["body"], root))
except ticket_shape.ValidationError as error:
    verdict["refused"] = True
    verdict["message"] = str(error)

print(json.dumps(verdict))
`;

const PREDICATE_DRIVER = `import importlib.util
import json
import sys
from pathlib import Path

here = Path(sys.argv[1]).resolve()
root = next(d for d in (here, *here.parents) if (d / "bin" / "ticket_shape.py").is_file())
spec = importlib.util.spec_from_file_location("ticket_shape", str(root / "bin" / "ticket_shape.py"))
ticket_shape = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ticket_shape)

request = json.loads(sys.stdin.read())
print(json.dumps({
    "workstation": [bool(ticket_shape.is_workstation_path(p)) for p in request["paths"]],
    "venue": [ticket_shape.classify_venue([p]) for p in request["paths"]],
}))
`;

function interpreter(): string {
  return execFileSync("sh", ["-c", "command -v python3"], { encoding: "utf8" }).trim();
}

function runValidate(kind: string, body: string, env: Record<string, string>): Outcome {
  const stdout = execFileSync(interpreter(), ["-c", DRIVER, process.cwd()], {
    input: JSON.stringify({ kind, body }),
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  return JSON.parse(stdout) as Outcome;
}

function runPredicates(paths: string[]): Predicates {
  const stdout = execFileSync(interpreter(), ["-c", PREDICATE_DRIVER, process.cwd()], {
    input: JSON.stringify({ paths }),
    encoding: "utf8",
  });
  return JSON.parse(stdout) as Predicates;
}

function specBody(command: string): string {
  return [
    "## Acceptance criteria",
    "",
    `- [ ] the session brief hands over the next by-hand ticket - check: \`${command}\``,
    "",
  ].join("\n");
}

function homeCarryingHookReport(): string {
  const home = mkdtempSync(join(tmpdir(), "hook-report-home-439-"));
  mkdirSync(join(home, "bin"), { recursive: true });
  const report = join(home, "bin", "hook-report");
  writeFileSync(report, "#!/bin/sh\nexit 1\n");
  chmodSync(report, 0o755);
  return home;
}

test(
  "#439.1: a check marker naming `~/bin/hook-report ...` (path form, executable file) is accepted by validate()",
  () => {
    const home = homeCarryingHookReport();

    const accepted = runValidate("spec", specBody("~/bin/hook-report --days 7"), { HOME: home });
    expect(accepted.refused).toBe(false);
    expect(accepted.warnings.join(" ")).not.toContain("hook-report");

    const missing = runValidate("spec", specBody("~/bin/hook-report-absent --days 7"), {
      HOME: home,
    });
    expect(missing.refused).toBe(true);
    expect(missing.message).toContain("hook-report-absent");
  },
  30000,
);

test(
  "#439.2: a check marker naming `pytest ...` when no `pytest` resolves on PATH is refused, naming the word",
  () => {
    const barePath = mkdtempSync(join(tmpdir(), "no-pytest-path-439-"));

    const outcome = runValidate("spec", specBody("pytest tests/test_session_brief.py"), {
      PATH: barePath,
    });
    expect(outcome.refused).toBe(true);
    expect(outcome.message).toContain("pytest");
  },
  30000,
);

test(
  "#473.2: neither predicate names the bare `.claude/` prefix any more, and both name `.claude/settings`",
  () => {
    const { workstation } = runPredicates([
      ".claude/settings.json",
      ".claude/settings.local.json",
      ".claude/hooks/session-brief.py",
      ".claude",
      "~/bin/hook-report",
    ]);
    expect(workstation).toEqual([true, true, false, false, true]);

    expect(touchesWorkstation([".claude/settings.json"])).toBe(true);
    expect(touchesWorkstation([".claude/settings.local.json"])).toBe(true);
    expect(touchesWorkstation([".claude/hooks/session-brief.py"])).toBe(false);
    expect(touchesWorkstation(["~/bin/hook-report"])).toBe(true);
  },
  30000,
);

test(
  "#473.3: classify_venue returns machine work for a hook-file claim",
  () => {
    const { venue } = runPredicates([
      ".claude/hooks/session-brief.py",
      ".claude/settings.json",
      "vitest.config.ts",
    ]);

    expect(venue[0]).not.toBe("workstation");
    expect(venue[0]).toBeNull();
    expect(venue[1]).toBe("workstation");
    expect(venue[2]).toBe("immutable-set");
  },
  30000,
);
