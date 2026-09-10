import { execFileSync } from "node:child_process";
import { expect, test } from "vitest";

type Outcome = { refused: boolean; message: string; warnings: string[] };

const PROBE = `import json
import sys
import importlib.util
from pathlib import Path

start = Path(sys.argv[1]).resolve()
root = None
for candidate in (start, *start.parents):
    if (candidate / ".claude" / "hooks" / "test_ticket_templates.py").is_file():
        root = candidate
        break
if root is None:
    raise SystemExit("#439: .claude/hooks/test_ticket_templates.py not found above " + str(start))

hooks = root / ".claude" / "hooks"
sys.path.insert(0, str(hooks))


def load(name, path):
    located = importlib.util.spec_from_file_location(name, str(path))
    module = importlib.util.module_from_spec(located)
    located.loader.exec_module(module)
    return module


templates = load("test_ticket_templates", hooks / "test_ticket_templates.py")
shape = load("ticket_shape", root / "bin" / "ticket_shape.py")

example = None
for label, body in templates.variant_cases():
    if label.startswith("Spec sub-issue"):
        example = body
        break
if example is None:
    raise SystemExit("#439: no Spec sub-issue fenced example under '## Variants'")

unresolvable = """## Acceptance criteria

- [ ] the check marker resolves - check: \`no-such-runner-439 --all\`

## Files claimed

- bin/ticket_shape.py
"""


def outcome(candidate_body):
    try:
        passed = list(shape.validate("ticket", candidate_body, root))
    except shape.ValidationError as error:
        return {"refused": True, "message": str(error), "warnings": []}
    return {"refused": False, "message": "", "warnings": passed}


print(json.dumps({"example": outcome(example), "probe": outcome(unresolvable)}))
`;

test.fails(
  "#439.3: the ticket-template test's Spec sub-issue example still validates under the new rule",
  () => {
    const verdict = JSON.parse(
      execFileSync("python3", ["-c", PROBE, process.cwd()], { encoding: "utf8" }),
    ) as { example: Outcome; probe: Outcome };

    const namesTheWord =
      (verdict.probe.refused && verdict.probe.message.includes("no-such-runner-439")) ||
      verdict.probe.warnings.some((warning) => warning.includes("no-such-runner-439"));
    expect(namesTheWord).toBe(true);

    expect(verdict.example.refused).toBe(false);
  },
  30000,
);
