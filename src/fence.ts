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

function fenced(runs: string[]): string {
  const command = ["node", "-e", FENCE, JSON.stringify(runs)].map(shellQuoted).join(" ");
  return JSON.stringify({ hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command }] }] } });
}

export function stageArgv(commands: string[]): string[] {
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
    "--permission-mode",
    "bypassPermissions",
  ];
}
