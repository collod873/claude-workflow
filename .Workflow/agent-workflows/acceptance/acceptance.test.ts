import { join } from "node:path";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isolateCheckpointsPerTest } from "../shared/isolate-checkpoints.setup";
import { subIssuesPath } from "../shared/gh-paths";
import { createFakeStage, type FakeStage } from "../shared/stage.fake";
import { CRITERIA_ITEM_RE, extractCriteria, parentPrdNumber, readTicket } from "../shared/ticket-shape";
import {
  authorAcceptanceTests,
  CLAIMED_FILE_ABSENT,
  NO_CLAIMED_FILES,
  NO_SHARED_FILES,
  refireAcceptance,
  renderFiles,
  runAcceptanceAuthor,
  sharedTestFiles,
} from "./acceptance";

// The author's runStage names its stage (#274), which opts it into checkpointing — and without a
// fresh CHECKPOINTS_DIR per test, a later test whose fixtures render the same substituted prompt
// silently replays an earlier test's canned answer off the real on-disk directory (the stop gate
// caught exactly that as a flake). See `isolateCheckpointsPerTest`'s own comment.
beforeEach(() => {
  isolateCheckpointsPerTest();
});


const TICKET_BODY = `## Parent PRD
#145

## What to build
Do the thing.

## Acceptance criteria
- [ ] \`npm test\` exits 0 with a test asserting a fake \`GitExec\` receives no push
- [ ] \`npm test\` exits 0 with a test asserting exactly one push

## Files claimed
- .Workflow/agent-workflows/acceptance/acceptance.ts
`;

const PRD_BODY = `## What to build
The larger feature #162 is one slice of.
`;

function authorResponse(files: Array<{ path: string; content: string }>): string {
  return JSON.stringify({ files });
}

/**
 * Runs the author against `TICKET_BODY` with `readFile` standing in for the checkout, and hands
 * back the fake stage — so a test can read the prompt that was actually built (ADR-0098) rather
 * than restate the wiring that builds it.
 */
async function authorAgainst(
  readFile: (path: string) => string | undefined,
  listTestDir: () => string[] = () => [],
): Promise<FakeStage> {
  const stage = createFakeStage(
    authorResponse([{ path: "tests/acceptance/162-x.test.ts", content: "// x\n" }]),
  );
  await authorAcceptanceTests({
    exec: stage.exec,
    writeFile: () => {},
    issueNumber: 162,
    ticket: { title: "t", body: TICKET_BODY },
    readFile,
    listTestDir,
  });
  return stage;
}

/**
 * `authorAgainst`'s write-side sibling: runs the author against `TICKET_BODY` with `files` as its
 * canned answer, and hands back what reached `writeFile` — for the tests about which paths the
 * author accepts and what it puts at them, rather than about the prompt it built.
 */
async function authorWriting(
  files: Array<{ path: string; content: string }>,
): Promise<{ paths: string[]; written: Map<string, string> }> {
  const stage = createFakeStage(authorResponse(files));
  const written = new Map<string, string>();
  const authored = await authorAcceptanceTests({
    exec: stage.exec,
    writeFile: (path, content) => written.set(path, content),
    issueNumber: 162,
    ticket: { title: "Author acceptance tests", body: TICKET_BODY },
    prdBody: PRD_BODY,
    listTestDir: () => [],
  });
  return { paths: authored.map((file) => file.path), written };
}

describe("extractCriteria", () => {
  it("reads criteria matched via CRITERIA_ITEM_RE, verbatim, in order", () => {
    const criteria = extractCriteria(TICKET_BODY);
    expect(criteria).toEqual([
      "`npm test` exits 0 with a test asserting a fake `GitExec` receives no push",
      "`npm test` exits 0 with a test asserting exactly one push",
    ]);
    // Every line this reads must actually match the shared grammar — proves this
    // isn't a second, independently-spelled parser.
    for (const line of TICKET_BODY.split("\n")) {
      if (line.includes("no push") || line.includes("exactly one push")) {
        expect(CRITERIA_ITEM_RE.test(line)).toBe(true);
      }
    }
  });
});

