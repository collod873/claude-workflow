import { describe, expect, it, test } from "vitest";
import { frontmatterBlock } from "../shared/adr-frontmatter";
import type { GhExec } from "../shared/gh";
import { errorMessage } from "../shared/reason";
import { SPEC_AUTHOR_DISPATCH_EVENT_TYPE } from "../shared/spec-author-dispatch";
import { accept, insertTerm, type AcceptDeps, type AcceptOutcome } from "./accept";
import { sheetMarker } from "../shared/marker";
import type { Decision, Sheet, Term } from "../shared/sheet-schema";
import { createFakeTracker, postedComments, type FakeTracker } from "./tracker.fake";
import { trackerMemory } from "../shared/tracker-memory";

function frontmatterOf(content: string): string {
  const block = frontmatterBlock(content);
  if (block === undefined) throw new Error(`no frontmatter block in:\n${content}`);
  return block;
}

const REVERSAL = "Undoing it means re-routing every item by hand, in every lane that reads the route.";

function decision(over: Partial<Decision> = {}): Decision {
  return { question: "q", recommendation: "r", rejected: "x", mark: "", adrTitle: "", adrReversal: "", ...over };
}

function sheet(over: Partial<Sheet> = {}): Sheet {
  return {
    restatement: "the idea as work",
    priorArt: [],
    decisions: [decision()],
    survivors: [],
    route: "short",
    routeReason: "Short: one file.",
    newTerms: [],
    round: 0,
    ...over,
  };
}

interface Harness {
  deps: AcceptDeps;
  tracker: FakeTracker;
  files: Map<string, string>;
  git: string[][];
  adrTitles: string[];
}

function harness(options: { sheet?: Sheet; labels?: string[]; losePushes?: number } = {}): Harness {
  const comments = options.sheet ? [`## Restatement\n\n…\n\n${sheetMarker(options.sheet)}`] : [];
  const tracker = createFakeTracker({
    comments: new Map([[1, comments]]),
    labels: new Map([[1, options.labels ?? []]]),
  });

  const files = new Map<string, string>([["CONTEXT.md", CONTEXT_FIXTURE]]);
  const git: string[][] = [];
  const adrTitles: string[] = [];
  let nextAdr = 50;
  let lostPushes = 0;
  const deps: AcceptDeps = {
    gh: tracker.gh,
    git: (args) => {
      git.push([...args]);
      if (args[0] === "push" && lostPushes < (options.losePushes ?? 0)) {
        lostPushes += 1;
        throw new Error(
          "! [rejected]        HEAD -> main (non-fast-forward)\nhint: Updates were rejected because the tip of your current branch is behind. fetch first",
        );
      }
      return "";
    },
    newAdr: (title) => {
      adrTitles.push(title);
      const path = `docs/adr/draft-slug-${adrTitles.length}.md`;
      files.set(path, `---\nstatus: constraint\ndate: 2026-08-26\nreversal:\n---\n\n# ${title}\n`);
      return `${path}\n`;
    },
    landAdr: (draftPath) => {
      const body = files.get(draftPath);
      if (body === undefined) throw new Error(`landed a draft that was never created: ${draftPath}`);
      nextAdr += 1;
      const path = `docs/adr/${String(nextAdr).padStart(4, "0")}-slug.md`;
      files.delete(draftPath);
      files.set(path, body);
      return `${path}\n`;
    },
    readFile: (path) => {
      const found = files.get(path);
      if (found === undefined) throw new Error(`no such file: ${path}`);
      return found;
    },
    writeFile: (path, content) => void files.set(path, content),
    sleep: async () => {},
    log: () => {},
  };

  return { deps, tracker, files, git, adrTitles };
}

function harnessFor(over: Partial<Decision>): Harness {
  return harness({ sheet: sheet({ decisions: [decision(over)] }) });
}

