import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { createFakeStage } from "./stage.fake";
import { runStage } from "./stage";
import { structuredOutput } from "./structured-output";

/** A stage schema small enough to read in one line, and object-rooted like every real one. */
const GREETING = structuredOutput(z.object({ greeting: z.string().min(1) }));

/** What a `claude` run with `--json-schema` puts on the wire: the validated value, as JSON. */
const RESPONSE = JSON.stringify({ greeting: "hi" });

/** The value of the `--json-schema` flag on one recorded argv, or `undefined` if it carried none. */
function jsonSchemaFlag(argv: string[]): string | undefined {
  const index = argv.indexOf("--json-schema");
  return index === -1 ? undefined : argv[index + 1];
}

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
    const fake = createFakeStage(RESPONSE);

    await runStage(promptPath, { ISSUE_NUMBER: "13", REPO: "claude-workflow" }, fake.exec, GREETING);

    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0].join(" ")).toContain("Sweep issue #13 for seams in claude-workflow.");
  });

  it("builds argv for a single headless print-mode claude call", async () => {
    const promptPath = writePrompt("Plain prompt, no vars.");
    const fake = createFakeStage(RESPONSE);

    await runStage(promptPath, {}, fake.exec, GREETING);

    const [argv] = fake.calls;
    expect(argv[0]).toBe("-p");
    expect(argv).toContain("Plain prompt, no vars.");
  });

  /**
   * The property this whole seam exists for. A stage that reached the CLI
   * without `--json-schema` would be a stage answering in prose, which is the
   * failure #147 removed — so it is asserted on `runStage` itself rather than
   * on each stage's call site, because no call site can opt out.
   *
   * The root-`object` check is not decoration either: the API refuses any
   * other root with `tools.N.custom.input_schema.type: Input should be
   * 'object'`, a 400 that arrives only once a stage has already spawned.
   */
  it("carries the stage's JSON Schema on the argv, object-rooted", async () => {
    const promptPath = writePrompt("Prompt.");
    const fake = createFakeStage(RESPONSE);

    await runStage(promptPath, {}, fake.exec, GREETING);

    const schema = jsonSchemaFlag(fake.calls[0]);
    expect(schema).toBeDefined();
    expect(JSON.parse(schema!)).toMatchObject({ type: "object" });
  });

  it("returns the response parsed and validated through the stage's schema", async () => {
    const promptPath = writePrompt("Prompt.");
    const fake = createFakeStage(RESPONSE);

    await expect(runStage(promptPath, {}, fake.exec, GREETING)).resolves.toEqual({
      greeting: "hi",
    });
  });

  it("rejects a response the stage's schema refuses, rather than returning it", async () => {
    const promptPath = writePrompt("Prompt.");
    const fake = createFakeStage(JSON.stringify({ greeting: "" }));

    await expect(runStage(promptPath, {}, fake.exec, GREETING)).rejects.toThrow(
      /failed schema validation/,
    );
  });

  it("throws naming the unresolved placeholder, without calling exec, when vars doesn't cover the template", async () => {
    const promptPath = writePrompt("Needs {{MISSING}}.");
    const fake = createFakeStage(RESPONSE);

    await expect(runStage(promptPath, {}, fake.exec, GREETING)).rejects.toThrow(/MISSING/);
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
      const fake = createFakeStage(RESPONSE);

      await runStage(promptPath, {}, fake.exec, GREETING, { promptViaStdin: true });

      expect(fake.stdins[0]).toBe(huge);
      // The schema still rides along — it is a flag, not part of the prompt,
      // so the transport the prompt takes never decides whether a stage is
      // schema-checked.
      expect(fake.calls[0]).toEqual([
        "-p",
        "--dangerously-skip-permissions",
        "--json-schema",
        GREETING.jsonSchema,
      ]);
    });

    it("is refused by name when the stage did not, rather than dying on an errno", async () => {
      // `spawn claude E2BIG` names neither the prompt nor the size, and it
      // arrives from inside `child_process` rather than from the stage that
      // outgrew the limit.
      const promptPath = writePrompt(huge);
      const fake = createFakeStage(RESPONSE);

      await expect(runStage(promptPath, {}, fake.exec, GREETING)).rejects.toThrow(
        /promptViaStdin/,
      );
      expect(fake.calls).toHaveLength(0);
    });

    it("leaves an ordinary prompt on argv, where every other stage still reads it", async () => {
      const promptPath = writePrompt("Plain prompt.");
      const fake = createFakeStage(RESPONSE);

      await runStage(promptPath, {}, fake.exec, GREETING);

      expect(fake.stdins[0]).toBeUndefined();
      expect(fake.calls[0]).toContain("Plain prompt.");
    });
  });
});
