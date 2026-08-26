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
 * carry no `origin`/`promptSource`/`isMeta` at all). Assistant `tool_use` blocks are read only
 * for `## Files Touched` / `## Key Commands` — the tool *traffic* (results, diffs, output) stays
 * out; only which file and which command are kept.
 *
 * ## Format 2 — one ordered exchange, not two parallel lists (#103 §1)
 *
 * Until 2026-08-26 this emitted `## User Prompts` and `## Key Insights` as two flat lists, each in
 * its own order, with nothing tying one to the other. Both sides of the conversation were present
 * and neither could be paired with the other: 21 of this repo's 206 prompts are bare assent (`Ok`,
 * `Yes`) whose meaning lives entirely in the message they answer. The fix is layout, not capture —
 * `parseTranscript` already walked the transcript in order and threw that order away when it sorted
 * into buckets. It now returns one ordered `Turn[]`, rendered as `## Exchange` in conversation
 * order, and `## Key Insights` is gone: it was the same bytes in a worse order, so the file does
 * not grow. `## User Prompts` stays as a cheap index of the human side.
 *
 * **Assistant turns are emitted uncut.** The instinct is to keep only the tail — the part `- Ok`
 * is agreeing to. Resisted deliberately: any clip is a guess about what the transcript lens (#93)
 * needs, made before that lens exists, and a transcript that has aged out cannot be re-read to
 * widen it. Clipping later against the corpus is cheap; un-clipping is impossible.
 *
 * **Esc interrupts are turns.** Claude Code writes `[Request interrupted by user]` and
 * `[Request interrupted by user for tool use]` as their own `type: "user"` entries carrying no
 * `origin` field at all, so the `origin.kind === "human"` rule above rejected every one — 33 across
 * this repo's surviving transcripts. They are exempted by exact marker match, before that rule, and
 * only there: they are the highest-signal entries in the corpus, because agreeing is free and
 * interrupting is not.
 *
 * **Nothing a turn contains can become a heading of the capture file.** A pasted prompt carrying
 * its own markdown used to emit `## Acceptance criteria` at column 0, as a sibling of the sections
 * above — see `Knowledge-Base/raw/sessions/2026-08-26-0c0cf08a.md`. Exchange text is quoted and
 * prompt continuation lines are indented, so `^## ` matches only sections this module wrote.
 *
 * The 882 captures written before this carry no `format:` field and keep their old shape; nothing
 * rewrites them, because the pairing they lack cannot be recovered from them either way.
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

/** The two Esc-interrupt markers, mapped to whether the interrupt landed on a tool call. */
const INTERRUPT_MARKERS = new Map<string, boolean>([
  ["[Request interrupted by user]", false],
  ["[Request interrupted by user for tool use]", true],
]);

/** Joins an entry's `message.content` down to plain text — a string as-is, or a block array's `text` parts. */
function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((block): block is ContentBlock => typeof block === "object" && block !== null && block.type === "text")
    .map((block) => block.text ?? "")
    .join("");
}

/**
 * One entry in the conversation, in the order the transcript recorded it. The three kinds are kept
 * apart rather than flattened to a role string and a body, because `interrupt` carries a fact
 * neither of the others has — see the module header's Esc-interrupt note.
 */
export type Turn =
  | { role: "user"; text: string }
  | { role: "assistant"; text: string }
  | { role: "interrupt"; text: string; duringToolUse: boolean };

/** Everything `parseTranscript` pulls out of one transcript, before it becomes markdown. */
export interface ParsedSpine {
  /** The conversation in order — what `## Exchange` renders. */
  turns: Turn[];
  filesRead: string[];
  filesEdited: string[];
  filesWritten: string[];
  commands: string[];
}

/**
 * Parses transcript JSONL into a `ParsedSpine`. A line that fails to parse as JSON, or whose
 * `type` is neither `"user"` nor `"assistant"`, is skipped rather than treated as a defect —
 * transcripts are append-only logs from a live process, and a truncated last line is normal, not
 * exceptional.
 */
export function parseTranscript(jsonl: string): ParsedSpine {
  const turns: Turn[] = [];
  const filesRead = new Set<string>();
  const filesEdited = new Set<string>();
  const filesWritten = new Set<string>();
  const commands: string[] = [];
  const seenUuids = new Set<string>();

  /** True the first time a uuid is seen; an entry carrying none is never a duplicate. */
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

      // Before the origin rule, and only here: an Esc interrupt is a user-role entry the harness
      // writes on the owner's behalf, so it carries no `origin` and would fail that rule. Matched
      // on the exact marker rather than a prefix — see the module header.
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
      // A subagent's own exchange is not the main conversation any more than a tool result is —
      // see the module header's `isSidechain` note.
      if (entry.isSidechain) continue;

      const content = entry.message?.content;
      if (!Array.isArray(content)) continue;

      for (const block of content as ContentBlock[]) {
        if (block.type === "text") {
          const text = (block.text ?? "").trim();
          // One assistant reply arrives as several entries when it is interleaved with tool calls;
          // merging consecutive assistant text keeps `## Exchange` a list of turns rather than a
          // list of streaming fragments. Nothing is lost — the tool calls between them are already
          // recorded in `## Files Touched` and `## Key Commands`.
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

/** The frontmatter fields every capture file carries, supplied by the caller — see the module header. */
export interface SpineMeta {
  sessionId: string;
  project: string;
  date: string;
  source: string;
}

/** Quotes a turn's text so no line of it can be read as structure of the file that holds it. */
function quoted(text: string): string[] {
  return text.split("\n").map((line) => (line ? `> ${line}` : ">"));
}

/**
 * A list item whose continuation lines are indented into it — the same protection `quoted` gives a
 * turn, for the two sections that are lists. A pasted prompt and a heredoc command both routinely
 * carry their own `## ` lines; at column 0 those become sections of this file.
 */
function bulleted(text: string, wrapFirstLine: (line: string) => string = (line) => line): string[] {
  const [first, ...rest] = text.split("\n");
  // The wrap is inline code, which cannot span lines — so a multi-line body goes in unwrapped.
  const head = rest.length === 0 ? wrapFirstLine(first) : first;
  return [`- ${head}`, ...rest.map((line) => (line ? `  ${line}` : ""))];
}

/** The label above a turn's body in `## Exchange`. */
function turnLabel(turn: Turn): string {
  if (turn.role === "user") return "**User**";
  if (turn.role === "assistant") return "**Assistant**";
  return turn.duringToolUse ? "**Interrupted** — during a tool call" : "**Interrupted**";
}

/**
 * Renders a `ParsedSpine` as the capture markdown format: YAML frontmatter, then whichever of
 * `## User Prompts` / `## Exchange` / `## Files Touched` / `## Key Commands` have content — a
 * section with nothing to say is omitted rather than emitted empty.
 *
 * `format: 2` in the frontmatter is what tells a reader which shape it is holding; the 882 captures
 * written before 2026-08-26 carry no such field and carry `## Key Insights` instead of
 * `## Exchange`. See the module header for why they are not rewritten.
 */
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
      // An interrupt's marker text is its label — there is no body to quote under it.
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

/** Convenience composition of `parseTranscript` + `buildCaptureMarkdown` — what the hook calls. */
export function extractSpine(jsonl: string, meta: SpineMeta): string {
  return buildCaptureMarkdown(meta, parseTranscript(jsonl));
}