const ADR_RULING: Partial<Decision> = { mark: "a file", adrTitle: "A ruling", adrReversal: REVERSAL };

function pushAttempts(calls: string[][]): string[][] {
  return calls.filter((call) => call[0] === "push");
}

async function outcomeOf(result: AcceptOutcome | Promise<AcceptOutcome>): Promise<AcceptOutcome> {
  return await result;
}

async function reportOf(
  run: () => AcceptOutcome | Promise<AcceptOutcome>,
  tracker: FakeTracker,
): Promise<string> {
  try {
    await run();
  } catch (raised) {
    return errorMessage(raised);
  }
  return postedComments(tracker).join("\n\n");
}

const CONTEXT_FIXTURE = `# Workflow

## Language

### The record

**Era**:
A complete workflow system.

### Mechanisms

**Gate**:
Something that refuses an action.

### The pipeline

**Lane**:
A named group of edges.
`;

describe("parked", () => {
  it("drops `idea` and does nothing else", async () => {
    const { deps, tracker } = harness({ sheet: sheet() });

    expect(await accept(deps, 1, "parked")).toEqual({ kind: "parked" });
    expect(tracker.calls).toEqual([["issue", "edit", "1", "--remove-label", "idea", "--remove-label", "1-decide"]]);
  });
});

describe("killed", () => {
  it("closes the issue as not planned, so it becomes prior art with teeth", async () => {
    const { deps, tracker } = harness({ sheet: sheet() });

    expect(await accept(deps, 1, "killed")).toEqual({ kind: "killed" });
    expect(tracker.calls).toContainEqual(["issue", "close", "1", "--reason", "not planned"]);
  });

  it("does not close as completed, which §6's fourth counter reads", async () => {
    const { deps, tracker } = harness({ sheet: sheet() });

    await accept(deps, 1, "killed");

    expect(tracker.calls.flat()).not.toContain("completed");
  });
});

