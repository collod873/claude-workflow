import { describe, expect, it } from "vitest";
import type { GhExec } from "../shared/gh";
import type { StageExec } from "../shared/stage";
import { createFakeStage, createFakeStages } from "../shared/stage.fake";
import { acceptedMarker, sheetMarker, type AcceptedPayload } from "../shape/marker";
import type { Sheet } from "../shape/sheet-schema";
import { createIssueGh, type FakeIssueGh } from "./gh.fake";
import { SLICEABLE_LABEL, SPEC_DISPATCH_EVENT_TYPE } from "./open-questions";
import { sourceMarker } from "./publish";
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

/** The sweep's own answer, empty — good enough for a test that does not care what it found. */
const SWEEP_RESPONSE = JSON.stringify({ rulings: [] });

/**
 * A fake `StageExec` that answers the sweep's call with `SWEEP_RESPONSE`, the author's with
 * `RESPONSE`, and the critic's with `SILENT_CRITIC` — good enough for a test that only cares about
 * the author's own argv or prompt, since the sweep's call comes before it and the critic's after it
 * in `fake.calls`.
 */
function fakeChain() {
  return createFakeStages([SWEEP_RESPONSE, RESPONSE, SILENT_CRITIC]);
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
    // nothing that looked different. The sweep (sweep.ts) runs first, on the
    // same allow-list, so the author's own call is the second one.
    const fake = fakeChain();

    await runSpecAuthor(fake.exec, CONTEXT);

    const [, argv] = fake.calls;
    expect(argv[argv.indexOf("--allowedTools") + 1]).toBe("Read,Grep,Glob");
    expect(SPEC_AUTHOR_ALLOWED_TOOLS).toEqual(["Read", "Grep", "Glob"]);
    expect(argv).not.toContain("--disallowedTools");
  });
});