describe("parentPrdNumber", () => {
  it("reads the ## Parent PRD heading render-body.ts writes", () => {
    expect(parentPrdNumber(TICKET_BODY)).toBe(145);
  });

  it("is undefined when the body carries no such heading", () => {
    expect(parentPrdNumber("## What to build\nsomething\n")).toBeUndefined();
  });
});

describe("authorAcceptanceTests", () => {
  it("writes the model's files, each carrying its criterion's text verbatim", async () => {
    const [firstCriterion] = extractCriteria(TICKET_BODY);
    const { paths, written } = await authorWriting([
      {
        path: "tests/acceptance/162-no-push-on-collection-error.test.ts",
        content: `// ${firstCriterion}\nimport { describe, it, expect } from "vitest";\ndescribe("x", () => { it("y", () => { expect(true).toBe(false); }); });\n`,
      },
    ]);

    expect(paths).toEqual(["tests/acceptance/162-no-push-on-collection-error.test.ts"]);
    const content = written.get("tests/acceptance/162-no-push-on-collection-error.test.ts");
    expect(content).toBeDefined();
    // The criterion string appears verbatim in the written test.
    expect(content).toContain(firstCriterion);
  });

  // ADR-0098. Lane 04's first production run wrote two tests that were wrong about the *shape* of
  // a file the criterion named — a quoted YAML key read as bare, a job asserted to contain a
  // string it structurally cannot. The fix is that the file reaches the prompt, so both of these
  // assert on the prompt rather than on anything a model would say with it.
  it("shows the author the current contents of every file the ticket claims", async () => {
    const stage = await authorAgainst((path) =>
      path === ".Workflow/agent-workflows/acceptance/acceptance.ts" ? '"on": quoted\n' : undefined,
    );

    const prompt = stage.stdins[0];
    expect(prompt, "the author's prompt goes over stdin").toBeDefined();
    expect(prompt).toContain(".Workflow/agent-workflows/acceptance/acceptance.ts");
    expect(prompt, "the claimed file's own text, not just its path").toContain('"on": quoted');
  });

  // #227: `sharedTestFiles` reaches the author the same way its claimed files do, through the
  // same renderer. Its docstring in `acceptance.ts` is the home for why.
  it("shows the author the non-test files already sitting under the acceptance test dir", async () => {
    const stage = await authorAgainst(
      (path) =>
        path === "tests/acceptance/workflow-shape.fixture.ts"
          ? "export function topLevelBlock() {}\n"
          : undefined,
      () => ["201-one.test.ts", "workflow-shape.fixture.ts"],
    );

    const prompt = stage.stdins[0];
    expect(prompt).toContain("tests/acceptance/workflow-shape.fixture.ts");
    expect(prompt, "the shared reader's own text, not just its path").toContain(
      "export function topLevelBlock()",
    );
  });

  // Not the sibling tests, though: what the author needs is what it may reuse, and every test this
  // lane has ever written would grow the prompt on every run without giving it anything to import.
  it("does not paste the acceptance tests themselves into the prompt", async () => {
    const stage = await authorAgainst(
      () => "// contents of whatever was asked for\n",
      () => ["201-one.test.ts", "workflow-shape.fixture.ts"],
    );

    expect(stage.stdins[0]).not.toContain("tests/acceptance/201-one.test.ts");
  });

  it("says nothing shared exists yet rather than showing an empty section", async () => {
    const stage = await authorAgainst(() => undefined, () => []);
    expect(stage.stdins[0]).toContain(NO_SHARED_FILES);
  });

  // A reader more than one of the run's files needs belongs beside them, and `push-gate.ts` is
  // never reached if this throws first.
  it("writes a .fixture.ts the model puts beside the tests, rather than refusing it", async () => {
    const { paths, written } = await authorWriting([
      { path: "tests/acceptance/162-one.test.ts", content: "// one\n" },
      { path: "tests/acceptance/reads-the-workflow.fixture.ts", content: "export const x = 1;\n" },
    ]);

    expect(paths).toContain("tests/acceptance/reads-the-workflow.fixture.ts");
    expect(written.get("tests/acceptance/reads-the-workflow.fixture.ts")).toBe("export const x = 1;\n");
  });

  // The reach is what reached the prompt, not a line the model was asked to honour (ADR-0098) —
  // so the stage keeps no toolbelt, and an allow list would have granted the whole checkout.
  it("gives the author no tools to read anything else with", async () => {
    const stage = await authorAgainst(() => undefined);
    expect(stage.calls[0]).not.toContain("--allowedTools");
  });

  it("throws, writing nothing, when the ticket declares no acceptance criteria", async () => {
    const stage = createFakeStage(authorResponse([{ path: "tests/acceptance/x.test.ts", content: "x" }]));
    const written = new Map<string, string>();

    await expect(
      authorAcceptanceTests({
        exec: stage.exec,
        writeFile: (path, content) => written.set(path, content),
        issueNumber: 999,
        ticket: { title: "No criteria", body: "## What to build\nnothing declared\n" },
      }),
    ).rejects.toThrow(/no acceptance criteria/);
    expect(written.size).toBe(0);
  });

  it("throws, writing nothing, when the model names a path outside the acceptance test dir", async () => {
    const stage = createFakeStage(authorResponse([{ path: "src/whoops.ts", content: "x" }]));
    const written = new Map<string, string>();

    await expect(
      authorAcceptanceTests({
        exec: stage.exec,
        writeFile: (path, content) => written.set(path, content),
        issueNumber: 162,
        ticket: { title: "t", body: TICKET_BODY },
      }),
    ).rejects.toThrow(/outside/);
    expect(written.size).toBe(0);
  });
});

