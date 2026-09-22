import { quoted } from "./ticket-shape.ts";

export const DENIED = [
  "Bash(npm test:*)",
  "Bash(npm run:*)",
  "Bash(npx vitest)",
  "Bash(npx vitest run)",
  "Bash(npx vitest run --config vitest.config.ts)",
  "Bash(bin/check)",
  "Bash(./bin/check)",
  "Bash(git stash:*)",
  "Bash(git checkout:*)",
  "Bash(git switch:*)",
  "Bash(git restore:*)",
  "Bash(git reset:*)",
  "Bash(git rebase:*)",
  "Bash(git merge:*)",
  "Bash(git cherry-pick:*)",
  "Bash(git revert:*)",
  "Bash(git clean:*)",
  "Bash(git mv:*)",
  "Bash(git commit:*)",
  "Bash(git push:*)",
  "Bash(gh:*)",
  "WebFetch",
  "WebSearch",
  "Agent",
  "Task",
  "ScheduleWakeup",
];

const RULE = /^([A-Za-z]+)(?:\((.*)\))?$/;
const PREFIX = ":*";

function stops(rule: string, tool: string, command: string): boolean {
  const [, named, argument] = RULE.exec(rule) ?? [];
  if (named !== tool) return false;
  if (argument === undefined) return true;
  if (!argument.endsWith(PREFIX)) return argument === command;
  const start = argument.slice(0, -PREFIX.length);
  return command === start || command.startsWith(`${start} `);
}

export function deniedBy(tool: string, command = ""): string | undefined {
  return DENIED.find((rule) => stops(rule, tool, command));
}

export function denyFlags(): string[] {
  return ["--disallowedTools", DENIED.join(",")];
}

export function stageRefusals(stage: string, argv: string[]): string[] {
  const listed = new Set((argv[argv.indexOf("--disallowedTools") + 1] ?? "").split(","));
  const through = DENIED.filter((rule) => !listed.has(rule));
  if (through.length === 0) return [];
  return [`${stage} is built without the shared deny list: it lets through ${through.length} of ${DENIED.length}, ${quoted(through.join(", "))}`];
}
