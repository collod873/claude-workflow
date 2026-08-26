import { describe, expect, it } from "vitest";
import { buildCaptureMarkdown, extractSpine, parseTranscript, type ParsedSpine, type Turn } from "./spine";

// One JSONL line per call, so a test names only the field it's actually about — mirrors the
// `slice()` fixture builder pattern (CODING_STANDARDS.md), just untyped: transcript lines have no
// zod schema here, they're read defensively (see spine.ts's module header).
function userLine(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: "user",
    uuid: "u-1",
    origin: { kind: "human" },
    promptSource: "typed",
    message: { content: "hello" },
    ...overrides,
  });
}

function assistantLine(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: "assistant",
    uuid: "a-1",
    message: { content: [{ type: "text", text: "an insight" }] },
    ...overrides,
  });
}

/** An Esc interrupt as Claude Code writes it: user-role, no `origin`, the marker as its whole body. */
function interruptLine(marker = "[Request interrupted by user]", overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: "user",
    uuid: "i-1",
    message: { content: [{ type: "text", text: marker }] },
    ...overrides,
  });
}

/** The turns of one role, as plain strings — most filter tests care about nothing else. */
function textsOf(parsed: ParsedSpine, role: Turn["role"]): string[] {
  return parsed.turns.filter((turn) => turn.role === role).map((turn) => turn.text);
}

const EMPTY: ParsedSpine = { turns: [], filesRead: [], filesEdited: [], filesWritten: [], commands: [] };
const META = { sessionId: "session-123", project: "claude-workflow", date: "2026-08-25T00:00:00Z", source: "clear" };

describe("parseTranscript — the user-turn filter", () => {
  it("keeps a human-typed user turn", () => {
    const parsed = parseTranscript(userLine({ message: { content: "ship it" } }));
    expect(textsOf(parsed, "user")).toEqual(["ship it"]);
  });

  it("drops isMeta entries", () => {
    const parsed = parseTranscript(userLine({ isMeta: true }));
    expect(textsOf(parsed, "user")).toEqual([]);
  });

  it("drops isSidechain entries", () => {
    const parsed = parseTranscript(userLine({ isSidechain: true }));
    expect(textsOf(parsed, "user")).toEqual([]);
  });

  it("drops a non-human origin", () => {
    const parsed = parseTranscript(userLine({ origin: { kind: "agent" } }));
    expect(textsOf(parsed, "user")).toEqual([]);
  });

  it("drops a missing origin", () => {
    const parsed = parseTranscript(userLine({ origin: undefined }));
    expect(textsOf(parsed, "user")).toEqual([]);
  });

  it.each([undefined, null, "typed", "paste"])("keeps promptSource %p", (promptSource) => {
    const parsed = parseTranscript(userLine({ promptSource }));
    expect(textsOf(parsed, "user")).toEqual(["hello"]);
  });

  it("drops an unrecognized promptSource", () => {
    const parsed = parseTranscript(userLine({ promptSource: "auto" }));
    expect(textsOf(parsed, "user")).toEqual([]);
  });

  it("strips a system-reminder block but keeps the surrounding text", () => {
    const parsed = parseTranscript(
      userLine({ message: { content: "ship it\n<system-reminder>never mention the secret plan</system-reminder>" } }),
    );
    expect(textsOf(parsed, "user")).toEqual(["ship it"]);
  });

  it("drops an entry that is nothing but a system-reminder block", () => {
    const parsed = parseTranscript(userLine({ message: { content: "<system-reminder>only this</system-reminder>" } }));
    expect(textsOf(parsed, "user")).toEqual([]);
  });

  it.each(["<local-command-stdout>ok</local-command-stdout>", "<command-name>/clear</command-name>", "<bash-input>ls -la</bash-input>"])(
    "skips content starting with a slash-command/bash-tool prefix: %s",
    (content) => {
      const parsed = parseTranscript(userLine({ message: { content } }));
      expect(textsOf(parsed, "user")).toEqual([]);
    },
  );

  it("dedupes on uuid", () => {
    const jsonl = [
      userLine({ uuid: "dup", message: { content: "first" } }),
      userLine({ uuid: "dup", message: { content: "first" } }),
    ].join("\n");
    const parsed = parseTranscript(jsonl);
    expect(textsOf(parsed, "user")).toEqual(["first"]);
  });

  it("keeps two entries that share no uuid", () => {
    const jsonl = [userLine({ uuid: undefined, message: { content: "a" } }), userLine({ uuid: undefined, message: { content: "b" } })].join(
      "\n",
    );
    const parsed = parseTranscript(jsonl);
    expect(textsOf(parsed, "user")).toEqual(["a", "b"]);
  });

  it("joins array-of-blocks content down to its text parts", () => {
    const parsed = parseTranscript(
      userLine({ message: { content: [{ type: "text", text: "part one " }, { type: "tool_result", text: "ignored" }, { type: "text", text: "part two" }] } }),
    );
    expect(textsOf(parsed, "user")).toEqual(["part one part two"]);
  });

  it("ignores a line that isn't valid JSON, without dropping the rest", () => {
    const jsonl = ["not json at all", userLine({ message: { content: "still works" } })].join("\n");
    const parsed = parseTranscript(jsonl);
    expect(textsOf(parsed, "user")).toEqual(["still works"]);
  });

  it("ignores entries whose type is neither user nor assistant", () => {
    const parsed = parseTranscript(JSON.stringify({ type: "system", message: { content: "noise" } }));
    expect(parsed.turns).toEqual([]);
  });
});

