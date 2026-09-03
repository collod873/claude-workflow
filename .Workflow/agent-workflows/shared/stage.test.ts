import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, onTestFinished } from "vitest";
import { z } from "zod";
import { withHandoffDir } from "./handoff-dir.fixture";
import { createFakeStage } from "./stage.fake";
import { checkpointPath, runStage, type StageExec } from "./stage";
import { structuredOutput } from "./structured-output";

const GREETING = structuredOutput(z.object({ greeting: z.string().min(1) }));

const RESPONSE = JSON.stringify({ greeting: "hi" });

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

    await runStage(promptPath, { ISSUE_NUMBER: "13", REPO: "claude-workflow" }, fake.exec, GREETING, {
      stage: "test",
    });

    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0].join(" ")).toContain("Sweep issue #13 for seams in claude-workflow.");
  });

  it("builds argv for a single headless print-mode claude call", async () => {
    const promptPath = writePrompt("Plain prompt, no vars.");
    const fake = createFakeStage(RESPONSE);

    await runStage(promptPath, {}, fake.exec, GREETING, { stage: "test" });

    const [argv] = fake.calls;
    expect(argv[0]).toBe("-p");
    expect(argv).toContain("Plain prompt, no vars.");
  });

  it("carries the stage's JSON Schema on the argv, object-rooted", async () => {
    const promptPath = writePrompt("Prompt.");
    const fake = createFakeStage(RESPONSE);

    await runStage(promptPath, {}, fake.exec, GREETING, { stage: "test" });

    const schema = jsonSchemaFlag(fake.calls[0]);
    expect(schema).toBeDefined();
    expect(JSON.parse(schema!)).toMatchObject({ type: "object" });
  });

  it("returns the response parsed and validated through the stage's schema", async () => {
    const promptPath = writePrompt("Prompt.");
    const fake = createFakeStage(RESPONSE);

    await expect(runStage(promptPath, {}, fake.exec, GREETING, { stage: "test" })).resolves.toEqual({
      greeting: "hi",
    });
  });

  it("rejects a response the stage's schema refuses, rather than returning it", async () => {
    const handoffDir = withHandoffDir();
    process.env.FAILURE_REASON_PATH = join(handoffDir, "handoff.txt");
    const promptPath = writePrompt("Prompt.");
    const fake = createFakeStage(JSON.stringify({ greeting: "" }));

    await expect(runStage(promptPath, {}, fake.exec, GREETING, { stage: "test" })).rejects.toThrow(
      /failed schema validation/,
    );
  });

  it("builds --allowedTools from an allow list, and passes no --disallowedTools", async () => {
    const promptPath = writePrompt("Prompt.");
    const fake = createFakeStage(RESPONSE);

    await runStage(promptPath, {}, fake.exec, GREETING, {
      allowedTools: ["Read", "Grep", "Glob"],
      stage: "test",
    });

    const [argv] = fake.calls;
    expect(argv[argv.indexOf("--allowedTools") + 1]).toBe("Read,Grep,Glob");
    expect(argv).not.toContain("--disallowedTools");
  });

  it("refuses a stage that sets both allowedTools and disallowedTools", async () => {
    const promptPath = writePrompt("Prompt.");
    const fake = createFakeStage(RESPONSE);

    await expect(
      runStage(promptPath, {}, fake.exec, GREETING, {
        allowedTools: ["Read"],
        disallowedTools: ["Bash"],
        stage: "test",
      }),
    ).rejects.toThrow(/allowedTools and disallowedTools/);
    expect(fake.calls).toHaveLength(0);
  });

  it("throws naming the unresolved placeholder, without calling exec, when vars doesn't cover the template", async () => {
    const promptPath = writePrompt("Needs {{MISSING}}.");
    const fake = createFakeStage(RESPONSE);

    await expect(runStage(promptPath, {}, fake.exec, GREETING, { stage: "test" })).rejects.toThrow(
      /MISSING/,
    );
    expect(fake.calls).toHaveLength(0);
  });

  describe("a prompt too large for an argv element", () => {
    const huge = "x".repeat(32 * 4096 + 1);

    it("goes on stdin when the stage asks for it, leaving argv small", async () => {
      const promptPath = writePrompt(huge);
      const fake = createFakeStage(RESPONSE);

      await runStage(promptPath, {}, fake.exec, GREETING, { promptViaStdin: true, stage: "test" });

      expect(fake.stdins[0]).toBe(huge);
      expect(fake.calls[0]).toEqual([
        "-p",
        "--dangerously-skip-permissions",
        "--json-schema",
        GREETING.jsonSchema,
      ]);
    });

    it("is refused by name when the stage did not, rather than dying on an errno", async () => {
      const promptPath = writePrompt(huge);
      const fake = createFakeStage(RESPONSE);

      await expect(
        runStage(promptPath, {}, fake.exec, GREETING, { stage: "test" }),
      ).rejects.toThrow(/promptViaStdin/);
      expect(fake.calls).toHaveLength(0);
    });

    it("leaves an ordinary prompt on argv, where every other stage still reads it", async () => {
      const promptPath = writePrompt("Plain prompt.");
      const fake = createFakeStage(RESPONSE);

      await runStage(promptPath, {}, fake.exec, GREETING, { stage: "test" });

      expect(fake.stdins[0]).toBeUndefined();
      expect(fake.calls[0]).toContain("Plain prompt.");
    });
  });
});

