import { describe, expect, it } from "vitest";
import type { StageExec } from "../shared/stage";
import { REFUSAL_MARKER, readSheetMarker } from "../shared/marker";
import { LABELS_APPLIED, runChain, SHAPER_DENIED_TOOLS, SWEEP_DENIED_TOOLS, type ChainDeps } from "./shape";
import { createFakeTracker, postedComments, type FakeTracker } from "./tracker.fake";

function stageOf(argv: string[]): "sweep" | "shaper" | "refuter" | "unknown" {
  const model = argv[argv.indexOf("--model") + 1] ?? "";
  if (model.includes("haiku")) return "sweep";
  if (model.includes("opus")) return "shaper";
  if (model.includes("sonnet")) return "refuter";
  return "unknown";
}

interface Spawn {
  argv: string[];
  prompt: string;
}

interface FakeModel {
  exec: StageExec;
  spawns: Spawn[];
}

function createFakeModel(responses: Partial<Record<string, string[]>>): FakeModel {
  const queues = new Map(Object.entries(responses).map(([key, value]) => [key, [...(value ?? [])]]));
  const fake: FakeModel = {
    spawns: [],
    exec: async (argv, stdin) => {
      fake.spawns.push({ argv: [...argv], prompt: stdin ?? argv[argv.indexOf("-p") + 1] });
      const stage = stageOf(argv);
      const queue = queues.get(stage);
      if (!queue || queue.length === 0) throw new Error(`no canned response left for ${stage}`);
      return queue.length === 1 ? queue[0] : queue.shift()!;
    },
  };
  return fake;
}

function block(payload: unknown): string {
  return JSON.stringify(payload);
}

function shaperAnswer(answer: unknown): string {
  return block({ answer });
}

const EMPTY_SWEEP = block({ priorArt: [], readingList: [] });

const ONE_DECISION_SHEET = shaperAnswer({
  kind: "sheet",
  restatement: "the idea as work",
  priorArt: [],
  decisions: [{ question: "q", recommendation: "r", rejected: "x", mark: "", adrTitle: "" }],
  route: "short",
  routeReason: "Short — one file.",
  newTerms: [],
});

const SILENT_REFUTER = block({ survivors: [] });

function depsFor(model: FakeModel, tracker: FakeTracker): ChainDeps {
  return { exec: model.exec, gh: tracker.gh, fetch: () => "injected file" };
}

function stagesSpawned(model: FakeModel): string[] {
  return model.spawns.map((spawn) => stageOf(spawn.argv));
}

function spawnOf(model: FakeModel, stage: string): Spawn {
  return model.spawns.find((spawn) => stageOf(spawn.argv) === stage)!;
}

function healthyModel(): FakeModel {
  return createFakeModel({
    sweep: [EMPTY_SWEEP],
    shaper: [ONE_DECISION_SHEET],
    refuter: [SILENT_REFUTER],
  });
}

function deniedIn(model: FakeModel, stage: string): string[] {
  const { argv } = spawnOf(model, stage);
  return argv[argv.indexOf("--disallowedTools") + 1].split(",");
}

describe("the ordinary run", () => {
  it("spends three stages and posts one sheet", async () => {
    const model = healthyModel();
    const tracker = createFakeTracker();

    const outcome = await runChain(depsFor(model, tracker), 1, "");

    expect(outcome).toEqual({ kind: "posted", round: 0, route: "short", survivors: 0 });
    expect(stagesSpawned(model)).toEqual(["sweep", "shaper", "refuter"]);
    expect(postedComments(tracker)).toHaveLength(1);
  });

  it("posts a sheet whose trailer reads back as the sheet that was rendered", async () => {
    const model = healthyModel();
    const tracker = createFakeTracker();

    await runChain(depsFor(model, tracker), 1, "");

    expect(readSheetMarker(postedComments(tracker)[0])?.route).toBe("short");
  });

  it("hands every stage a prompt with every placeholder substituted", async () => {
    const model = healthyModel();

    await runChain(depsFor(model, createFakeTracker()), 1, "");

    expect(stagesSpawned(model)).toEqual(["sweep", "shaper", "refuter"]);
    for (const spawn of model.spawns) expect(spawn.prompt).not.toContain("{{");
  });
});

