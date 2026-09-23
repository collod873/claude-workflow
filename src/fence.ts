export const STATIC = "bin/check static";

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

const OWNER_HOOKS = [
  "credential-scan",
  "em-dash",
  "module-depth",
  "no-prose",
  "test-weaken",
  "context-lint",
  "post-edit-validate",
  "stale-ref",
  "dead-path",
  "log-stop-failure",
  "session-capture",
];

export type Registration = Record<string, { matcher?: string; hooks: { command: string }[] }[]>;

const isOwnerHook = (command: string) => OWNER_HOOKS.some((name) => command.includes(`/hooks/${name}.py`));

export function ownerHooks(registered: Registration): Registration {
  const kept = Object.entries(registered).map(([event, entries]) => [event, entries.filter(({ hooks }) => hooks.every(({ command }) => isOwnerHook(command)))] as const);
  return Object.fromEntries(kept.filter(([, entries]) => entries.length > 0));
}

function fenced(runs: string[], owned: Registration): string {
  const command = ["node", "-e", FENCE, JSON.stringify(runs)].map(shellQuoted).join(" ");
  const fence = { matcher: "Bash", hooks: [{ type: "command", command }] };
  return JSON.stringify({ hooks: { ...owned, PreToolUse: [fence, ...(owned.PreToolUse ?? [])] } });
}

export function stageArgv(commands: string[], owned: Registration = {}): string[] {
  const runs = [...commands, STATIC, `./${STATIC}`];
  return [
    "--print",
    "--model",
    "sonnet",
    "--setting-sources",
    "",
    "--settings",
    fenced(runs, owned),
    "--tools",
    TOOLS.join(","),
    "--permission-mode",
    "bypassPermissions",
  ];
}
