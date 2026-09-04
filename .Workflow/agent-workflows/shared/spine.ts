interface RawEntry {
  type?: string;
  uuid?: string;
  isMeta?: boolean;
  isSidechain?: boolean;
  origin?: { kind?: string };
  promptSource?: string | null;
  message?: { content?: unknown };
}

interface ContentBlock {
  type?: string;
  text?: string;
  name?: string;
  input?: { file_path?: string; command?: string };
}

const SKIP_PREFIX_RE = /^<(?:local-command-|command-|bash-)/;
const SYSTEM_REMINDER_RE = /<system-reminder>[\s\S]*?<\/system-reminder>/g;
const VALID_PROMPT_SOURCES = new Set([null, "typed", "paste"]);
const EDIT_TOOLS = new Set(["Edit", "MultiEdit"]);

const INTERRUPT_MARKERS = new Map<string, boolean>([
  ["[Request interrupted by user]", false],
  ["[Request interrupted by user for tool use]", true],
]);

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((block): block is ContentBlock => typeof block === "object" && block !== null && block.type === "text")
    .map((block) => block.text ?? "")
    .join("");
}

export type Turn =
  | { role: "user"; text: string }
  | { role: "assistant"; text: string }
  | { role: "interrupt"; text: string; duringToolUse: boolean };

export interface ParsedSpine {
  turns: Turn[];
  filesRead: string[];
  filesEdited: string[];
  filesWritten: string[];
  commands: string[];
}

export function parseTranscript(jsonl: string): ParsedSpine {
  const turns: Turn[] = [];
  const filesRead = new Set<string>();
  const filesEdited = new Set<string>();
  const filesWritten = new Set<string>();
  const commands: string[] = [];
  const seenUuids = new Set<string>();

  const isFirstSighting = (uuid: string | undefined): boolean => {
    if (!uuid) return true;
    if (seenUuids.has(uuid)) return false;
    seenUuids.add(uuid);
    return true;
  };

  for (const line of jsonl.split("\n")) {
    if (!line.trim()) continue;

    let entry: RawEntry;
    try {
      entry = JSON.parse(line) as RawEntry;
    } catch {
      continue;
    }

    if (entry.type === "user") {
      if (entry.isMeta) continue;
      if (entry.isSidechain) continue;

      let text = textOf(entry.message?.content).trim();

      const duringToolUse = INTERRUPT_MARKERS.get(text);
      if (duringToolUse !== undefined) {
        if (!isFirstSighting(entry.uuid)) continue;
        turns.push({ role: "interrupt", text, duringToolUse });
        continue;
      }

      if (entry.origin?.kind !== "human") continue;
      if (!VALID_PROMPT_SOURCES.has(entry.promptSource ?? null)) continue;
      if (!text || SKIP_PREFIX_RE.test(text)) continue;

      text = text.replace(SYSTEM_REMINDER_RE, "").trim();
      if (!text) continue;

      if (!isFirstSighting(entry.uuid)) continue;

      turns.push({ role: "user", text });
      continue;
    }

    if (entry.type === "assistant") {
      if (entry.isSidechain) continue;

      const content = entry.message?.content;
      if (!Array.isArray(content)) continue;

      for (const block of content as ContentBlock[]) {
        if (block.type === "text") {
          const text = (block.text ?? "").trim();
          if (!text) continue;
          const last = turns.at(-1);
          if (last?.role === "assistant") last.text = `${last.text}\n\n${text}`;
          else turns.push({ role: "assistant", text });
          continue;
        }
        if (block.type !== "tool_use") continue;

        const filePath = block.input?.file_path;
        if (block.name === "Read" && filePath) filesRead.add(filePath);
        else if (block.name && EDIT_TOOLS.has(block.name) && filePath) filesEdited.add(filePath);
        else if (block.name === "Write" && filePath) filesWritten.add(filePath);
        else if (block.name === "Bash" && block.input?.command) commands.push(block.input.command);
      }
    }
  }

  return {
    turns,
    filesRead: [...filesRead].sort(),
    filesEdited: [...filesEdited].sort(),
    filesWritten: [...filesWritten].sort(),
    commands,
  };
}

export interface SpineMeta {
  sessionId: string;
  project: string;
  date: string;
  source: string;
}

function quoted(text: string): string[] {
  return text.split("\n").map((line) => (line ? `> ${line}` : ">"));
}

function bulleted(text: string, wrapFirstLine: (line: string) => string = (line) => line): string[] {
  const [first, ...rest] = text.split("\n");
  const head = rest.length === 0 ? wrapFirstLine(first) : first;
  return [`- ${head}`, ...rest.map((line) => (line ? `  ${line}` : ""))];
}

function turnLabel(turn: Turn): string {
  if (turn.role === "user") return "**User**";
  if (turn.role === "assistant") return "**Assistant**";
  return turn.duringToolUse ? "**Interrupted**, during a tool call" : "**Interrupted**";
}

export function buildCaptureMarkdown(meta: SpineMeta, parsed: ParsedSpine): string {
  const lines: string[] = [
    "---",
    `session_id: ${meta.sessionId}`,
    `project: ${meta.project}`,
    `date: ${meta.date}`,
    `source: ${meta.source}`,
    "format: 2",
    "---",
    "",
  ];

  const prompts = parsed.turns.filter((turn) => turn.role === "user");
  if (prompts.length > 0) {
    lines.push("## User Prompts");
    for (const prompt of prompts) lines.push(...bulleted(prompt.text));
    lines.push("");
  }

  if (parsed.turns.length > 0) {
    lines.push("## Exchange");
    lines.push("");
    for (const turn of parsed.turns) {
      lines.push(turnLabel(turn));
      if (turn.role !== "interrupt") lines.push(...quoted(turn.text));
      lines.push("");
    }
  }

  if (parsed.filesRead.length > 0 || parsed.filesEdited.length > 0 || parsed.filesWritten.length > 0) {
    lines.push("## Files Touched");
    for (const file of parsed.filesRead) lines.push(`- Read: ${file}`);
    for (const file of parsed.filesEdited) lines.push(`- Edited: ${file}`);
    for (const file of parsed.filesWritten) lines.push(`- Written: ${file}`);
    lines.push("");
  }

  if (parsed.commands.length > 0) {
    lines.push("## Key Commands");
    for (const command of parsed.commands) lines.push(...bulleted(command, (line) => `\`${line}\``));
    lines.push("");
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

export function extractSpine(jsonl: string, meta: SpineMeta): string {
  return buildCaptureMarkdown(meta, parseTranscript(jsonl));
}