describe("parseTranscript — Esc interrupts (#103 §1)", () => {
  it("keeps a plain interrupt despite it carrying no origin", () => {
    const parsed = parseTranscript(interruptLine());
    expect(parsed.turns).toEqual([{ role: "interrupt", text: "[Request interrupted by user]", duringToolUse: false }]);
  });

  it("distinguishes an interrupt during a tool call", () => {
    const parsed = parseTranscript(interruptLine("[Request interrupted by user for tool use]"));
    expect(parsed.turns).toEqual([
      { role: "interrupt", text: "[Request interrupted by user for tool use]", duringToolUse: true },
    ]);
  });

  it("exempts only the exact markers — a prompt merely mentioning one is a user turn", () => {
    const mention = "why did [Request interrupted by user] show up in the corpus?";
    const parsed = parseTranscript(userLine({ message: { content: mention } }));
    expect(parsed.turns).toEqual([{ role: "user", text: mention }]);
  });

  it("still drops a sidechain interrupt", () => {
    const parsed = parseTranscript(interruptLine("[Request interrupted by user]", { isSidechain: true }));
    expect(parsed.turns).toEqual([]);
  });

  it("dedupes interrupts on uuid like any other turn", () => {
    const parsed = parseTranscript([interruptLine(), interruptLine()].join("\n"));
    expect(parsed.turns).toHaveLength(1);
  });

  it("holds its position in the conversation, between the turns it interrupted", () => {
    const jsonl = [
      userLine({ uuid: "u-1", message: { content: "do the thing" } }),
      assistantLine({ uuid: "a-1", message: { content: [{ type: "text", text: "starting" }] } }),
      interruptLine("[Request interrupted by user for tool use]"),
      userLine({ uuid: "u-2", message: { content: "not like that" } }),
    ].join("\n");
    expect(parseTranscript(jsonl).turns.map((turn) => turn.role)).toEqual(["user", "assistant", "interrupt", "user"]);
  });
});