describe("renderFiles", () => {
  it("renders each file's contents under its own path, in the order it was given", () => {
    const rendered = renderFiles(
      ["a/one.ts", "b/two.ts"],
      (path: string) => `contents of ${path}`,
      NO_CLAIMED_FILES,
    );
    expect(rendered.indexOf("a/one.ts")).toBeLessThan(rendered.indexOf("b/two.ts"));
    expect(rendered).toContain("contents of a/one.ts");
    expect(rendered).toContain("contents of b/two.ts");
  });

  // The ordinary case for a slice whose whole job is to create the file. Saying so beats an empty
  // fenced block, which reads as "this file exists and is empty" — a different fact entirely.
  it("says so, rather than showing an empty block, when a claimed file does not exist yet", () => {
    expect(renderFiles(["not/created/yet.ts"], () => undefined, NO_CLAIMED_FILES)).toContain(
      CLAIMED_FILE_ABSENT,
    );
  });

  // `renderFiles`'s `whenEmpty` — the one thing the two sections cannot share; see its docstring.
  it("stands the caller's own sentence in for an empty list", () => {
    expect(renderFiles([], () => "unused", NO_CLAIMED_FILES)).toBe(NO_CLAIMED_FILES);
    expect(renderFiles([], () => "unused", NO_SHARED_FILES)).toBe(NO_SHARED_FILES);
  });
});

describe("sharedTestFiles", () => {
  it("names the non-test files under the acceptance dir, and none of the tests beside them", () => {
    const shared = sharedTestFiles(() => [
      "201-one.test.ts",
      "workflow-shape.fixture.ts",
      "201-two.test.ts",
    ]);
    expect(shared).toEqual(["tests/acceptance/workflow-shape.fixture.ts"]);
  });

  it("is empty on a checkout where no acceptance test has ever landed", () => {
    expect(sharedTestFiles(() => [])).toEqual([]);
  });
});

