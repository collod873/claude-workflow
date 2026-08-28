import { describe, expect, it } from "vitest";
import type { GhExec } from "../shared/gh";
import type { StageExec } from "../shared/stage";
import { createFakeStage } from "../shared/stage.fake";
import { SLICEABLE_LABEL, SPEC_DISPATCH_EVENT_TYPE } from "./open-questions";
import { openQuestionsComment } from "./rounds";
import {
  invocationFromEnv,
  runSpecAuthor,
  runSpecCritique,
  SPEC_AUTHOR_ALLOWED_TOOLS,
  type DecidedContext,
} from "./spec";

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

/**
 * ADR-0085's second door: a spec written by `/to-spec` in a live session lands on the tracker
 * already drafted, so the run enters lane 02 at the critic and skips the author entirely.
 * Everything past the critic is the runner path's own — the same `gateCount`, the same `applyGate`.
 */
describe("runSpecCritique — the critic-only entry", () => {
  const SPEC = {
    title: "PRD: A spec written in a session",
    body: "## Problem\nIt stalls on the tracker.",
  };

  /** A fake `GhExec` answering the two reads this path makes, and recording every call verbatim. */
  function fakeGh(comments: string[] = []): { gh: GhExec; calls: string[][] } {
    const calls: string[][] = [];
    const gh: GhExec = (args) => {
      calls.push([...args]);
      if (args[0] === "issue" && args[1] === "view") {
        const fields = args[args.indexOf("--json") + 1] ?? "";
        if (fields === "title,body") return JSON.stringify(SPEC);
        if (fields === "comments") {
          return JSON.stringify({ comments: comments.map((body) => ({ body })) });
        }
        throw new Error(`fake gh: unhandled fields: ${fields}`);
      }
      return "";
    };
    return { gh, calls };
  }

  it("reads the issue's own title and body and hands them to the critic", async () => {
    const fake = createFakeStage(SILENT_CRITIC);
    const { gh } = fakeGh();

    await runSpecCritique(fake.exec, gh, 180);

    const prompt = fake.stdins[0] ?? "";
    expect(prompt).toContain(SPEC.title);
    expect(prompt).toContain(SPEC.body);
  });

  it("never runs the author's stage — the expensive half already happened in the session", async () => {
    // One Opus stage where the cold doors cost two. The author is the only stage in this lane
    // bound by `--allowedTools` (ADR-0060), so its absence from every argv is what says it never
    // ran — checked alongside the call count, which pins the stage that did run as the only one.
    const fake = createFakeStage(SILENT_CRITIC);
    const { gh } = fakeGh();

    await runSpecCritique(fake.exec, gh, 180);

    expect(fake.calls).toHaveLength(1);
    for (const argv of fake.calls) {
      expect(argv).not.toContain("--allowedTools");
      expect(argv).not.toContain(SPEC_AUTHOR_ALLOWED_TOOLS.join(","));
    }
  });

  it("passes the owner's answering comments to the critic, and not this lane's own rounds", async () => {
    const fake = createFakeStage(SILENT_CRITIC);
    const { gh } = fakeGh([
      openQuestionsComment(["what does done mean?"]),
      "done means the gauntlet exits 0",
    ]);

    await runSpecCritique(fake.exec, gh, 180);

    const prompt = fake.stdins[0] ?? "";
    expect(prompt).toContain("done means the gauntlet exits 0");
    expect(prompt).not.toContain("1. what does done mean?");
  });

  it("adds sliceable and sends the dispatch when the critic found nothing", async () => {
    const fake = createFakeStage(SILENT_CRITIC);
    const { gh, calls } = fakeGh();

    const result = await runSpecCritique(fake.exec, gh, 180);

    expect(result).toMatchObject({ issueNumber: 180, gateCount: 0, outcome: "dispatched" });

    const labelWrite = calls.find((args) => args.includes("--add-label"));
    expect(labelWrite).toContain(SLICEABLE_LABEL);

    const dispatch = calls.find(
      (args) => args[0] === "api" && args[1] === "repos/{owner}/{repo}/dispatches",
    );
    expect(dispatch).toContain(`event_type=${SPEC_DISPATCH_EVENT_TYPE}`);
    expect(dispatch).toContain("client_payload[issue]=180");
  });

  it("comments the numbered questions and sends no dispatch when the critic found something", async () => {
    const fake = createFakeStage(
      JSON.stringify({ findings: ["\"handles errors gracefully\" admits two implementations."] }),
    );
    const { gh, calls } = fakeGh();

    const result = await runSpecCritique(fake.exec, gh, 180);

    expect(result).toMatchObject({ gateCount: 1, outcome: "held" });

    expect(calls.filter((args) => args.includes(SLICEABLE_LABEL))).toHaveLength(0);
    expect(
      calls.filter((args) => args[0] === "api" && args[1] === "repos/{owner}/{repo}/dispatches"),
    ).toHaveLength(0);

    const comment = calls.find((args) => args[0] === "issue" && args[1] === "comment");
    expect(comment?.[comment.indexOf("--body") + 1]).toContain(
      "1. \"handles errors gracefully\" admits two implementations.",
    );
  });

  it("publishes nothing — the spec is already on the tracker", async () => {
    const fake = createFakeStage(SILENT_CRITIC);
    const { gh, calls } = fakeGh();

    await runSpecCritique(fake.exec, gh, 180);

    expect(calls.filter((args) => args[0] === "issue" && args[1] === "create")).toHaveLength(0);
    expect(calls.filter((args) => args.includes("--body") && args[1] === "edit")).toHaveLength(0);
  });
});

describe("invocationFromEnv", () => {
  it("accepts all four triggers spec.yml can set", () => {
    for (const trigger of ["sheet", "map", "answer", "critique"]) {
      expect(invocationFromEnv({ SPEC_TRIGGER: trigger, ISSUE_NUMBER: "180" })).toEqual({
        trigger,
        issueNumber: 180,
      });
    }
  });

  it("names all four in the error it throws on an unknown one", () => {
    expect(() => invocationFromEnv({ SPEC_TRIGGER: "invented", ISSUE_NUMBER: "180" })).toThrow(
      /sheet, map, answer, critique/,
    );
  });
});