describe("approved", () => {
  it("files an ADR for a decision carrying both a mark and a title", async () => {
    const { deps, adrTitles, files } = harness({
      sheet: sheet({
        decisions: [decision({ mark: "ADR-0007's routing rule", adrTitle: "The ruling as a sentence", adrReversal: REVERSAL })],
      }),
    });

    const outcome = await accept(deps, 1, "approved");

    expect(adrTitles).toEqual(["The ruling as a sentence"]);
    expect(outcome).toMatchObject({ kind: "approved", adrs: ["docs/adr/0051-slug.md"] });
    expect(files.get("docs/adr/0051-slug.md")).toContain("x");
    expect(files.get("docs/adr/0051-slug.md")).toContain("ADR-0007's routing rule");
  });

  it("files nothing for a title with no mark", async () => {
    const { deps, adrTitles } = harnessFor({ adrTitle: "A ruling" });

    expect(await accept(deps, 1, "approved")).toMatchObject({ adrs: [] });
    expect(adrTitles).toEqual([]);
  });

  it("files nothing for a mark with no title", async () => {
    const { deps, adrTitles } = harnessFor({ mark: "a file" });

    await accept(deps, 1, "approved");
    expect(adrTitles).toEqual([]);
  });

  it("files nothing for a title and mark with no reversal sentence", async () => {
    const { deps, adrTitles } = harnessFor({ mark: "a file", adrTitle: "A ruling" });

    expect(await accept(deps, 1, "approved")).toMatchObject({ adrs: [] });
    expect(adrTitles).toEqual([]);
  });

  it("writes the reversal sentence into the landed ADR's frontmatter, not its body", async () => {
    const { deps, files } = harnessFor({ mark: "a file", adrTitle: "A ruling", adrReversal: REVERSAL });

    await accept(deps, 1, "approved");

    const landed = files.get("docs/adr/0051-slug.md")!;
    expect(frontmatterOf(landed)).toContain(`reversal: ${REVERSAL}`);
    expect(landed.slice(landed.indexOf("\n---\n", 4))).not.toContain(REVERSAL);
  });

  it("flattens a multi-line reversal sentence, which would otherwise end the key mid-value", async () => {
    const { deps, files } = harness({
      sheet: sheet({
        decisions: [decision({ mark: "a file", adrTitle: "A ruling", adrReversal: "Undoing it costs\na second pass." })],
      }),
    });

    await accept(deps, 1, "approved");

    expect(frontmatterOf(files.get("docs/adr/0051-slug.md")!)).toContain("reversal: Undoing it costs a second pass.");
  });

  it("coins a term into its own section of CONTEXT.md", async () => {
    const term: Term = {
      term: "Sheet round",
      definition: "One pass of the shaper over an idea.",
      avoid: ["iteration"],
      section: "The pipeline",
    };
    const { deps, files } = harness({ sheet: sheet({ newTerms: [term] }) });

    await accept(deps, 1, "approved");

    const contents = files.get("CONTEXT.md")!;
    expect(contents).toContain("**Sheet round**:");
    expect(contents.indexOf("**Sheet round**:")).toBeGreaterThan(contents.indexOf("### The pipeline"));
  });

  it("commits and pushes what it wrote, straight to main", async () => {
    const { deps, git } = harnessFor({ mark: "a file", adrTitle: "A ruling", adrReversal: REVERSAL });

    await accept(deps, 1, "approved");

    expect(git.map((call) => call[0])).toEqual([
      "add",
      "commit",
      "fetch",
      "rebase",
      "push",
    ]);
    expect(git.at(-1)).toEqual(["push", "origin", "HEAD:main"]);
  });

  it("stages only CONTEXT.md when the sheet coined a term but filed no ADR", async () => {
    const term: Term = {
      term: "Sheet round",
      section: "The pipeline",
      definition: "One pass of the chain.",
      avoid: [],
    };
    const { deps, git } = harness({ sheet: sheet({ newTerms: [term] }) });

    await accept(deps, 1, "approved");

    expect(git.find((call) => call[0] === "add")).toEqual(["add", "CONTEXT.md"]);
  });

  it("writes no commit when the sheet decided nothing worth filing", async () => {
    const { deps, git } = harness({ sheet: sheet() });

    await accept(deps, 1, "approved");

    expect(git).toEqual([]);
  });

  it("records the sheet's route", async () => {
    const { deps } = harness({ sheet: sheet({ route: "long" }) });

    expect(await accept(deps, 1, "approved")).toMatchObject({ route: "long" });
  });

  it("takes ADR-0007's one-word override off the labels", async () => {
    const { deps, tracker } = harness({ sheet: sheet({ route: "short" }), labels: ["go-long"] });

    expect(await accept(deps, 1, "approved")).toMatchObject({ route: "long" });
    expect(postedComments(tracker)[0]).toContain("overriding the sheet's `short`");
  });

  it("takes the survivable route when both overrides are somehow present", async () => {
    const { deps } = harness({ sheet: sheet(), labels: ["go-long", "go-short"] });

    expect(await accept(deps, 1, "approved")).toMatchObject({ route: "long" });
  });

  it("dispatches lane 02, and says so on the issue", async () => {
    const { deps, tracker } = harness({ sheet: sheet() });

    await accept(deps, 1, "approved");

    expect(postedComments(tracker)[0]).toContain("Dispatched to lane 02");
    expect(postedComments(tracker)[0]).not.toContain("Not dispatched");
  });

  it("sends the dispatch after the comment carrying the marker the collector reads", async () => {
    const { deps, tracker } = harness({ sheet: sheet() });

    await accept(deps, 1, "approved");

    const commentIndex = tracker.calls.findIndex(
      (args) => args[0] === "issue" && args[1] === "comment",
    );
    const dispatchIndex = tracker.calls.findIndex(
      (args) => args[0] === "api" && args[1] === "repos/{owner}/{repo}/dispatches",
    );
    expect(commentIndex).toBeGreaterThan(-1);
    expect(dispatchIndex).toBeGreaterThan(commentIndex);
    expect(tracker.calls[dispatchIndex]).toContain(`event_type=${SPEC_AUTHOR_DISPATCH_EVENT_TYPE}`);
    expect(tracker.calls[dispatchIndex]).toContain("client_payload[issue]=1");
  });

  it("swaps the spent verb for the lane that is now owed", async () => {
    const { deps, tracker } = harness({ sheet: sheet() });

    await accept(deps, 1, "approved");

    const swap = tracker.calls.find(
      (args) => args[0] === "issue" && args[1] === "edit" && args.includes("to-spec"),
    );
    expect(swap).toBeDefined();
    expect(swap).toContain("--add-label");
    expect(swap).toContain("to-spec");
    expect(swap).toContain("--remove-label");
    expect(swap).toContain("approved");
  });

  it("refuses to invent a route when there is no sheet to read", async () => {
    const { deps, tracker, git } = harness();

    expect(await accept(deps, 1, "approved")).toEqual({ kind: "no-sheet", verb: "approved" });
    expect(git).toEqual([]);
    expect(tracker.calls.flat()).not.toContain("--remove-label");
  });
});

