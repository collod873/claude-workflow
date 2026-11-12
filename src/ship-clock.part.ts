import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BIN, execute, linesIn, plant, scratch, script } from "./scenarios.ts";
import { declarePart } from "./part-files.ts";

const SRC = import.meta.dirname;

export const callerWith = (cron: string) => ["on:", "  schedule:", `    - cron: "${cron}"`, "  workflow_dispatch:", "jobs:", "  ship:", "    uses: collod873/claude-workflow/.github/workflows/ship.yml@main", ""].join("\n");

export function clocking(callers: Record<string, string>, enrolled: string[] = []) {
  const root = scratch("ship-clock-");
  const callersDir = join(root, "callers");
  for (const [repo, text] of Object.entries(callers)) plant(root, `callers/${repo.replace("/", "-")}-ship.yml`, text);
  for (const repo of enrolled) plant(root, `callers/${repo.replace("/", "-")}-machine.yml`, readFileSync(join(SRC, "..", ".github", "caller.yml"), "utf8"));
  script(
    join(root, "bin", "gh"),
    [
      `if [[ $1 == repo ]]; then printf '%s\\n' ${[...new Set(["collod873/Lumaria", ...Object.keys(callers), ...enrolled])].join(" ")}; exit 0; fi`,
      'repo=$(printf %s "$2" | sed -E "s#^repos/([^/]+/[^/]+)/contents/.*#\\1#")',
      'workflow=${2##*/}',
      `file="${callersDir}/\${repo/\\//-}-\${workflow}"`,
      '[[ -f $file ]] || { echo "gh: Not Found (HTTP 404)" >&2; exit 1; }',
      'cat "$file"',
      "",
    ].join("\n"),
  );
  const sudoLog = join(root, "sudo-calls");
  script(join(root, "bin", "sudo"), `{ printf '%s\\n' "$*"; cat; printf '\\n--\\n'; } >>"${sudoLog}"\n`);
  const run = (args: string[] = []) => execute(join(BIN, "ship-clock"), root, { PATH: `${join(root, "bin")}:${process.env.PATH}` }, args);
  return { run, sudo: () => (linesIn(sudoLog).length ? readFileSync(sudoLog, "utf8") : "") };
}

declarePart({
  part: {
    name: "bin/ship-clock",
    file: "bin/ship-clock",
    stops: "https://github.com/collod873/claude-workflow/issues/1692",
    lines: 6,
  },
  scenarios: [
    { label: "installing three apps' ship clocks", run: () => clocking({ "collod873/Mezzanine": callerWith("0 8 * * *"), "collod873/PW-Zone2": callerWith("20 8 * * *"), "collod873/workout-tracker": callerWith("40 8 * * *") }).run() },
    { label: "refusing a cron that is not daily", run: () => clocking({ "collod873/Mezzanine": callerWith("*/15 * * * *") }).run() },
  ],
});
