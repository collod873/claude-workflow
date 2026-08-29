import { describe, expect, it } from "vitest";
import type { GhExec } from "../shared/gh";
import type { StageExec } from "../shared/stage";
import { createFakeStage } from "../shared/stage.fake";
import { acceptedMarker, sheetMarker, type AcceptedPayload } from "../shape/marker";
import type { Sheet } from "../shape/sheet-schema";
import { createIssueGh, type FakeIssueGh } from "./gh.fake";
import { SLICEABLE_LABEL, SPEC_DISPATCH_EVENT_TYPE } from "./open-questions";
import { openQuestionsComment } from "./rounds";
import {
  invocationFromEnv,
  runSpecAuthor,
  runSpecCritique,
  runSpecPublication,
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

/** The body of the round a run posted, or `undefined` when it posted none. */
function postedRound(calls: string[][]): string | undefined {
  const comment = calls.find((args) => args[0] === "issue" && args[1] === "comment");
  return comment?.[comment.indexOf("--body") + 1];
}

/**
 * Asserts a held gate left none of a dispatched one's traces. ADR-0062 makes `sliceable` the
 * durable evidence a dispatch was owed, so a held run writing either is the failure that would let
 * lane 03 slice a spec still carrying questions.
 */
function expectNothingDispatched(calls: string[][]): void {
  expect(calls.filter((args) => args.includes(SLICEABLE_LABEL))).toHaveLength(0);
  expect(
    calls.filter((args) => args[0] === "api" && args[1] === "repos/{owner}/{repo}/dispatches"),
  ).toHaveLength(0);
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
      // A `DecidedContext` handed over directly carries no marks — no collector
      // ran, so there is no sheet behind it to have marked anything.
      decisions: [],
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
 * ADR-0061's arithmetic, end to end through the door that actually carries marks.
 *
 * `gateCount(openQuestions, decisions)` has had a second parameter since it was written and
 * `gateSpec` passed one argument, so `unfiledMarkGap` returned 0 by construction on every real run
 * and the check never once contributed to a gate. These drive the whole sheet door — collector,
 * author, critic, publish, gate — because the seam that was broken is the hand-off between them,
 * and a unit test either side of it is what missed this for as long as it did.
 */
describe("the sheet door — ADR-0061's marks reach the gate", () => {
  const OWNER_WORDS = "make the accept file its own rulings";

  function sheet(decisions: Sheet["decisions"]): Sheet {
    return {
      restatement: "the idea as work",
      priorArt: [],
      decisions,
      survivors: [],
      route: "short",
      routeReason: "Short — one file.",
      newTerms: [],
      round: 0,
    };
  }

  const PAYLOAD: AcceptedPayload = { adrPaths: [], coinedTerms: [], route: "short" };

  /** The accepted idea as the collector reads it: the owner's words, the sheet, the accept. */
  function fakeGh(decisions: Sheet["decisions"]): FakeIssueGh {
    const bodies = [sheetMarker(sheet(decisions)), acceptedMarker(PAYLOAD)];
    return createIssueGh((fields) =>
      fields === "body"
        ? JSON.stringify({ body: OWNER_WORDS })
        : fields === "comments"
          ? JSON.stringify({ comments: bodies.map((body) => ({ body })) })
          : undefined,
    );
  }

  /** The author's draft, then a silent critic — the two stages this door spends. */
  function chain(openQuestions: string[]): StageExec {
    const responses = [
      JSON.stringify({ title: "A spec", body: "## Problem\nIt is unbuilt.", openQuestions }),
      SILENT_CRITIC,
    ];
    let next = 0;
    return async () => responses[next++] ?? SILENT_CRITIC;
  }

  async function runSheetDoor(
    openQuestions: string[],
    decisions: Sheet["decisions"],
  ): Promise<{ result: Awaited<ReturnType<typeof runSpecPublication>>; calls: string[][] }> {
    const { gh, calls } = fakeGh(decisions);
    const result = await runSpecPublication(
      chain(openQuestions),
      gh,
      { mode: "publish", source: { kind: "sheet", issue: 42 } },
      { kind: "sheet", gh, issueNumber: 42 },
    );
    return { result, calls };
  }

  const UNFILED = {
    question: "which module owns the retry?",
    recommendation: "the caller",
    rejected: "the transport",
    mark: "shared/gh.ts",
    adrTitle: "",
  };

  it("holds a draft that asked nothing but was handed one unfiled mark", async () => {
    // The whole of #189's second problem statement: before this, the gate counted zero here and
    // dispatched a spec that had guessed silently about `shared/gh.ts`.
    const { result, calls } = await runSheetDoor([], [UNFILED]);

    expect(result).toMatchObject({ gateCount: 1, outcome: "held" });
    expectNothingDispatched(calls);
  });

  it("names the mark in the round it posts, so a draft that asked nothing still says something", async () => {
    const { calls } = await runSheetDoor([], [UNFILED]);

    const round = postedRound(calls);
    expect(round).toContain(UNFILED.mark);
    expect(round).toContain("1. ");
  });

  it("numbers the questions and the marks as one continuing list", async () => {
    // The owner replies by number, so a mark starting its own `1.` beneath a question already
    // numbered `1.` would make his answer ambiguous (ADR-0061's numbered form).
    const { result, calls } = await runSheetDoor(["What does done mean?"], [UNFILED]);

    expect(result).toMatchObject({ gateCount: 2, outcome: "held" });

    const round = postedRound(calls) ?? "";
    expect(round).toContain("1. What does done mean?");
    expect(round).toMatch(new RegExp(`^2\\. .*${UNFILED.mark.replace(".", "\\.")}`, "m"));
  });

  it("dispatches when every mark the sheet carried is either filed or asked about", async () => {
    // The gate is not simply "a sheet with decisions holds": a decision carrying an ADR title was
    // ruled on, and a mark some question names was surfaced. Neither is a silent guess.
    const filed = { ...UNFILED, mark: "shape/accept.ts", adrTitle: "The accept files its rulings" };
    const { result } = await runSheetDoor([], [filed]);

    expect(result).toMatchObject({ gateCount: 0, outcome: "dispatched" });
  });

  it("counts a question naming the mark once, not once per measure", async () => {
    // `unfiledMarks` filters the decisions a question named out of the set, so the question is the
    // only thing left to count — a draft that did surface its mark is held on that question alone.
    const { result, calls } = await runSheetDoor(
      [`Should \`${UNFILED.mark}\` own the retry?`],
      [UNFILED],
    );

    expect(result).toMatchObject({ gateCount: 1, outcome: "held" });
    expect(postedRound(calls)).toBe(
      openQuestionsComment([`Should \`${UNFILED.mark}\` own the retry?`]),
    );
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

  /** The published spec as this door reads it: its own title and body, plus the owner's comments. */
  function fakeGh(comments: string[] = []): FakeIssueGh {
    return createIssueGh((fields) =>
      fields === "title,body"
        ? JSON.stringify(SPEC)
        : fields === "comments"
          ? JSON.stringify({ comments: comments.map((body) => ({ body })) })
          : undefined,
    );
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
    expectNothingDispatched(calls);

    expect(postedRound(calls)).toContain(
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
