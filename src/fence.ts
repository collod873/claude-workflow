const STATIC = "bin/check static";
export const CHECK = "bin/check";

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

export type Registration = Record<string, { matcher?: string; hooks: { command: string }[] }[]>;

function fenced(runs: string[], owned: Registration): string {
  const command = ["node", "-e", FENCE, JSON.stringify(runs)].map(shellQuoted).join(" ");
  const fence = { matcher: "Bash", hooks: [{ type: "command", command }] };
  return JSON.stringify({ hooks: { ...owned, PreToolUse: [fence, ...(owned.PreToolUse ?? [])] } });
}

export interface Reach {
  model: string;
  fenced: boolean;
}

const FENCED: Reach = { model: "sonnet", fenced: true };
export const UNFENCED: Reach = { model: "opus", fenced: false };
export const OPEN_SHELL: Reach = { model: "sonnet", fenced: false };
export const FENCED_OPUS: Reach = { model: "opus", fenced: true };

export function stageArgv(commands: string[], owned: Registration = {}, tools: string[] = TOOLS, reach: Reach = FENCED): string[] {
  const runs = [...commands, STATIC, `./${STATIC}`];
  const settings = reach.fenced ? fenced(runs, owned) : JSON.stringify({ hooks: owned });
  return [
    "--print",
    "--model",
    reach.model,
    "--setting-sources",
    "",
    "--settings",
    settings,
    ...(reach.fenced ? ["--tools", tools.join(",")] : []),
    "--permission-mode",
    "bypassPermissions",
  ];
}
