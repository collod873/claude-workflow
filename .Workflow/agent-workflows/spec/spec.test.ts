import { describe, expect, it } from "vitest";
import type { StageExec } from "../shared/stage";
import { createFakeStage } from "../shared/stage.fake";
import { runSpecAuthor, SPEC_AUTHOR_ALLOWED_TOOLS, type DecidedContext } from "./spec";

const CONTEXT: DecidedContext = {
  ownerWords: "the owner's words",
  decisions: "a decision, with its reason",
  rulings: "ADR-0060",
  boundaries: "a boundary",
  openGuesses: "none yet",
};

const RESPONSE = JSON.stringify({
  title: "A spec",
  body: "The whole statement of the work.",
  openQuestions: [],
});

const SILENT_CRITIC = JSON.stringify({ findings: [] });

/**
 * A fake `StageExec` that answers the author's call with `RESPONSE` and
 * every later call (the critic) with `SILENT_CRITIC` — good enough for a
 * test that only cares about the author's own argv or prompt, since the
 * critic's call comes after it in `fake.calls`.
 */
function fakeChain() {
  const responses = [RESPONSE, SILENT_CRITIC];
  const calls: string[][] = [];
  const stdins: Array<string | undefined> = [];
  const exec: StageExec = async (argv, stdin) => {
    calls.push(argv);
    stdins.push(stdin);
    return responses[calls.length - 1] ?? SILENT_CRITIC;
  };
  return { exec, calls, stdins };
}

describe("the spec author's toolbelt", () => {
  it("is invoked through runStage with exactly Read, Grep, Glob allowed, and no disallowedTools", async () => {
    // ADR-0060: an allow list, enforced by the CLI rather than the prompt —
    // asserted on the argv, because a prompt-only prohibition would leave
    // nothing that looked different.
    const fake = fakeChain();

    await runSpecAuthor(fake.exec, CONTEXT);

    const [argv] = fake.calls;
    expect(argv[argv.indexOf("--allowedTools") + 1]).toBe("Read,Grep,Glob");
    expect(SPEC_AUTHOR_ALLOWED_TOOLS).toEqual(["Read", "Grep", "Glob"]);
    expect(argv).not.toContain("--disallowedTools");
  });
});

describe("runSpecAuthor", () => {
  it("substitutes the Decided context's five fields into the prompt", async () => {
    const fake = fakeChain();

    await runSpecAuthor(fake.exec, CONTEXT);

    const prompt = fake.stdins[0] ?? "";
    expect(prompt).toContain(CONTEXT.ownerWords);
    expect(prompt).toContain(CONTEXT.decisions);
    expect(prompt).toContain(CONTEXT.rulings);
    expect(prompt).toContain(CONTEXT.boundaries);
    expect(prompt).toContain(CONTEXT.openGuesses);
  });

  it("returns the response parsed as a PRD title, body and open-questions payload", async () => {
    const fake = fakeChain();

    await expect(runSpecAuthor(fake.exec, CONTEXT)).resolves.toEqual({
      title: "A spec",
      body: "The whole statement of the work.",
      openQuestions: [],
    });
  });

  it("invokes the critic stage after the author stage and before returning (publication)", async () => {
    // ADR-0062: "the critic runs in the same chain, before publication."
    // `runSpecAuthor` is the entrypoint publication is built on, so "before
    // publication" here means the critic's call has landed before this
    // function resolves — checked by call order on a fake `StageExec`.
    const fake = fakeChain();

    await runSpecAuthor(fake.exec, CONTEXT);

    expect(fake.calls).toHaveLength(2);
    const [authorArgv, criticArgv] = fake.calls;
    // The author is the Read/Grep/Glob-bound stage; the critic carries no
    // such allow list, so the two argvs are distinguishable by that alone.
    expect(authorArgv).toContain("--allowedTools");
    expect(criticArgv).not.toContain("--allowedTools");
  });

  it("folds the critic's findings into openQuestions and never overwrites the author's draft body", async () => {
    const responses = [
      RESPONSE,
      JSON.stringify({
        findings: ["\"handles errors gracefully\" admits two implementations."],
      }),
    ];
    const exec: StageExec = async () => responses.shift() ?? SILENT_CRITIC;

    const result = await runSpecAuthor(exec, CONTEXT);

    expect(result.body).toBe("The whole statement of the work.");
    expect(result.openQuestions).toEqual([
      "\"handles errors gracefully\" admits two implementations.",
    ]);
  });
});
