/**
 * Spine extraction — turns one Claude Code transcript JSONL into the capture markdown format
 * `.claude/hooks/session-capture-hook.mjs` writes at `SessionEnd` (#44; part of #36).
 *
 * "The spine" is the conversation, not the tool traffic: human-typed user turns plus assistant
 * text, filtered down to what a person actually said and decided. #36's §Solution "Extraction"
 * ruling is followed exactly rather than re-derived — it was already written twice
 * (`General-Repo/salvage/correction-ledger-2026-08-21/extract.py`,
 * `Knowledge-Base/_disabled-global-hooks/session-capture.py`):
 *
 *   - keep `type === "user"`
 *   - drop `isMeta`
 *   - drop `isSidechain`
 *   - require `origin.kind === "human"` — a user-role entry the harness injected (a tool result,
 *     a programmatic follow-up) is not something the owner typed
 *   - require `promptSource` in (absent, `null`, `"typed"`, `"paste"`)
 *   - strip `<system-reminder>...</system-reminder>` blocks
 *   - skip content starting with `<local-command-`, `<command-`, or `<bash-` — slash-command and
 *     Bash-tool echo, not something a person wrote
 *   - dedupe on `uuid`
 *
 * Assistant `text` blocks are added on top of that (not filtered by any of the above — they
 * carry no `origin`/`promptSource`/`isMeta` at all), landing in `## Key Insights`. Assistant
 * `tool_use` blocks are read only for `## Files Touched` / `## Key Commands`, matching the
 * existing capture file shape `Knowledge-Base/raw/sessions/` already holds 841 examples of — the
 * tool *traffic* (results, diffs, output) stays out; only which file and which command are kept.
 *
 * Pure and synchronous throughout — no file I/O, no wall clock. The caller (the hook) reads the
 * transcript and supplies `date`; that is what makes this directly unit-testable against fixture
 * strings instead of fixture files, and keeps a hook that must fail open from ever discovering a
 * clock-dependent edge case in production it couldn't see in a test.
 */

/** One transcript JSONL line, read defensively — nothing here assumes a field exists. */
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

/** Joins an entry's `message.content` down to plain text — a string as-is, or a block array's `text` parts. */
function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((block): block is ContentBlock => typeof block === "object" && block !== null && block.type === "text")
    .map((block) => block.text ?? "")
    .join("");
}

/** Everything `parseTranscript` pulls out of one transcript, before it becomes markdown. */
export interface ParsedSpine {
  userPrompts: string[];
  filesRead: string[];
  filesEdited: string[];
  filesWritten: string[];
  commands: string[];
  insights: string[];
}

/**
 * Parses transcript JSONL into a `ParsedSpine`. A line that fails to parse as JSON, or whose
 * `type` is neither `"user"` nor `"assistant"`, is skipped rather than treated as a defect —
 * transcripts are append-only logs from a live process, and a truncated last line is normal, not
 * exceptional.
 */
export function parseTranscript(jsonl: string): ParsedSpine {
  const userPrompts: string[] = [];
  const filesRead = new Set<string>();
  const filesEdited = new Set<string>();
  const filesWritten = new Set<string>();
  const commands: string[] = [];
  const insights: string[] = [];
  const seenUuids = new Set<string>();

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
      if (entry.origin?.kind !== "human") continue;
      if (!VALID_PROMPT_SOURCES.has(entry.promptSource ?? null)) continue;

      let text = textOf(entry.message?.content).trim();
      if (!text || SKIP_PREFIX_RE.test(text)) continue;

      text = text.replace(SYSTEM_REMINDER_RE, "").trim();
      if (!text) continue;

      if (entry.uuid) {
        if (seenUuids.has(entry.uuid)) continue;
        seenUuids.add(entry.uuid);
      }

      userPrompts.push(text);
      continue;
    }

    if (entry.type === "assistant") {
      // A subagent's own exchange is not the main conversation any more than a tool result is —
      // see the module header's `isSidechain` note.
      if (entry.isSidechain) continue;

      const content = entry.message?.content;
      if (!Array.isArray(content)) continue;

      for (const block of content as ContentBlock[]) {
        if (block.type === "text") {
          const text = (block.text ?? "").trim();
          if (text) insights.push(text);
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
    userPrompts,
    filesRead: [...filesRead].sort(),
    filesEdited: [...filesEdited].sort(),
    filesWritten: [...filesWritten].sort(),
    commands,
    insights,
  };
}

/** The frontmatter fields every capture file carries, supplied by the caller — see the module header. */
export interface SpineMeta {
  sessionId: string;
  project: string;
  date: string;
  source: string;
}

/**
 * Renders a `ParsedSpine` as the capture markdown format: YAML frontmatter, then whichever of
 * `## User Prompts` / `## Files Touched` / `## Key Commands` / `## Key Insights` have content —
 * a section with nothing to say is omitted rather than emitted empty, matching the existing 841
 * captures under `Knowledge-Base/raw/sessions/`.
 */
export function buildCaptureMarkdown(meta: SpineMeta, parsed: ParsedSpine): string {
  const lines: string[] = [
    "---",
    `session_id: ${meta.sessionId}`,
    `project: ${meta.project}`,
    `date: ${meta.date}`,
    `source: ${meta.source}`,
    "---",
    "",
  ];

  if (parsed.userPrompts.length > 0) {
    lines.push("## User Prompts");
    for (const prompt of parsed.userPrompts) lines.push(`- ${prompt}`);
    lines.push("");
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
    for (const command of parsed.commands) lines.push(`- \`${command}\``);
    lines.push("");
  }

  if (parsed.insights.length > 0) {
    lines.push("## Key Insights");
    for (const insight of parsed.insights) {
      for (const insightLine of insight.split("\n")) lines.push(`> ${insightLine}`);
      lines.push("");
    }
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

/** Convenience composition of `parseTranscript` + `buildCaptureMarkdown` — what the hook calls. */
export function extractSpine(jsonl: string, meta: SpineMeta): string {
  return buildCaptureMarkdown(meta, parseTranscript(jsonl));
}