describe("coining a term", () => {
  it("leaves the file alone when the section is gone", () => {
    const term: Term = { term: "X", definition: "d", avoid: [], section: "The charter" };

    expect(insertTerm(CONTEXT_FIXTURE, term)).toBeUndefined();
  });

  it("does not coin a term the file already carries", async () => {
    const term: Term = { term: "Gate", definition: "different", avoid: [], section: "Mechanisms" };
    const { deps, files } = harness({ sheet: sheet({ newTerms: [term] }) });

    await accept(deps, 1, "approved");

    expect(files.get("CONTEXT.md")).not.toContain("different");
  });

  it("omits the _Avoid_ line when there is nothing to avoid", () => {
    const term: Term = { term: "X", definition: "d", avoid: [], section: "Mechanisms" };

    expect(insertTerm(CONTEXT_FIXTURE, term)).toContain("**X**:\nd\n");
    expect(insertTerm(CONTEXT_FIXTURE, term)).not.toContain("_Avoid_: \n");
  });
});

describe("re-applying a verb", () => {
  it("does not file a second copy of every ruling", async () => {
    const shaped = sheet({ decisions: [decision({ mark: "a file", adrTitle: "A ruling", adrReversal: REVERSAL })] });
    const { deps, adrTitles, git } = harness({ sheet: shaped });

    await accept(deps, 1, "approved");
    expect(adrTitles).toHaveLength(1);

    const second = harness({ sheet: shaped });
    second.tracker.comments.set(1, [
      ...(second.tracker.comments.get(1) ?? []),
      "## Accepted\n\n<!-- shape-accepted:v1 -->",
    ]);

    expect(await accept(second.deps, 1, "approved")).toEqual({ kind: "already-accepted" });
    expect(second.adrTitles).toEqual([]);
    expect(second.git).toEqual([]);
    expect(git).not.toEqual([]);
  });

  it("marks its own comment, which is what makes that readable", async () => {
    const { deps, tracker } = harness({ sheet: sheet() });

    await accept(deps, 1, "approved");

    expect(postedComments(tracker)[0]).toContain("<!-- shape-accepted:v1");
  });

  it("carries the ADR paths, coined terms and route in the marker's payload", async () => {
    const term: Term = { term: "X", definition: "d", avoid: [], section: "Mechanisms" };
    const { deps, tracker } = harness({
      sheet: sheet({
        decisions: [decision({ mark: "a mark", adrTitle: "A ruling", adrReversal: REVERSAL })],
        newTerms: [term],
      }),
    });

    await accept(deps, 1, "approved");

    const posted = postedComments(tracker)[0] ?? "";
    expect(posted).toContain('"adrPaths":["docs/adr/0051-slug.md"]');
    expect(posted).toContain('"coinedTerms":["X"]');
    expect(posted).toContain('"route":"short"');
  });
});

