import { execFileSync } from "node:child_process";
import { test } from "vitest";

test(
  "#582.1: no live document outside docs/adr/ and docs/research/ cites ADR-0010",
  () => {
    execFileSync(
      "bash",
      [
        "-c",
        '! grep -rn "ADR-0010" README.md GOAL.md docs/agents/ .Workflow/agent-workflows/shape/refuter/prompt.md',
      ],
      { cwd: process.cwd() },
    );
  },
);

test("#582.2: docs/agents/venues.md cites ADR-0193", () => {
  execFileSync("grep", ["-q", "ADR-0193", "docs/agents/venues.md"], {
    cwd: process.cwd(),
  });
});

test(
  "#582.3: README and GOAL state the placement rule on live authority",
  () => {
    execFileSync(
      "bash",
      ["-c", 'grep -q "ADR-0193" README.md && grep -q "ADR-0193" GOAL.md'],
      { cwd: process.cwd() },
    );
  },
);