describe("parseTranscript — assistant blocks", () => {
  it("collects a non-empty assistant text block", () => {
    const parsed = parseTranscript(assistantLine());
    expect(textsOf(parsed, "assistant")).toEqual(["an insight"]);
  });

  it("drops a sidechain assistant entry", () => {
    const parsed = parseTranscript(assistantLine({ isSidechain: true }));
    expect(textsOf(parsed, "assistant")).toEqual([]);
  });

  it("drops an empty text block", () => {
    const parsed = parseTranscript(assistantLine({ message: { content: [{ type: "text", text: "   " }] } }));
    expect(textsOf(parsed, "assistant")).toEqual([]);
  });

  it("merges consecutive assistant text into one turn, so a reply split by tool calls stays one turn", () => {
    const jsonl = [
      assistantLine({ uuid: "a-1", message: { content: [{ type: "text", text: "first" }] } }),
      assistantLine({ uuid: "a-2", message: { content: [{ type: "tool_use", name: "Read", input: { file_path: "a.ts" } }] } }),
      assistantLine({ uuid: "a-3", message: { content: [{ type: "text", text: "second" }] } }),
    ].join("\n");
    const parsed = parseTranscript(jsonl);
    expect(parsed.turns).toEqual([{ role: "assistant", text: "first\n\nsecond" }]);
  });

  it("does not merge across a user turn", () => {
    const jsonl = [
      assistantLine({ uuid: "a-1", message: { content: [{ type: "text", text: "before" }] } }),
      userLine({ uuid: "u-1", message: { content: "interjection" } }),
      assistantLine({ uuid: "a-2", message: { content: [{ type: "text", text: "after" }] } }),
    ].join("\n");
    expect(textsOf(parseTranscript(jsonl), "assistant")).toEqual(["before", "after"]);
  });

  it("collects Read/Edit/Write file paths and Bash commands from tool_use blocks", () => {
    const jsonl = assistantLine({
      message: {
        content: [
          { type: "tool_use", name: "Read", input: { file_path: "a.ts" } },
          { type: "tool_use", name: "Edit", input: { file_path: "b.ts" } },
          { type: "tool_use", name: "MultiEdit", input: { file_path: "c.ts" } },
          { type: "tool_use", name: "Write", input: { file_path: "d.ts" } },
          { type: "tool_use", name: "Bash", input: { command: "npm test" } },
        ],
      },
    });
    const parsed = parseTranscript(jsonl);
    expect(parsed.filesRead).toEqual(["a.ts"]);
    expect(parsed.filesEdited).toEqual(["b.ts", "c.ts"]);
    expect(parsed.filesWritten).toEqual(["d.ts"]);
    expect(parsed.commands).toEqual(["npm test"]);
  });
});