test(
  "#543.1: commitAndPush reaches trunk through shared/push-to-trunk.ts instead of its own push origin HEAD:main",
  async () => {
    const { deps, git } = harness({ sheet: sheet({ decisions: [decision(ADR_RULING)] }), losePushes: 1 });

    const pending = accept(deps, 1, "approved");
    expect(pending).toBeInstanceOf(Promise);

    const outcome = await outcomeOf(pending);

    expect(outcome).toMatchObject({ kind: "approved", adrs: ["docs/adr/0051-slug.md"] });
    expect(pushAttempts(git).length).toBeGreaterThan(1);
  },
  30_000,
);

test(
  "#543.2: a push this lane loses is retried, and the lane reports its own sentence when the attempts are exhausted",
  async () => {
    const lost = harness({ sheet: sheet({ decisions: [decision(ADR_RULING)] }), losePushes: 1 });

    const landed = await outcomeOf(accept(lost.deps, 1, "approved"));

    expect(landed).toMatchObject({ kind: "approved" });
    expect(pushAttempts(lost.git).length).toBeGreaterThan(1);

    const exhausted = harness({
      sheet: sheet({ decisions: [decision(ADR_RULING)] }),
      losePushes: Number.POSITIVE_INFINITY,
    });

    const reported = await reportOf(() => accept(exhausted.deps, 1, "approved"), exhausted.tracker);

    expect(pushAttempts(exhausted.git).length).toBeGreaterThan(1);
    expect(reported).toMatch(/accept|adr|context\.md|sheet|rul|land/i);
  },
  60_000,
);

test(
  "#543.3: the whole check contract passes: every verb of accept resolves through the async ripple, and insertTerm stays a plain function",
  async () => {
    const parked = harness({ sheet: sheet() });
    const parkedResult = accept(parked.deps, 1, "parked");
    expect(parkedResult).toBeInstanceOf(Promise);
    expect(await outcomeOf(parkedResult)).toEqual({ kind: "parked" });

    const killed = harness({ sheet: sheet() });
    const killedResult = accept(killed.deps, 1, "killed");
    expect(killedResult).toBeInstanceOf(Promise);
    expect(await outcomeOf(killedResult)).toEqual({ kind: "killed" });

    const missing = harness();
    const missingResult = accept(missing.deps, 1, "approved");
    expect(missingResult).toBeInstanceOf(Promise);
    expect(await outcomeOf(missingResult)).toEqual({ kind: "no-sheet", verb: "approved" });

    const approved = harness({ sheet: sheet({ decisions: [decision(ADR_RULING)] }) });
    const approvedResult = accept(approved.deps, 1, "approved");
    expect(approvedResult).toBeInstanceOf(Promise);
    expect(await outcomeOf(approvedResult)).toMatchObject({
      kind: "approved",
      adrs: ["docs/adr/0051-slug.md"],
    });
    expect(pushAttempts(approved.git).length).toBeGreaterThanOrEqual(1);

    const term: Term = { term: "X", definition: "d", avoid: [], section: "Mechanisms" };
    expect(insertTerm(CONTEXT_FIXTURE, term)).toContain("**X**:");
  },
  30_000,
);

test.fails("#618.3: accept reads round state through a Tracker built by trackerMemory, not a raw GhExec", async () => {
  const deps: AcceptDeps = {
    gh: trackerMemory() as unknown as GhExec,
    git: () => "",
    newAdr: () => "",
    landAdr: () => "",
    readFile: () => "",
    writeFile: () => {},
    sleep: async () => {},
    log: () => {},
  };

  await expect(accept(deps, 1, "approved")).resolves.toEqual({ kind: "no-sheet", verb: "approved" });
});
