import { describe, expect, it } from "vitest";
import { accept, insertTerm, type AcceptDeps } from "./accept";
import { sheetMarker } from "./marker";
import type { Decision, Sheet, Term } from "./sheet-schema";
import { createFakeTracker, postedComments, type FakeTracker } from "./tracker.fake";

/**
 * The owner's four verbs. This is where ADR-0005 stops being a claim — *accepting
 * a shaped idea is what files its ADRs* — and ADR-0006's W5 becomes a thing that
 * happens rather than a maxim: agents draft, the owner signs, and the signature
 * is a label.
 */

function decision(over: Partial<Decision> = {}): Decision {
  return { question: "q", recommendation: "r", rejected: "x", mark: "", adrTitle: "", ...over };
}

function sheet(over: Partial<Sheet> = {}): Sheet {
  return {
    restatement: "the idea as work",
    priorArt: [],
    decisions: [decision()],
    survivors: [],
    route: "short",
    routeReason: "Short — one file.",
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

function harness(options: { sheet?: Sheet; labels?: string[] } = {}): Harness {
  const comments = options.sheet ? [`## Restatement\n\n…\n\n${sheetMarker(options.sheet)}`] : [];
  const tracker = createFakeTracker({
    comments: new Map([[1, comments]]),
    labels: new Map([[1, options.labels ?? []]]),
  });

  const files = new Map<string, string>([["CONTEXT.md", CONTEXT_FIXTURE]]);
  const git: string[][] = [];
  const adrTitles: string[] = [];
  let nextAdr = 50;
  const deps: AcceptDeps = {
    gh: tracker.gh,
    git: (args) => {
      git.push([...args]);
      return "";
    },
    // Logged into `git` rather than counted separately, because the only thing worth asserting
    // about it is *when* it runs relative to the `add` that stages what it wrote — and an ordering
    // reads off one list where it does not read off two.
    regenerateCorpus: () => void git.push(["regenerate-corpus"]),
    // Drafts are unnumbered and the number arrives at the land (ADR-0080), so the stub models
    // both halves: `newAdr` names the file by its slug alone, and `landAdr` is the only thing
    // here that knows a number. A stub that handed back a numbered path from `newAdr` would let
    // an accept that never lands its drafts pass.
    newAdr: (title) => {
      adrTitles.push(title);
      const path = `docs/adr/draft-slug-${adrTitles.length}.md`;
      files.set(path, `# ${title}\n\nRecorded 2026-08-26.\n`);
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
  };

  return { deps, tracker, files, git, adrTitles };
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
  it("drops `idea` and does nothing else", () => {
    // §01: no dispatch, and **nothing ever re-raises it** — anything that did
    // would be a nag, and C4 says a nag dies by month three. Dropping the
    // label is what stops the lane re-firing; there is nothing to announce.
    const { deps, tracker } = harness({ sheet: sheet() });

    expect(accept(deps, 1, "parked")).toEqual({ kind: "parked" });
    expect(tracker.calls).toEqual([["issue", "edit", "1", "--remove-label", "idea"]]);
  });
});

describe("killed", () => {
  it("closes the issue as not planned, so it becomes prior art with teeth", () => {
    const { deps, tracker } = harness({ sheet: sheet() });

    expect(accept(deps, 1, "killed")).toEqual({ kind: "killed" });
    expect(tracker.calls).toContainEqual(["issue", "close", "1", "--reason", "not planned"]);
  });

  it("does not close as completed, which §6's fourth counter reads", () => {
    const { deps, tracker } = harness({ sheet: sheet() });

    accept(deps, 1, "killed");

    expect(tracker.calls.flat()).not.toContain("completed");
  });
});

describe("approved", () => {
  it("files an ADR for a decision carrying both a mark and a title", () => {
    const { deps, adrTitles, files } = harness({
      sheet: sheet({
        decisions: [decision({ mark: "ADR-0007's routing rule", adrTitle: "The ruling as a sentence" })],
      }),
    });

    const outcome = accept(deps, 1, "approved");

    expect(adrTitles).toEqual(["The ruling as a sentence"]);
    expect(outcome).toMatchObject({ kind: "approved", adrs: ["docs/adr/0051-slug.md"] });
    // The body carries the rejected alternative — ADR-0005's whole point is
    // that a later ticket does not re-propose it in six months.
    expect(files.get("docs/adr/0051-slug.md")).toContain("x");
    expect(files.get("docs/adr/0051-slug.md")).toContain("ADR-0007's routing rule");
  });

  it("files nothing for a title with no mark", () => {
    // ADR-0028 makes the mark the first of README's three tests. A title
    // without one is a shaper claiming a bar it did not show its work for,
    // and honouring it would make the mark decorative.
    const { deps, adrTitles } = harness({
      sheet: sheet({ decisions: [decision({ adrTitle: "A ruling" })] }),
    });

    expect(accept(deps, 1, "approved")).toMatchObject({ adrs: [] });
    expect(adrTitles).toEqual([]);
  });

  it("files nothing for a mark with no title", () => {
    const { deps, adrTitles } = harness({
      sheet: sheet({ decisions: [decision({ mark: "a file" })] }),
    });

    accept(deps, 1, "approved");
    expect(adrTitles).toEqual([]);
  });

  it("coins a term into its own section of CONTEXT.md", () => {
    const term: Term = {
      term: "Sheet round",
      definition: "One pass of the shaper over an idea.",
      avoid: ["iteration"],
      section: "The pipeline",
    };
    const { deps, files } = harness({ sheet: sheet({ newTerms: [term] }) });

    accept(deps, 1, "approved");

    const contents = files.get("CONTEXT.md")!;
    expect(contents).toContain("**Sheet round**:");
    expect(contents.indexOf("**Sheet round**:")).toBeGreaterThan(contents.indexOf("### The pipeline"));
  });

  it("commits and pushes what it wrote, straight to main", () => {
    // Ruled with the move: a PR here would add a second owner touch to a lane
    // §01 budgets at two owner minutes. Move 10 flips it.
    const { deps, git } = harness({
      sheet: sheet({ decisions: [decision({ mark: "a file", adrTitle: "A ruling" })] }),
    });

    accept(deps, 1, "approved");

    expect(git.map((call) => call[0])).toEqual([
      "regenerate-corpus",
      "add",
      "commit",
      "fetch",
      "rebase",
      "push",
    ]);
    expect(git.at(-1)).toEqual(["push", "origin", "HEAD:main"]);
  });

  it("carries the corpus fixture in the same commit as the ADR that staled it", () => {
    // `adr-corpus.evidence.json` is a snapshot of `docs/adr`, and `bin/gauntlet push` compares a
    // fresh generation against it byte-for-byte. So an accept that commits an ADR without the
    // regenerated snapshot is refused by this repo's own `pre-push` hook — which is exactly what
    // happened to the first accept ever to reach a push. The ordering is the assertion: regenerate
    // first, or `add` stages a fixture still describing the corpus as it was a moment ago.
    const { deps, git } = harness({
      sheet: sheet({ decisions: [decision({ mark: "a file", adrTitle: "A ruling" })] }),
    });

    accept(deps, 1, "approved");

    const add = git.find((call) => call[0] === "add")!;
    expect(add).toContain(".Workflow/agent-workflows/watchdog/adr-corpus.evidence.json");
    expect(git.indexOf(git.find((call) => call[0] === "regenerate-corpus")!)).toBeLessThan(
      git.indexOf(add),
    );
  });

  it("leaves the corpus fixture alone when the sheet coined a term but filed no ADR", () => {
    // The fixture reads `docs/adr` and `docs/research`, neither of which a term touches — it goes
    // into `CONTEXT.md`. Regenerating anyway would put an unchanged file in every vocabulary
    // commit, which is noise in the one history this estate reads to reconstruct a decision.
    const term: Term = {
      term: "Sheet round",
      section: "The pipeline",
      definition: "One pass of the chain.",
      avoid: [],
    };
    const { deps, git } = harness({ sheet: sheet({ newTerms: [term] }) });

    accept(deps, 1, "approved");

    expect(git.map((call) => call[0])).not.toContain("regenerate-corpus");
    expect(git.find((call) => call[0] === "add")).toEqual(["add", "CONTEXT.md"]);
  });

  it("writes no commit when the sheet decided nothing worth filing", () => {
    const { deps, git } = harness({ sheet: sheet() });

    accept(deps, 1, "approved");

    expect(git).toEqual([]);
  });

  it("records the sheet's route", () => {
    const { deps } = harness({ sheet: sheet({ route: "long" }) });

    expect(accept(deps, 1, "approved")).toMatchObject({ route: "long" });
  });

  it("takes ADR-0007's one-word override off the labels", () => {
    const { deps, tracker } = harness({ sheet: sheet({ route: "short" }), labels: ["go-long"] });

    expect(accept(deps, 1, "approved")).toMatchObject({ route: "long" });
    expect(postedComments(tracker)[0]).toContain("overriding the sheet's `short`");
  });

  it("takes the survivable route when both overrides are somehow present", () => {
    const { deps } = harness({ sheet: sheet(), labels: ["go-long", "go-short"] });

    expect(accept(deps, 1, "approved")).toMatchObject({ route: "long" });
  });

  it("says on the issue that nothing was dispatched", () => {
    // Lane 02 on a runner is move 6, and what an accepted sheet hands it is
    // still open (#96). Saying so is the difference between an unbuilt edge
    // and a silently dropped one.
    const { deps, tracker } = harness({ sheet: sheet() });

    accept(deps, 1, "approved");

    expect(postedComments(tracker)[0]).toContain("Not dispatched");
  });

  it("refuses to invent a route when there is no sheet to read", () => {
    const { deps, tracker, git } = harness();

    expect(accept(deps, 1, "approved")).toEqual({ kind: "no-sheet", verb: "approved" });
    expect(git).toEqual([]);
    expect(tracker.calls.flat()).not.toContain("--remove-label");
  });
});

describe("coining a term", () => {
  it("leaves the file alone when the section is gone", () => {
    // Not there means CONTEXT.md has been reorganised since the enum was
    // written. Creating the heading would let this lane quietly invent
    // structure in the one document the whole estate reads for its vocabulary.
    const term: Term = { term: "X", definition: "d", avoid: [], section: "The charter" };

    expect(insertTerm(CONTEXT_FIXTURE, term)).toBeUndefined();
  });

  it("does not coin a term the file already carries", () => {
    const term: Term = { term: "Gate", definition: "different", avoid: [], section: "Mechanisms" };
    const { deps, files } = harness({ sheet: sheet({ newTerms: [term] }) });

    accept(deps, 1, "approved");

    expect(files.get("CONTEXT.md")).not.toContain("different");
  });

  it("omits the _Avoid_ line when there is nothing to avoid", () => {
    const term: Term = { term: "X", definition: "d", avoid: [], section: "Mechanisms" };

    expect(insertTerm(CONTEXT_FIXTURE, term)).toContain("**X**:\nd\n");
    expect(insertTerm(CONTEXT_FIXTURE, term)).not.toContain("_Avoid_: \n");
  });
});

describe("re-applying a verb", () => {
  it("does not file a second copy of every ruling", () => {
    // A label can be removed and re-applied, and each application is a fresh
    // `issues.labeled` event. Without the accept's own trailer to read back,
    // the second one files every ruling again under new numbers and pushes
    // them to `main`.
    const shaped = sheet({ decisions: [decision({ mark: "a file", adrTitle: "A ruling" })] });
    const { deps, adrTitles, git } = harness({ sheet: shaped });

    accept(deps, 1, "approved");
    expect(adrTitles).toHaveLength(1);

    const second = harness({ sheet: shaped });
    second.tracker.comments.set(1, [
      ...(second.tracker.comments.get(1) ?? []),
      "## Accepted\n\n<!-- shape-accepted:v1 -->",
    ]);

    expect(accept(second.deps, 1, "approved")).toEqual({ kind: "already-accepted" });
    expect(second.adrTitles).toEqual([]);
    expect(second.git).toEqual([]);
    expect(git).not.toEqual([]);
  });

  it("marks its own comment, which is what makes that readable", () => {
    const { deps, tracker } = harness({ sheet: sheet() });

    accept(deps, 1, "approved");

    expect(postedComments(tracker)[0]).toContain("<!-- shape-accepted:v1");
  });

  it("carries the ADR paths, coined terms and route in the marker's payload", () => {
    // ADR-0058: lane 02's sheet collector cites these rather than restating
    // them, and the ADR numbers appear nowhere on the sheet itself — so the
    // payload is what the collector reads instead of the rendered prose.
    const term: Term = { term: "X", definition: "d", avoid: [], section: "Mechanisms" };
    const { deps, tracker } = harness({
      sheet: sheet({
        decisions: [decision({ mark: "a mark", adrTitle: "A ruling" })],
        newTerms: [term],
      }),
    });

    accept(deps, 1, "approved");

    const posted = postedComments(tracker)[0] ?? "";
    expect(posted).toContain('"adrPaths":["docs/adr/0051-slug.md"]');
    expect(posted).toContain('"coinedTerms":["X"]');
    expect(posted).toContain('"route":"short"');
  });
});