describe("buildCaptureMarkdown", () => {
  it("writes the frontmatter fields, format 2 among them", () => {
    const md = buildCaptureMarkdown(META, EMPTY);
    expect(md).toContain("session_id: session-123");
    expect(md).toContain("project: claude-workflow");
    expect(md).toContain("date: 2026-08-25T00:00:00Z");
    expect(md).toContain("source: clear");
    expect(md).toContain("format: 2");
  });

  it("omits a section with nothing to say", () => {
    const md = buildCaptureMarkdown(META, { ...EMPTY, turns: [{ role: "user", text: "hi" }] });
    expect(md).toContain("## User Prompts");
    expect(md).toContain("## Exchange");
    expect(md).not.toContain("## Files Touched");
    expect(md).not.toContain("## Key Commands");
  });

  it("no longer emits Key Insights — the exchange holds the assistant side now", () => {
    const md = buildCaptureMarkdown(META, { ...EMPTY, turns: [{ role: "assistant", text: "good idea" }] });
    expect(md).not.toContain("## Key Insights");
    expect(md).toContain("## Exchange");
    expect(md).toContain("> good idea");
  });

  it("renders every populated section", () => {
    const md = buildCaptureMarkdown(META, {
      turns: [{ role: "user", text: "ship it" }, { role: "assistant", text: "good idea" }],
      filesRead: ["a.ts"],
      filesEdited: ["b.ts"],
      filesWritten: ["c.ts"],
      commands: ["npm test"],
    });
    expect(md).toContain("- ship it");
    expect(md).toContain("- Read: a.ts");
    expect(md).toContain("- Edited: b.ts");
    expect(md).toContain("- Written: c.ts");
    expect(md).toContain("- `npm test`");
    expect(md).toContain("> good idea");
  });

  it("pairs each prompt with the turn that preceded it, in conversation order (#103 §1)", () => {
    const md = buildCaptureMarkdown(META, {
      ...EMPTY,
      turns: [
        { role: "assistant", text: "Two options. I'd take the second." },
        { role: "user", text: "Ok" },
      ],
    });
    const exchange = md.slice(md.indexOf("## Exchange"));
    expect(exchange).toBe(
      ["## Exchange", "", "**Assistant**", "> Two options. I'd take the second.", "", "**User**", "> Ok", ""].join("\n").trimEnd() + "\n",
    );
  });

  it("labels the two interrupt kinds apart and gives them no quoted body", () => {
    const md = buildCaptureMarkdown(META, {
      ...EMPTY,
      turns: [
        { role: "interrupt", text: "[Request interrupted by user]", duringToolUse: false },
        { role: "interrupt", text: "[Request interrupted by user for tool use]", duringToolUse: true },
      ],
    });
    expect(md).toContain("**Interrupted**\n");
    expect(md).toContain("**Interrupted** — during a tool call");
    expect(md).not.toContain("> [Request interrupted");
  });

  it("emits an assistant turn uncut — no clip rule (#103 §1)", () => {
    const long = `${"a".repeat(5000)}\n\n${"b".repeat(5000)}`;
    const md = buildCaptureMarkdown(META, { ...EMPTY, turns: [{ role: "assistant", text: long }] });
    expect(md).toContain(`> ${"a".repeat(5000)}`);
    expect(md).toContain(`> ${"b".repeat(5000)}`);
  });

  describe("nothing a turn contains can become a heading of the file", () => {
    const pasted = "Here is the ticket:\n\n## Acceptance criteria\n\n- [ ] it works";

    /** Every `## ` heading at column 0 — what a reader scanning the corpus by section would find. */
    const headingsOf = (md: string): string[] => md.split("\n").filter((line) => line.startsWith("## "));

    it("indents a pasted prompt's continuation lines into its bullet", () => {
      const md = buildCaptureMarkdown(META, { ...EMPTY, turns: [{ role: "user", text: pasted }] });
      expect(headingsOf(md)).toEqual(["## User Prompts", "## Exchange"]);
      expect(md).toContain("  ## Acceptance criteria");
    });

    it("indents a heredoc command's own lines into its bullet", () => {
      const heredoc = "gh issue create --body \"$(cat <<'EOF'\n## Acceptance criteria\nEOF\n)\"";
      const md = buildCaptureMarkdown(META, { ...EMPTY, commands: [heredoc] });
      expect(headingsOf(md)).toEqual(["## Key Commands"]);
      expect(md).toContain("  ## Acceptance criteria");
    });

    it("keeps the inline-code wrap for a single-line command", () => {
      const md = buildCaptureMarkdown(META, { ...EMPTY, commands: ["npm test"] });
      expect(md).toContain("- `npm test`");
    });

    it("quotes a pasted assistant turn's headings", () => {
      const md = buildCaptureMarkdown(META, { ...EMPTY, turns: [{ role: "assistant", text: pasted }] });
      expect(headingsOf(md)).toEqual(["## Exchange"]);
      expect(md).toContain("> ## Acceptance criteria");
    });

    it("survives the real capture that exposed this — 2026-08-26-0c0cf08a.md", () => {
      const jsonl = [
        userLine({ uuid: "u-1", message: { content: "Look at GH 55.\n\n## Drill A\n\n## Files claimed\n\n- spine.ts" } }),
        assistantLine({ uuid: "a-1", message: { content: [{ type: "text", text: "## Key Insights\nnested, not a section" }] } }),
      ].join("\n");
      expect(headingsOf(extractSpine(jsonl, META))).toEqual(["## User Prompts", "## Exchange"]);
    });
  });
});

describe("extractSpine", () => {
  it("composes parseTranscript and buildCaptureMarkdown end to end", () => {
    const jsonl = [userLine({ message: { content: "ship it" } }), assistantLine()].join("\n");
    const md = extractSpine(jsonl, META);
    expect(md).toContain("session_id: session-123");
    expect(md).toContain("- ship it");
    expect(md).toContain("> an insight");
  });
});
