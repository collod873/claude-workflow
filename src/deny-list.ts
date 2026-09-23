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

export const STATIC = "bin/check static";

export function denyFlags(untouchable: string[] = []): string[] {
  return ["--disallowedTools", [...DENIED, ...untouchable.map((path) => `Edit(${path})`)].join(",")];
}

const TOOLS = ["Read", "Edit", "Write", "Grep", "Glob", "Bash"];

const FENCE = [
  "const runs = JSON.parse(process.argv[1]);",
  "let command;",
  'try { command = JSON.parse(require("fs").readFileSync(0, "utf8")).tool_input.command.trim(); } catch {}',
  "if (typeof command === 'string' && runs.includes(command)) process.exit(0);",
  'process.stderr.write("this stage runs only its own commands, each exactly as written: " + runs.join(", ") + "\\n");',
  "process.exit(2);",
].join(" ");

const shellQuoted = (text: string) => `'${text.replaceAll("'", "'\\''")}'`;

function fenced(runs: string[]): string {
  const command = ["node", "-e", FENCE, JSON.stringify(runs)].map(shellQuoted).join(" ");
  return JSON.stringify({ hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command }] }] } });
}

export function stageArgv(commands: string[], untouchable: string[] = []): string[] {
  const runs = [...commands, STATIC, `./${STATIC}`];
  return [
    "--print",
    "--model",
    "sonnet",
    "--setting-sources",
    "",
    "--settings",
    fenced(runs),
    "--tools",
    TOOLS.join(","),
    "--allowedTools",
    ["Read", "Edit", "Write", ...runs.map((command) => `Bash(${command})`)].join(","),
    "--permission-mode",
    "bypassPermissions",
    ...denyFlags(untouchable),
  ];
}

export function stageRefusals(stage: string, argv: string[]): string[] {
  const listed = new Set((argv[argv.indexOf("--disallowedTools") + 1] ?? "").split(","));
  const through = DENIED.filter((rule) => !listed.has(rule));
  if (through.length === 0) return [];
  return [`${stage} is built without the shared deny list: it lets through ${through.length} of ${DENIED.length}, ${quoted(through.join(", "))}`];
}