describe("readTicket", () => {
  it("reads a ticket through gh issue view --json title,body", () => {
    const calls: string[][] = [];
    const gh = (args: string[]) => {
      calls.push(args);
      return JSON.stringify({ title: "T", body: TICKET_BODY });
    };

    const ticket = readTicket(gh, 162);
    expect(ticket.body).toBe(TICKET_BODY);
    expect(calls[0]).toEqual(["issue", "view", "162", "--json", "title,body"]);
  });
});

describe("runAcceptanceAuthor", () => {
  it("never opens a PR across the whole authoring flow", async () => {
    const ghCallLog: string[][] = [];
    const gh = ((args: string[]) => {
      ghCallLog.push(args);
      if (args[0] === "issue" && args[1] === "view" && args[2] === "162") {
        return JSON.stringify({ title: "Ticket", body: TICKET_BODY });
      }
      if (args[0] === "issue" && args[1] === "view" && args[2] === "145") {
        return JSON.stringify({ title: "PRD", body: PRD_BODY });
      }
      throw new Error(`fake gh: unhandled argv: ${JSON.stringify(args)}`);
    }) as (args: string[]) => string;

    const [firstCriterion] = extractCriteria(TICKET_BODY);
    const stage = createFakeStage(
      authorResponse([
        {
          path: "tests/acceptance/162-one.test.ts",
          content: `// ${firstCriterion}\n`,
        },
      ]),
    );
    const written = new Map<string, string>();
    const gitCalls: string[][] = [];

    const outcome = await runAcceptanceAuthor({
      gh,
      exec: stage.exec,
      writeFile: (path, content) => written.set(path, content),
      issueNumber: 162,
      runTests: () => ({ collected: true, failures: [] }),
      lint: () => null,
      git: (args: string[]) => {
        gitCalls.push(args);
        return "";
      },
    });

    expect(outcome.verdict).toBe("pushed");
    expect(ghCallLog.some((call) => call.includes("create") && call.some((a) => a === "pr"))).toBe(false);
    expect(ghCallLog.filter((call) => call[0] === "pr")).toEqual([]);
    expect(gitCalls.filter((call) => call[0] === "push")).toHaveLength(1);
  });
});

