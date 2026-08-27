import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createFakeStage } from "./stage.fake";
import { runStage } from "./stage";

describe("runStage", () => {
  let dir: string | undefined;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  function writePrompt(contents: string): string {
    dir = mkdtempSync(join(tmpdir(), "stage-test-"));
    const path = join(dir, "prompt.md");
    writeFileSync(path, contents, "utf8");
    return path;
  }

  it("substitutes every {{VAR}} placeholder before spawning the stage", async () => {
    const promptPath = writePrompt("Sweep issue #{{ISSUE_NUMBER}} for seams in {{REPO}}.");
    const fake = createFakeStage("<output>[]</output>");

    await runStage(promptPath, { ISSUE_NUMBER: "13", REPO: "claude-workflow" }, fake.exec);

    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0].join(" ")).toContain("Sweep issue #13 for seams in claude-workflow.");
  });

  it("builds argv for a single headless print-mode claude call", async () => {
    const promptPath = writePrompt("Plain prompt, no vars.");
    const fake = createFakeStage("<output>[]</output>");

    await runStage(promptPath, {}, fake.exec);

    const [argv] = fake.calls;
    expect(argv[0]).toBe("-p");
    expect(argv).toContain("Plain prompt, no vars.");
  });

  it("returns raw stdout from the injected exec", async () => {
    const promptPath = writePrompt("Prompt.");
    const fake = createFakeStage('<output>["a seam"]</output>');

    const raw = await runStage(promptPath, {}, fake.exec);

    expect(raw).toBe('<output>["a seam"]</output>');
  });

  it("throws naming the unresolved placeholder, without calling exec, when vars doesn't cover the template", async () => {
    const promptPath = writePrompt("Needs {{MISSING}}.");
    const fake = createFakeStage("<output>[]</output>");

    await expect(runStage(promptPath, {}, fake.exec)).rejects.toThrow(/MISSING/);
    expect(fake.calls).toHaveLength(0);
  });

  /**
   * Linux caps a single argv element at 128 KiB, independently of the much
   * larger total-argv limit, and a prompt passed as `-p <prompt>` is one
   * element. Lane 01's shaper inlines `CONTEXT.md`, `CODING_STANDARDS.md` and
   * a reading list ADR-0030 deliberately left uncapped, so this is a limit the
   * estate can reach, and reaches only for the ideas whose reading lists
   * happened to be long.
   */
  describe("a prompt too large for an argv element", () => {
    const huge = "x".repeat(32 * 4096 + 1);

    it("goes on stdin when the stage asks for it, leaving argv small", async () => {
      const promptPath = writePrompt(huge);
      const fake = createFakeStage("<output>[]</output>");

      await runStage(promptPath, {}, fake.exec, { promptViaStdin: true });

      expect(fake.stdins[0]).toBe(huge);
      expect(fake.calls[0]).toEqual(["-p", "--dangerously-skip-permissions"]);
    });

    it("is refused by name when the stage did not, rather than dying on an errno", async () => {
      // `spawn claude E2BIG` names neither the prompt nor the size, and it
      // arrives from inside `child_process` rather than from the stage that
      // outgrew the limit.
      const promptPath = writePrompt(huge);
      const fake = createFakeStage("<output>[]</output>");

      await expect(runStage(promptPath, {}, fake.exec)).rejects.toThrow(/promptViaStdin/);
      expect(fake.calls).toHaveLength(0);
    });

    it("leaves an ordinary prompt on argv, where every other stage still reads it", async () => {
      const promptPath = writePrompt("Plain prompt.");
      const fake = createFakeStage("<output>[]</output>");

      await runStage(promptPath, {}, fake.exec);

      expect(fake.stdins[0]).toBeUndefined();
      expect(fake.calls[0]).toContain("Plain prompt.");
    });
  });
});
