import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { z } from "zod";
import { laneBudget } from "./lane-budget";
import type { GhExec } from "./gh";
import { withHandoffDir } from "./handoff-dir.fixture";
import { errorMessage } from "./reason";
import { createFakeStage } from "./stage.fake";
import {
  checkpointPath,
  currentLaneRun,
  runStage,
  runStageSession,
  runStageSessionWithinBudget,
  startLaneBudget,
  type LaneRunRef,
  type LaneTicket,
  type StageExec,
} from "./stage";
import { strikeBody } from "./strikes";
import { structuredOutput } from "./structured-output";

const GREETING = structuredOutput(z.object({ greeting: z.string().min(1) }));

const RESPONSE = JSON.stringify({ greeting: "hi" });

function jsonSchemaFlag(argv: string[]): string | undefined {
  const index = argv.indexOf("--json-schema");
  return index === -1 ? undefined : argv[index + 1];
}

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

describe("runStage", () => {
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

  it("carries --resume when the stage asks to resume a session", async () => {
    const promptPath = writePrompt("Prompt.");
    const fake = createFakeStage(RESPONSE);

    await runStage(promptPath, {}, fake.exec, GREETING, { resume: "sess-123", stage: "test" });

    const [argv] = fake.calls;
    expect(argv[argv.indexOf("--resume") + 1]).toBe("sess-123");
  });

  it("carries no --resume when the stage does not ask to resume a session", async () => {
    const promptPath = writePrompt("Prompt.");
    const fake = createFakeStage(RESPONSE);

    await runStage(promptPath, {}, fake.exec, GREETING, { stage: "test" });

    expect(fake.calls[0]).not.toContain("--resume");
  });

  it("returns the parsed value when the exec answers with a StageReply object", async () => {
    const promptPath = writePrompt("Prompt.");
    const fake = createFakeStage({ text: RESPONSE, sessionId: "sess-456" });

    await expect(runStage(promptPath, {}, fake.exec, GREETING, { stage: "test" })).resolves.toEqual({
      greeting: "hi",
    });
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

  it("gets its own answer, second, not the checkpoint the first one just wrote", async () => {
    expect(await runShared("second")).toEqual({ spawned: true, value: { greeting: "second" } });
  });
});

describe("runStageSession", () => {
  it("returns the session id the exec reported", async () => {
    const promptPath = writePrompt("Prompt.");
    const fake = createFakeStage({ text: RESPONSE, sessionId: "sess-789" });

    await expect(
      runStageSession(promptPath, {}, fake.exec, GREETING, { stage: "test" }),
    ).resolves.toEqual({
      value: { greeting: "hi" },
      sessionId: "sess-789",
    });
  });

  it("surfaces the turn count and gauntlet run count a StageReply carried", async () => {
    const promptPath = writePrompt("Prompt.");
    const fake = createFakeStage({ text: RESPONSE, sessionId: "sess-999", turns: 41, gauntletRuns: 3 });

    await expect(
      runStageSession(promptPath, {}, fake.exec, GREETING, { stage: "test" }),
    ).resolves.toEqual({
      value: { greeting: "hi" },
      sessionId: "sess-999",
      turns: 41,
      gauntletRuns: 3,
    });
  });

  it("leaves the session id undefined on a checkpoint hit", async () => {
    const promptPath = writePrompt("Checkpointed prompt for runStageSession.");
    const fake = createFakeStage({ text: RESPONSE, sessionId: "sess-first" });

    await runStageSession(promptPath, {}, fake.exec, GREETING, { stage: "session-checkpoint-hit" });

    const unreachable: StageExec = async () => {
      throw new Error("StageExec should not have been called for a checkpoint hit");
    };

    await expect(
      runStageSession(promptPath, {}, unreachable, GREETING, { stage: "session-checkpoint-hit" }),
    ).resolves.toEqual({
      value: { greeting: "hi" },
      sessionId: undefined,
    });
  });
});

describe("runStageSessionWithinBudget", () => {
  const TICKET = 494;
  const RUN: LaneRunRef = { id: 777, url: "https://github.com/o/r/actions/runs/777" };
  const BUDGET_MS = laneBudget("implement") * 60_000;
  const TIMED_OUT = `timed out after ${laneBudget("implement")} minutes at implementer`;

  afterEach(() => {
    vi.useRealTimers();
  });

  function trackerWith(priorComments: string[]) {
    const posted: string[] = [];
    const gh: GhExec = (args) => {
      if (args[0] === "issue" && args[1] === "view") {
        return JSON.stringify({ comments: priorComments.map((body) => ({ body })) });
      }
      if (args[0] === "issue" && args[1] === "comment") {
        posted.push(args[args.indexOf("--body") + 1]);
        return "";
      }
      throw new Error(`unexpected gh ${args.join(" ")}`);
    };
    return { gh, posted };
  }

  function modelThatNeverAnswers() {
    const killed: boolean[] = [];
    const exec: StageExec = (_argv, _stdin, signal) =>
      new Promise((_resolve, reject) => {
        signal?.addEventListener("abort", () => {
          killed.push(true);
          reject(new Error("the model process was killed"));
        });
      });
    return { exec, killed };
  }

  async function settledAfter<T>(running: Promise<T>, ms: number): Promise<string> {
    const settled = running.then(
      () => "answered",
      (err: unknown) => errorMessage(err),
    );
    await vi.advanceTimersByTimeAsync(ms);
    return Promise.race([settled, Promise.resolve("still running")]);
  }

  async function expireOn(ticket: LaneTicket | undefined, stage = "implementer") {
    vi.useFakeTimers();
    const promptPath = writePrompt(`A prompt the budget runs out on at ${stage}.`);
    const model = modelThatNeverAnswers();
    const budget = startLaneBudget(laneBudget("implement"), ticket);
    const running = runStageSessionWithinBudget(promptPath, {}, model.exec, GREETING, { stage, budget });
    const before = await settledAfter(running, BUDGET_MS - 1);
    const after = await settledAfter(running, 1);
    return { before, after, killed: model.killed };
  }

  it("kills the model process and writes a `timed out after 85 minutes at implementer` strike when the clock reaches the budget", async () => {
    const tracker = trackerWith([]);

    const outcome = await expireOn({ gh: tracker.gh, ticket: TICKET, run: RUN });

    expect(outcome).toEqual({ before: "still running", after: TIMED_OUT, killed: [true] });
    expect(tracker.posted).toEqual([strikeBody({ runId: RUN.id, conclusion: "failure", signature: TIMED_OUT }, RUN.url, "fresh-eyes")]);
  });

  it("names the rung after the strikes already on the ticket, as reconcile would", async () => {
    const earlier = strikeBody({ runId: 1, conclusion: "cancelled", signature: "cancelled before answering" }, "u", "fresh-eyes");
    const tracker = trackerWith([earlier]);

    await expireOn({ gh: tracker.gh, ticket: TICKET, run: RUN });

    expect(tracker.posted[0]).toContain("Next: the mechanic");
  });

  it("still says so on the ticket off the runner, without a strike marker no dead run could match", async () => {
    const tracker = trackerWith([]);

    const outcome = await expireOn({ gh: tracker.gh, ticket: TICKET });

    expect(outcome.after).toBe(TIMED_OUT);
    expect(tracker.posted).toHaveLength(1);
    expect(tracker.posted[0]).toContain(TIMED_OUT);
    expect(tracker.posted[0]).not.toContain("<!-- strike:v1");
  });

  it("returns the stage's answer and writes nothing when the model answers inside the budget", async () => {
    const promptPath = writePrompt("A prompt answered in time.");
    const tracker = trackerWith([]);
    const budget = startLaneBudget(laneBudget("implement"), { gh: tracker.gh, ticket: TICKET, run: RUN });

    const answered = await runStageSessionWithinBudget(promptPath, {}, createFakeStage(RESPONSE).exec, GREETING, {
      stage: "in-budget",
      budget,
    });

    expect(answered.value).toEqual({ greeting: "hi" });
    expect(tracker.posted).toEqual([]);
  });

  it("lets a stage's own failure through untouched while the budget still has time", async () => {
    const promptPath = writePrompt("A prompt whose model dies on its own.");
    const tracker = trackerWith([]);
    const budget = startLaneBudget(laneBudget("implement"), { gh: tracker.gh, ticket: TICKET, run: RUN });
    const dies: StageExec = async () => {
      throw new Error("`claude` exited 1");
    };

    await expect(runStageSessionWithinBudget(promptPath, {}, dies, GREETING, { stage: "dies-alone", budget })).rejects.toThrow(
      "`claude` exited 1",
    );
    expect(tracker.posted).toEqual([]);
  });
});

describe("currentLaneRun", () => {
  it("names the Actions run this lane is inside from the runner's own environment", () => {
    expect(
      currentLaneRun({ GITHUB_RUN_ID: "42", GITHUB_SERVER_URL: "https://github.com", GITHUB_REPOSITORY: "o/r" }),
    ).toEqual({ id: 42, url: "https://github.com/o/r/actions/runs/42" });
  });

  it("is undefined off the runner", () => {
    expect(currentLaneRun({})).toBeUndefined();
  });
});