describe("the shaper's toolbelt", () => {
  it("is emptied by the CLI, not by the prompt", async () => {
    const model = healthyModel();

    await runChain(depsFor(model, createFakeTracker()), 1, "");

    const denied = deniedIn(model, "shaper");

    expect(denied).toEqual(SHAPER_DENIED_TOOLS);
    expect(denied).toEqual(expect.arrayContaining(["Read", "Grep", "Glob", "Bash", "Task"]));
  });
});

describe("the sweep's toolbelt", () => {
  it("keeps what it searches with and loses every reach past this repo", async () => {
    const model = healthyModel();

    await runChain(depsFor(model, createFakeTracker()), 1, "");

    const denied = deniedIn(model, "sweep");

    expect(denied).toEqual(SWEEP_DENIED_TOOLS);
    expect(denied).toEqual(expect.arrayContaining(["WebFetch", "WebSearch", "Task"]));
    expect(denied).not.toEqual(expect.arrayContaining(["Read", "Grep", "Glob", "Bash"]));
  });

  it("is handed the idea rather than sent to fetch it", async () => {
    const model = healthyModel();
    const tracker = createFakeTracker({ title: "Idea: cap the corpus", body: "it is 52k words" });

    await runChain(depsFor(model, tracker), 1, "");

    const { prompt } = spawnOf(model, "sweep");
    expect(prompt).toContain("Idea: cap the corpus");
    expect(prompt).toContain("it is 52k words");
    expect(prompt).toContain("#1");
  });
});

describe("the stage-1 refusal", () => {
  const duplicate = block({
    priorArt: [{ ref: "#42", url: "https://example.test/42", bearing: "the same ask", verdict: "duplicate" }],
    readingList: [],
  });

  it("never spends the shaper", async () => {
    const model = createFakeModel({ sweep: [duplicate] });
    const tracker = createFakeTracker();

    const outcome = await runChain(depsFor(model, tracker), 1, "");

    expect(outcome).toEqual({ kind: "refused", cause: "already-exists" });
    expect(stagesSpawned(model)).toEqual(["sweep"]);
  });

  it("comments its evidence and labels the issue", async () => {
    const tracker = createFakeTracker();

    await runChain(depsFor(createFakeModel({ sweep: [duplicate] }), tracker), 1, "");

    expect(postedComments(tracker)[0]).toContain("#42");
    expect(postedComments(tracker)[0]).toContain(REFUSAL_MARKER);
    expect(tracker.calls).toContainEqual(["issue", "edit", "1", "--add-label", "shape-refused"]);
    expect(LABELS_APPLIED).toContain("shape-refused");
  });

  it("stands down on a re-run, so the owner's comment is what clears it", async () => {
    const tracker = createFakeTracker({
      comments: new Map([[1, [`refused\n\n${REFUSAL_MARKER}`]]]),
    });
    const model = createFakeModel({
      sweep: [duplicate],
      shaper: [ONE_DECISION_SHEET],
      refuter: [SILENT_REFUTER],
    });

    const outcome = await runChain(depsFor(model, tracker), 1, "it is not the same idea");

    expect(outcome.kind).toBe("posted");
  });
});

