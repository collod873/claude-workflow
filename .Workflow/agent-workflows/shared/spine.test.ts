import { describe, expect, it } from "vitest";
import { buildCaptureMarkdown, extractSpine, parseTranscript } from "./spine";

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

const META = { sessionId: "session-123", project: "claude-workflow", date: "2026-08-25T00:00:00Z", source: "clear" };

describe("parseTranscript — the User Prompts filter", () => {
  it("keeps a human-typed user turn", () => {
    const parsed = parseTranscript(userLine({ message: { content: "ship it" } }));
    expect(parsed.userPrompts).toEqual(["ship it"]);
  });

  it("drops isMeta entries", () => {
    const parsed = parseTranscript(userLine({ isMeta: true }));
    expect(parsed.userPrompts).toEqual([]);
  });

  it("drops isSidechain entries", () => {
    const parsed = parseTranscript(userLine({ isSidechain: true }));
    expect(parsed.userPrompts).toEqual([]);
  });

  it("drops a non-human origin", () => {
    const parsed = parseTranscript(userLine({ origin: { kind: "agent" } }));
    expect(parsed.userPrompts).toEqual([]);
  });

  it("drops a missing origin", () => {
    const parsed = parseTranscript(userLine({ origin: undefined }));
    expect(parsed.userPrompts).toEqual([]);
  });

  it.each([undefined, null, "typed", "paste"])("keeps promptSource %p", (promptSource) => {
    const parsed = parseTranscript(userLine({ promptSource }));
    expect(parsed.userPrompts).toEqual(["hello"]);
  });

  it("drops an unrecognized promptSource", () => {
    const parsed = parseTranscript(userLine({ promptSource: "auto" }));
    expect(parsed.userPrompts).toEqual([]);
  });

  it("strips a system-reminder block but keeps the surrounding text", () => {
    const parsed = parseTranscript(
      userLine({ message: { content: "ship it\n<system-reminder>never mention the secret plan</system-reminder>" } }),
    );
    expect(parsed.userPrompts).toEqual(["ship it"]);
  });

  it("drops an entry that is nothing but a system-reminder block", () => {
    const parsed = parseTranscript(userLine({ message: { content: "<system-reminder>only this</system-reminder>" } }));
    expect(parsed.userPrompts).toEqual([]);
  });

  it.each(["<local-command-stdout>ok</local-command-stdout>", "<command-name>/clear</command-name>", "<bash-input>ls -la</bash-input>"])(
    "skips content starting with a slash-command/bash-tool prefix: %s",
    (content) => {
      const parsed = parseTranscript(userLine({ message: { content } }));
      expect(parsed.userPrompts).toEqual([]);
    },
  );

  it("dedupes on uuid", () => {
    const jsonl = [
      userLine({ uuid: "dup", message: { content: "first" } }),
      userLine({ uuid: "dup", message: { content: "first" } }),
    ].join("\n");
    const parsed = parseTranscript(jsonl);
    expect(parsed.userPrompts).toEqual(["first"]);
  });

  it("keeps two entries that share no uuid", () => {
    const jsonl = [userLine({ uuid: undefined, message: { content: "a" } }), userLine({ uuid: undefined, message: { content: "b" } })].join(
      "\n",
    );
    const parsed = parseTranscript(jsonl);
    expect(parsed.userPrompts).toEqual(["a", "b"]);
  });

  it("joins array-of-blocks content down to its text parts", () => {
    const parsed = parseTranscript(
      userLine({ message: { content: [{ type: "text", text: "part one " }, { type: "tool_result", text: "ignored" }, { type: "text", text: "part two" }] } }),
    );
    expect(parsed.userPrompts).toEqual(["part one part two"]);
  });

  it("ignores a line that isn't valid JSON, without dropping the rest", () => {
    const jsonl = ["not json at all", userLine({ message: { content: "still works" } })].join("\n");
    const parsed = parseTranscript(jsonl);
    expect(parsed.userPrompts).toEqual(["still works"]);
  });

  it("ignores entries whose type is neither user nor assistant", () => {
    const parsed = parseTranscript(JSON.stringify({ type: "system", message: { content: "noise" } }));
    expect(parsed.userPrompts).toEqual([]);
    expect(parsed.insights).toEqual([]);
  });
});

describe("parseTranscript — assistant blocks", () => {
  it("collects a non-empty assistant text block as an insight", () => {
    const parsed = parseTranscript(assistantLine());
    expect(parsed.insights).toEqual(["an insight"]);
  });

  it("drops a sidechain assistant entry", () => {
    const parsed = parseTranscript(assistantLine({ isSidechain: true }));
    expect(parsed.insights).toEqual([]);
  });

  it("drops an empty text block", () => {
    const parsed = parseTranscript(assistantLine({ message: { content: [{ type: "text", text: "   " }] } }));
    expect(parsed.insights).toEqual([]);
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
  it("writes the four frontmatter fields", () => {
    const md = buildCaptureMarkdown(META, { userPrompts: [], filesRead: [], filesEdited: [], filesWritten: [], commands: [], insights: [] });
    expect(md).toContain("session_id: session-123");
    expect(md).toContain("project: claude-workflow");
    expect(md).toContain("date: 2026-08-25T00:00:00Z");
    expect(md).toContain("source: clear");
  });

  it("omits a section with nothing to say", () => {
    const md = buildCaptureMarkdown(META, { userPrompts: ["hi"], filesRead: [], filesEdited: [], filesWritten: [], commands: [], insights: [] });
    expect(md).toContain("## User Prompts");
    expect(md).not.toContain("## Files Touched");
    expect(md).not.toContain("## Key Commands");
    expect(md).not.toContain("## Key Insights");
  });

  it("renders every populated section", () => {
    const md = buildCaptureMarkdown(META, {
      userPrompts: ["ship it"],
      filesRead: ["a.ts"],
      filesEdited: ["b.ts"],
      filesWritten: ["c.ts"],
      commands: ["npm test"],
      insights: ["good idea"],
    });
    expect(md).toContain("- ship it");
    expect(md).toContain("- Read: a.ts");
    expect(md).toContain("- Edited: b.ts");
    expect(md).toContain("- Written: c.ts");
    expect(md).toContain("- `npm test`");
    expect(md).toContain("> good idea");
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