describe("refireAcceptance", () => {
  /**
   * A private directory per test, under the OS temp dir rather than beside this file.
   *
   * The fixtures below are named `*.test.ts`, because that is the shape `affectedSlices` greps
   * for. Written under `.Workflow/` they were also the shape *vitest's own `include` glob* greps
   * for, so the collector could be reading the directory at the moment `afterEach` removed it —
   * one `ENOTEMPTY` in a green suite, rare enough to read as noise and frequent enough to red the
   * pre-push hook and take a lane down with it. `testsDir` is injectable precisely so these never
   * had to live in the scanned tree; and one directory shared by every test in the describe was
   * the second half of the same bug.
   */
  let REFIRE_TESTS_DIR: string;

  beforeEach(() => {
    REFIRE_TESTS_DIR = mkdtempSync(join(tmpdir(), "refire-acceptance-"));
  });

  afterEach(() => {
    rmSync(REFIRE_TESTS_DIR, { recursive: true, force: true });
  });

  const KEPT_CRITERION = "npm test exits 0 with a criterion the edit leaves untouched";
  const DROPPED_CRITERION = "npm test exits 0 with a criterion the edit removes";
  const OTHER_KEPT_CRITERION = "npm test exits 0 with a second criterion the edit leaves untouched";

  const SLICE_201_BODY = `## Parent PRD
#301

## Acceptance criteria
- [ ] ${KEPT_CRITERION}
- [ ] ${DROPPED_CRITERION}

## Files claimed
- none
`;

  const SLICE_202_BODY = `## Parent PRD
#301

## Acceptance criteria
- [ ] ${OTHER_KEPT_CRITERION}

## Files claimed
- none
`;

  /** The edited spec: still carries both slices' kept criteria, but not #201's dropped one. */
  const EDITED_PRD_BODY = `## What to build
${KEPT_CRITERION}
${OTHER_KEPT_CRITERION}
`;

  function writeTestFor(sliceNumber: number, fileSlug: string, criterion: string): void {
    mkdirSync(REFIRE_TESTS_DIR, { recursive: true });
    writeFileSync(join(REFIRE_TESTS_DIR, `${sliceNumber}-${fileSlug}.test.ts`), `// ${criterion}\n`, "utf8");
  }

  function fakeGh(): { gh: (args: string[]) => string; calls: string[][] } {
    const calls: string[][] = [];
    const gh = (args: string[]): string => {
      calls.push(args);
      if (args[0] === "issue" && args[1] === "view" && args[2] === "301") {
        return JSON.stringify({ title: "PRD", body: EDITED_PRD_BODY });
      }
      if (args[0] === "issue" && args[1] === "view" && args[2] === "201") {
        return JSON.stringify({ title: "Slice 201", body: SLICE_201_BODY });
      }
      if (args[0] === "issue" && args[1] === "view" && args[2] === "202") {
        return JSON.stringify({ title: "Slice 202", body: SLICE_202_BODY });
      }
      if (args[0] === "api" && args[1] === subIssuesPath(301)) {
        return JSON.stringify([{ number: 201 }, { number: 202 }]);
      }
      throw new Error(`fake gh: unhandled argv: ${JSON.stringify(args)}`);
    };
    return { gh, calls };
  }

  it("calls the acceptance author once for the one slice whose test's criterion the edit dropped", async () => {
    writeTestFor(201, "kept", KEPT_CRITERION);
    writeTestFor(201, "dropped", DROPPED_CRITERION);
    writeTestFor(202, "kept", OTHER_KEPT_CRITERION);
    const { gh } = fakeGh();
    const calledFor: number[] = [];

    const affected = await refireAcceptance({
      gh,
      prdNumber: 301,
      authorForSlice: (sliceNumber) => {
        calledFor.push(sliceNumber);
      },
      testsDir: REFIRE_TESTS_DIR,
    });

    expect(affected).toEqual([{ sliceNumber: 201 }]);
    expect(calledFor).toEqual([201]);
  });

  it("calls the acceptance author zero times when nothing changed", async () => {
    // Both slices' tests still name criteria the (unedited) spec carries.
    writeTestFor(201, "kept", KEPT_CRITERION);
    writeTestFor(202, "kept", OTHER_KEPT_CRITERION);
    const unchangedGh = (args: string[]): string => {
      if (args[0] === "issue" && args[1] === "view" && args[2] === "301") {
        return JSON.stringify({
          title: "PRD",
          body: `## What to build\n${KEPT_CRITERION}\n${OTHER_KEPT_CRITERION}\n`,
        });
      }
      if (args[0] === "issue" && args[1] === "view" && args[2] === "201") {
        return JSON.stringify({ title: "Slice 201", body: SLICE_201_BODY.replace(`- [ ] ${DROPPED_CRITERION}\n`, "") });
      }
      if (args[0] === "issue" && args[1] === "view" && args[2] === "202") {
        return JSON.stringify({ title: "Slice 202", body: SLICE_202_BODY });
      }
      if (args[0] === "api" && args[1] === subIssuesPath(301)) {
        return JSON.stringify([{ number: 201 }, { number: 202 }]);
      }
      throw new Error(`fake gh: unhandled argv: ${JSON.stringify(args)}`);
    };
    const calledFor: number[] = [];

    const affected = await refireAcceptance({
      gh: unchangedGh,
      prdNumber: 301,
      authorForSlice: (sliceNumber) => {
        calledFor.push(sliceNumber);
      },
      testsDir: REFIRE_TESTS_DIR,
    });

    expect(affected).toEqual([]);
    expect(calledFor).toEqual([]);
  });
});