describe("the one re-sweep", () => {
  const reSweep = shaperAnswer({ kind: "re-sweep", needs: "the close gate's refusal list", why: "decision 2" });

  it("re-runs the sweep once and then the shaper again", async () => {
    const model = createFakeModel({
      sweep: [EMPTY_SWEEP, EMPTY_SWEEP],
      shaper: [reSweep, ONE_DECISION_SHEET],
      refuter: [SILENT_REFUTER],
    });

    const outcome = await runChain(depsFor(model, createFakeTracker()), 1, "");

    expect(outcome.kind).toBe("posted");
    expect(stagesSpawned(model)).toEqual(["sweep", "shaper", "sweep", "shaper", "refuter"]);
  });

  it("tells the second pass it is the last one", async () => {
    const model = createFakeModel({
      sweep: [EMPTY_SWEEP, EMPTY_SWEEP],
      shaper: [reSweep, ONE_DECISION_SHEET],
      refuter: [SILENT_REFUTER],
    });

    await runChain(depsFor(model, createFakeTracker()), 1, "");

    const secondShaper = model.spawns.filter((spawn) => stageOf(spawn.argv) === "shaper")[1];
    expect(secondShaper.prompt).toContain("This is your last pass");
  });

  it("fails rather than looping when the shaper asks twice", async () => {
    const model = createFakeModel({
      sweep: [EMPTY_SWEEP, EMPTY_SWEEP],
      shaper: [reSweep, reSweep],
    });

    await expect(runChain(depsFor(model, createFakeTracker()), 1, "")).rejects.toThrow(
      /caps at one/,
    );
  });
});

describe("the refusal to shape", () => {
  it("hands back a tree that will not close under five decisions", async () => {
    const seven = shaperAnswer({
      kind: "sheet",
      restatement: "…",
      priorArt: [],
      decisions: Array.from({ length: 7 }, () => ({
        question: "q",
        recommendation: "r",
        rejected: "x",
        mark: "",
        adrTitle: "",
      })),
      route: "long",
      routeReason: "…",
      newTerms: [],
    });
    const model = createFakeModel({ sweep: [EMPTY_SWEEP], shaper: [seven] });
    const tracker = createFakeTracker();

    const outcome = await runChain(depsFor(model, tracker), 1, "");

    expect(outcome).toEqual({ kind: "needs-live-session", decisions: 7 });
    expect(stagesSpawned(model)).toEqual(["sweep", "shaper"]);
    expect(postedComments(tracker)[0]).toContain("live session");
    expect(tracker.calls).toContainEqual(["issue", "edit", "1", "--add-label", "needs-human"]);
    expect(LABELS_APPLIED).toContain("needs-human");
  });
});

describe("the spent change-request budget", () => {
  it("posts nothing and spends no model", async () => {
    const sheets = [0, 1, 2].map((round) =>
      `<!-- decision-sheet:v1 ${JSON.stringify({
        restatement: "r",
        priorArt: [],
        decisions: [],
        survivors: [],
        route: "short",
        routeReason: "…",
        newTerms: [],
        round,
      })} -->`,
    );
    const model = createFakeModel({});
    const tracker = createFakeTracker({ comments: new Map([[1, sheets]]) });

    const outcome = await runChain(depsFor(model, tracker), 1, "one more thing");

    expect(outcome).toEqual({ kind: "capped" });
    expect(model.spawns).toHaveLength(0);
    expect(postedComments(tracker)[0]).toContain("approved");
  });
});

describe("a change request", () => {
  it("reaches the sweep as an explicit target and the shaper as the ask", async () => {
    const tracker = createFakeTracker({
      comments: new Map([[1, [`<!-- decision-sheet:v1 {"restatement":"r","priorArt":[],"decisions":[],"survivors":[],"route":"short","routeReason":"x","newTerms":[],"round":0} -->`]]]),
    });
    const model = healthyModel();

    await runChain(depsFor(model, tracker), 1, "you missed the close gate");

    expect(spawnOf(model, "sweep").prompt).toContain("you missed the close gate");
    expect(spawnOf(model, "shaper").prompt).toContain("you missed the close gate");
  });

  it("is absent from a first-round prompt rather than empty in it", async () => {
    const model = healthyModel();

    await runChain(depsFor(model, createFakeTracker()), 1, "");

    expect(spawnOf(model, "shaper").prompt).not.toContain("change request");
  });
});