describe("runStage checkpointing (StageOptions.stage)", () => {
  const checkpointTestDirs: string[] = [];
  afterEach(() => {
    for (const dir of checkpointTestDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  function writePrompt(contents: string): string {
    const dir = mkdtempSync(join(tmpdir(), "stage-checkpoint-test-"));
    checkpointTestDirs.push(dir);
    const path = join(dir, "prompt.md");
    writeFileSync(path, contents, "utf8");
    return path;
  }

  it("a stage with a key-matching checkpoint calls no StageExec and returns it re-validated through output.parse", async () => {
    const promptPath = writePrompt("Checkpointed prompt, no vars.");
    const fake = createFakeStage(RESPONSE);

    const firstValue = await runStage(promptPath, {}, fake.exec, GREETING, { stage: "checkpoint-hit" });
    expect(fake.calls).toHaveLength(1);

    const unreachable: StageExec = async () => {
      throw new Error("StageExec should not have been called for a checkpoint hit");
    };

    const secondValue = await runStage(promptPath, {}, unreachable, GREETING, { stage: "checkpoint-hit" });

    expect(secondValue).toEqual(firstValue);
    expect(secondValue).toEqual({ greeting: "hi" });
  });

  it("writes a checkpoint after a successful run, holding the raw response `output.parse` will re-validate on a hit", async () => {
    const promptPath = writePrompt("Prompt for a written checkpoint.");
    const fake = createFakeStage(RESPONSE);

    await runStage(promptPath, {}, fake.exec, GREETING, { stage: "checkpoint-write" });

    const envelope = JSON.parse(readFileSync(checkpointPath("checkpoint-write"), "utf8"));
    expect(envelope.response).toBe(RESPONSE);
  });

  it("does not reuse a checkpoint written for a different prompt", async () => {
    const firstPromptPath = writePrompt("First prompt.");
    const first = createFakeStage(RESPONSE);
    await runStage(firstPromptPath, {}, first.exec, GREETING, { stage: "checkpoint-mismatch" });

    const secondPromptPath = writePrompt("A different prompt.");
    const second = createFakeStage(RESPONSE);
    await runStage(secondPromptPath, {}, second.exec, GREETING, { stage: "checkpoint-mismatch" });

    expect(second.calls).toHaveLength(1);
  });

  it("spawns when there is no checkpoint yet (an absent checkpoints dir)", async () => {
    const promptPath = writePrompt("Prompt.");
    const fake = createFakeStage(RESPONSE);

    const value = await runStage(promptPath, {}, fake.exec, GREETING, { stage: "checkpoint-absent" });

    expect(fake.calls).toHaveLength(1);
    expect(value).toEqual({ greeting: "hi" });
  });

  it("spawns when the checkpoint file can't be read (not a regular file)", async () => {
    const promptPath = writePrompt("Prompt.");
    mkdirSync(checkpointPath("checkpoint-unreadable"), { recursive: true });
    const fake = createFakeStage(RESPONSE);

    const value = await runStage(promptPath, {}, fake.exec, GREETING, { stage: "checkpoint-unreadable" });

    expect(fake.calls).toHaveLength(1);
    expect(value).toEqual({ greeting: "hi" });
  });

  it("spawns when the checkpoint isn't valid JSON", async () => {
    const promptPath = writePrompt("Prompt.");
    const path = checkpointPath("checkpoint-garbage");
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "not json", "utf8");
    const fake = createFakeStage(RESPONSE);

    await runStage(promptPath, {}, fake.exec, GREETING, { stage: "checkpoint-garbage" });

    expect(fake.calls).toHaveLength(1);
  });

  it("spawns when the commit can't be named (not a git checkout)", async () => {
    const promptPath = writePrompt("Prompt.");
    const fake = createFakeStage(RESPONSE);
    const cwd = mkdtempSync(join(tmpdir(), "no-git-cwd-"));
    const originalCwd = process.cwd();
    process.chdir(cwd);
    try {
      await runStage(promptPath, {}, fake.exec, GREETING, { stage: "checkpoint-no-git" });
    } finally {
      process.chdir(originalCwd);
      rmSync(cwd, { recursive: true, force: true });
    }

    expect(fake.calls).toHaveLength(1);
  });
});

describe("two tests in one file that render the same prompt for the same stage", () => {
  const SHARED_STAGE = "shared-prompt-across-tests";
  const SHARED_PROMPT = "One prompt, rendered identically by both tests below. No vars.";

  async function runShared(greeting: string): Promise<{ spawned: boolean; value: unknown }> {
    const dir = mkdtempSync(join(tmpdir(), "shared-prompt-"));
    onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
    const promptPath = join(dir, "prompt.md");
    writeFileSync(promptPath, SHARED_PROMPT, "utf8");

    const fake = createFakeStage(JSON.stringify({ greeting }));
    const value = await runStage(promptPath, {}, fake.exec, GREETING, { stage: SHARED_STAGE });
    return { spawned: fake.calls.length === 1, value };
  }

  it("gets its own answer, first", async () => {
    expect(await runShared("first")).toEqual({ spawned: true, value: { greeting: "first" } });
  });

  it("gets its own answer, second — not the checkpoint the first one just wrote", async () => {
    expect(await runShared("second")).toEqual({ spawned: true, value: { greeting: "second" } });
  });
});
