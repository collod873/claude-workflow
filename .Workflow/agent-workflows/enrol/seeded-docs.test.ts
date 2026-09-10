import { describe, expect, it } from "vitest";
import {
  CLAUDE_MD_HEADING,
  SEEDED_DOC_NAMES,
  claudeMdPointerLine,
  pointerDoc,
  pointerDocPath,
  withAgentSkillsPointer,
} from "./seeded-docs.ts";

const MACHINE_REPOSITORY = "collod873/claude-workflow";

describe("a seeded doc is a pointer, not a copy", () => {
  it("stays well under 1000 bytes for every seeded doc name", () => {
    for (const name of SEEDED_DOC_NAMES) {
      expect(Buffer.byteLength(pointerDoc(name, MACHINE_REPOSITORY), "utf8")).toBeLessThan(1000);
    }
  });

  it("names this repo's own file and the workstation clone path", () => {
    const doc = pointerDoc("ticket-format.md", MACHINE_REPOSITORY);

    expect(doc).toContain(MACHINE_REPOSITORY);
    expect(doc).toContain(pointerDocPath("ticket-format.md"));
    expect(doc).toContain("~/.agents/workflow/docs/agents/ticket-format.md");
  });
});

describe("the CLAUDE.md pointer line", () => {
  it("is added under a heading of its own when the consumer's CLAUDE.md has none", () => {
    const before = "# Some Project\n\nSome prose.\n";

    const after = withAgentSkillsPointer(before, MACHINE_REPOSITORY);

    expect(after).toContain(CLAUDE_MD_HEADING);
    expect(after).toContain(claudeMdPointerLine(MACHINE_REPOSITORY));
  });

  it("is added under an existing heading rather than a second one", () => {
    const before = "# Some Project\n\n## Agent skills\n\nSomething already here.\n";

    const after = withAgentSkillsPointer(before, MACHINE_REPOSITORY);

    expect(after.match(/## Agent skills/g)).toHaveLength(1);
    expect(after).toContain(claudeMdPointerLine(MACHINE_REPOSITORY));
    expect(after).toContain("Something already here.");
  });

  it("is a no-op once the line is already present", () => {
    const once = withAgentSkillsPointer("# P\n", MACHINE_REPOSITORY);

    expect(withAgentSkillsPointer(once, MACHINE_REPOSITORY)).toBe(once);
  });
});