describe("runSpecAuthor", () => {
  it("substitutes the Decided context's own words, decisions, boundaries and open guesses into the author's prompt", async () => {
    const fake = fakeChain();

    await runSpecAuthor(fake.exec, CONTEXT);

    const prompt = fake.stdins[1] ?? "";
    expect(prompt).toContain(CONTEXT.ownerWords);
    expect(prompt).toContain(CONTEXT.decisions);
    expect(prompt).toContain(CONTEXT.boundaries);
    expect(prompt).toContain(CONTEXT.openGuesses);
  });

  it("hands the author the sweep's own rulings rather than the collector's", async () => {
    // sweep.ts's `applySweep` replaces `rulings` rather than appending to it — the author never
    // sees the context's own `rulings` once the sweep has run. A distinct fixture value here,
    // rather than `CONTEXT.rulings`, because "ADR-0060" also appears in the author's own prompt
    // boilerplate and so is not a safe absence to assert on.
    const collectorOnlyRuling = "COLLECTOR-ONLY-RULING-no-sweep-ever-confirmed-this";
    const context = { ...CONTEXT, rulings: collectorOnlyRuling };
    const sweepFinding = JSON.stringify({
      rulings: [
        { ref: "docs/adr/0104-a-ruling-the-sheet-never-cited.md", quote: "found only by the sweep" },
      ],
    });
    const fake = createFakeStages([sweepFinding, RESPONSE, SILENT_CRITIC]);

    await runSpecAuthor(fake.exec, context);

    const prompt = fake.stdins[1] ?? "";
    expect(prompt).toContain("found only by the sweep");
    expect(prompt).not.toContain(collectorOnlyRuling);
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

  it("invokes the sweep, then the author, then the critic — each strictly before the next", async () => {
    // ADR-0062: "the critic runs in the same chain, before publication," and sweep.ts's sweep runs
    // ahead of the author. `runSpecAuthor` is the entrypoint publication is built on, so this checks
    // the whole order lands before this function resolves — by call order on a fake `StageExec`.
    const fake = fakeChain();

    await runSpecAuthor(fake.exec, CONTEXT);

    expect(fake.calls).toHaveLength(3);
    const [sweepArgv, authorArgv, criticArgv] = fake.calls;
    // The sweep and the author both carry the allow list (the sweep reads the author's own); the
    // critic carries neither, so the three argvs are distinguishable by that alone.
    expect(sweepArgv).toContain("--allowedTools");
    expect(authorArgv).toContain("--allowedTools");
    expect(criticArgv).not.toContain("--allowedTools");
  });

  it("folds the critic's findings into openQuestions and never overwrites the author's draft body", async () => {
    const responses = [
      SWEEP_RESPONSE,
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

  /** An empty sweep, the author's draft, then a silent critic — the three stages this door spends. */
  function chain(openQuestions: string[]): StageExec {
    return createFakeStages([
      SWEEP_RESPONSE,
      JSON.stringify({ title: "A spec", body: "## Problem\nIt is unbuilt.", openQuestions }),
      SILENT_CRITIC,
    ]).exec;
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

  /** The body the reconciler hands back, as it comes off the wire and as the write should land it. */
  const REWRITTEN = "## Problem\nIt stalls on the tracker.\n\n## Acceptance criteria\n- [ ] Every consumer is repointed.";
  const RECONCILED = JSON.stringify({ body: REWRITTEN });

  /** One answering comment — enough for ADR-0100's "a spec that answered at least one round". */
  const ANSWER = "Repoint every consumer and delete every duplicate.";

  /** The published spec as this door reads it: its own title and body, plus the owner's comments. */
  function fakeGh(comments: string[] = [], body: string = SPEC.body): FakeIssueGh {
    return createIssueGh((fields) =>
      fields === "title,body"
        ? JSON.stringify({ ...SPEC, body })
        : fields === "comments"
          ? JSON.stringify({ comments: comments.map((commentBody) => ({ body: commentBody })) })
          : undefined,
    );
  }

  /** The `gh issue edit … --body <body>` a run made, or `undefined` when it rewrote nothing. */
  function bodyWrite(calls: string[][]): string | undefined {
    const edit = calls.find(
      (args) => args[0] === "issue" && args[1] === "edit" && args.includes("--body"),
    );
    return edit?.[edit.indexOf("--body") + 1];
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
    const fake = createFakeStages([SILENT_CRITIC, RECONCILED]);
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

  /** ADR-0100, whose home is `reconcile.ts`'s module docstring. */
  describe("re-authoring the body from the answered thread", () => {
    it("rewrites the body from the body and the answers when the count falls to zero", async () => {
      const fake = createFakeStages([SILENT_CRITIC, RECONCILED]);
      const { gh, calls } = fakeGh([openQuestionsComment(["which one?"]), ANSWER]);

      const result = await runSpecCritique(fake.exec, gh, 180);

      expect(result).toMatchObject({ gateCount: 0, outcome: "dispatched", rewritten: true });
      expect(bodyWrite(calls)).toBe(REWRITTEN);

      // One model stage for the rewrite, not a second chain: the reconciler reads the body and the
      // answers, and the answers are what it was given the round for.
      expect(fake.calls).toHaveLength(2);
      const reconcilerPrompt = fake.stdins[1] ?? "";
      expect(reconcilerPrompt).toContain(SPEC.body);
      expect(reconcilerPrompt).toContain(ANSWER);
      expect(reconcilerPrompt).not.toContain("1. which one?");
    });

    it("lands the rewrite before sliceable and before the dispatch, so lane 03 cannot read a stale body", async () => {
      // The whole point of the ordering: `sliceable` is what lane 03's dispatch hangs off, and a
      // spec labelled before it was rewritten is one lane 03 may slice from the argued-down draft.
      const fake = createFakeStages([SILENT_CRITIC, RECONCILED]);
      const { gh, calls } = fakeGh([openQuestionsComment(["which one?"]), ANSWER]);

      await runSpecCritique(fake.exec, gh, 180);

      const wrote = calls.findIndex((args) => args[1] === "edit" && args.includes("--body"));
      const labelled = calls.findIndex((args) => args.includes(SLICEABLE_LABEL));
      const dispatched = calls.findIndex(
        (args) => args[0] === "api" && args[1] === "repos/{owner}/{repo}/dispatches",
      );

      expect(wrote).toBeGreaterThanOrEqual(0);
      expect(wrote).toBeLessThan(labelled);
      expect(labelled).toBeLessThan(dispatched);
    });

    it("rewrites nothing and spawns no second stage when the spec cleared on its first round", async () => {
      // No answering comment means no round was ever answered, so there is nothing to fold in.
      // The guard is the comment list, not a model's judgement of whether it found anything.
      const fake = createFakeStages([SILENT_CRITIC]);
      const { gh, calls } = fakeGh();

      const result = await runSpecCritique(fake.exec, gh, 180);

      expect(result).toMatchObject({ gateCount: 0, outcome: "dispatched", rewritten: false });
      expect(fake.calls).toHaveLength(1);
      expect(bodyWrite(calls)).toBeUndefined();
    });

    it("rewrites nothing when the count is non-zero, and still posts its numbered round", async () => {
      // A held spec has an open round. Re-authoring it would fold in answers to questions that are
      // still being asked, and the owner would be answering a body that had moved under him.
      const finding = "\"handles errors gracefully\" admits two implementations.";
      const fake = createFakeStages([JSON.stringify({ findings: [finding] })]);
      const { gh, calls } = fakeGh([openQuestionsComment(["which one?"]), ANSWER]);

      const result = await runSpecCritique(fake.exec, gh, 180);

      expect(result).toMatchObject({ gateCount: 1, outcome: "held", rewritten: false });
      expect(fake.calls).toHaveLength(1);
      expect(bodyWrite(calls)).toBeUndefined();
      expect(postedRound(calls)).toContain(`1. ${finding}`);
      expectNothingDispatched(calls);
    });

    it("carries the title through unchanged and re-appends the source marker the body carried", async () => {
      // A sheet spec re-labelled by hand reaches this door, and an `answer` whose trailer
      // `planSpecRun` could not read routes here too — neither may lose its provenance.
      const marker = sourceMarker({ kind: "sheet", issue: 42 });
      const fake = createFakeStages([SILENT_CRITIC, RECONCILED]);
      const { gh, calls } = fakeGh([ANSWER], `${SPEC.body}\n\n${marker}`);

      await runSpecCritique(fake.exec, gh, 180);

      const edit = calls.find((args) => args[1] === "edit" && args.includes("--body")) ?? [];
      expect(edit[edit.indexOf("--title") + 1]).toBe(SPEC.title);
      expect(bodyWrite(calls)).toBe(`${REWRITTEN}\n\n${marker}`);

      // Stripped before the model sees it and re-appended by the write, so the trailer is never
      // something a model could duplicate or drop.
      expect(fake.stdins[1]).not.toContain(marker);
    });
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
