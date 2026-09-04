import { describe, expect, it } from "vitest";
import { frontmatterBlock } from "../shared/adr-frontmatter";
import { SPEC_AUTHOR_DISPATCH_EVENT_TYPE } from "../shared/spec-author-dispatch";
import { accept, insertTerm, type AcceptDeps } from "./accept";
import { sheetMarker } from "../shared/marker";
import type { Decision, Sheet, Term } from "../shared/sheet-schema";
import { createFakeTracker, postedComments, type FakeTracker } from "./tracker.fake";

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
  };

  return { deps, tracker, files, git, adrTitles };
}

function harnessFor(over: Partial<Decision>): Harness {
  return harness({ sheet: sheet({ decisions: [decision(over)] }) });
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
        decisions: [decision({ mark: "ADR-0007's routing rule", adrTitle: "The ruling as a sentence", adrReversal: REVERSAL })],
      }),
    });

    const outcome = accept(deps, 1, "approved");

    expect(adrTitles).toEqual(["The ruling as a sentence"]);
    expect(outcome).toMatchObject({ kind: "approved", adrs: ["docs/adr/0051-slug.md"] });
    expect(files.get("docs/adr/0051-slug.md")).toContain("x");
    expect(files.get("docs/adr/0051-slug.md")).toContain("ADR-0007's routing rule");
  });

  it("files nothing for a title with no mark", () => {
    const { deps, adrTitles } = harnessFor({ adrTitle: "A ruling" });

    expect(accept(deps, 1, "approved")).toMatchObject({ adrs: [] });
    expect(adrTitles).toEqual([]);
  });

  it("files nothing for a mark with no title", () => {
    const { deps, adrTitles } = harnessFor({ mark: "a file" });

    accept(deps, 1, "approved");
    expect(adrTitles).toEqual([]);
  });

  it("files nothing for a title and mark with no reversal sentence", () => {
    const { deps, adrTitles } = harnessFor({ mark: "a file", adrTitle: "A ruling" });

    expect(accept(deps, 1, "approved")).toMatchObject({ adrs: [] });
    expect(adrTitles).toEqual([]);
  });

  it("writes the reversal sentence into the landed ADR's frontmatter, not its body", () => {
    const { deps, files } = harnessFor({ mark: "a file", adrTitle: "A ruling", adrReversal: REVERSAL });

    accept(deps, 1, "approved");

    const landed = files.get("docs/adr/0051-slug.md")!;
    expect(frontmatterOf(landed)).toContain(`reversal: ${REVERSAL}`);
    expect(landed.slice(landed.indexOf("\n---\n", 4))).not.toContain(REVERSAL);
  });

  it("flattens a multi-line reversal sentence, which would otherwise end the key mid-value", () => {
    const { deps, files } = harness({
      sheet: sheet({
        decisions: [decision({ mark: "a file", adrTitle: "A ruling", adrReversal: "Undoing it costs\na second pass." })],
      }),
    });

    accept(deps, 1, "approved");

    expect(frontmatterOf(files.get("docs/adr/0051-slug.md")!)).toContain("reversal: Undoing it costs a second pass.");
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
    const { deps, git } = harnessFor({ mark: "a file", adrTitle: "A ruling", adrReversal: REVERSAL });

    accept(deps, 1, "approved");

    expect(git.map((call) => call[0])).toEqual([
      "add",
      "commit",
      "fetch",
      "rebase",
      "push",
    ]);
    expect(git.at(-1)).toEqual(["push", "origin", "HEAD:main"]);
  });

  it("stages only CONTEXT.md when the sheet coined a term but filed no ADR", () => {
    const term: Term = {
      term: "Sheet round",
      section: "The pipeline",
      definition: "One pass of the chain.",
      avoid: [],
    };
    const { deps, git } = harness({ sheet: sheet({ newTerms: [term] }) });

    accept(deps, 1, "approved");

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

  it("dispatches lane 02, and says so on the issue", () => {
    const { deps, tracker } = harness({ sheet: sheet() });

    accept(deps, 1, "approved");

    expect(postedComments(tracker)[0]).toContain("Dispatched to lane 02");
    expect(postedComments(tracker)[0]).not.toContain("Not dispatched");
  });

  it("sends the dispatch after the comment carrying the marker the collector reads", () => {
    const { deps, tracker } = harness({ sheet: sheet() });

    accept(deps, 1, "approved");

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

  it("swaps the spent verb for the lane that is now owed", () => {
    const { deps, tracker } = harness({ sheet: sheet() });

    accept(deps, 1, "approved");

    const swap = tracker.calls.find(
      (args) => args[0] === "issue" && args[1] === "edit" && args.includes("to-spec"),
    );
    expect(swap).toBeDefined();
    expect(swap).toContain("--add-label");
    expect(swap).toContain("to-spec");
    expect(swap).toContain("--remove-label");
    expect(swap).toContain("approved");
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
    const shaped = sheet({ decisions: [decision({ mark: "a file", adrTitle: "A ruling", adrReversal: REVERSAL })] });
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
    const term: Term = { term: "X", definition: "d", avoid: [], section: "Mechanisms" };
    const { deps, tracker } = harness({
      sheet: sheet({
        decisions: [decision({ mark: "a mark", adrTitle: "A ruling", adrReversal: REVERSAL })],
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
