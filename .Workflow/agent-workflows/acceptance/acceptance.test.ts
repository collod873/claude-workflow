import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { SUITE_ROOTS } from "../shared/affected-tests";
import type { GhExec } from "../shared/gh";
import { createFakeGh } from "../shared/gh.fake";
import { subIssuesPath } from "../shared/gh-paths";
import { createFakeGit } from "../shared/git.fake";
import { scratchDir } from "../shared/scratch.fixture";
import { createFakeStage, type FakeStage } from "../shared/stage.fake";
import { extractCriteria, type TicketRead } from "../shared/ticket-shape";
import type { TestRunResult } from "../shared/vitest-json";
import {
  authorAcceptanceTests,
  CLAIMED_FILE_ABSENT,
  landAuthoredBatch,
  landingFromEnv,
  NO_CLAIMED_FILES,
  refireAcceptance,
  renderCriteria,
  renderFiles,
  runAcceptanceAuthor,
  type AuthoredFile,
  type LandDeps,
} from "./acceptance";

/**
 * Lane 04 after #360: the author writes `test.fails` tests beside their subjects, the gate refuses
 * a batch that is not green-under-fails or does not lint, and the whole flow never opens a pull
 * request. The model is `createFakeStage`, the tracker is `createFakeGh` with the two reads this
 * lane makes answered in front of it, and git is `createFakeGit` — so every assertion here is on
 * what was sent, never on what a model would say.
 */

const ISSUE = 162;
const PRD = 145;
const SUBJECT = ".Workflow/agent-workflows/shared/widget.ts";
const TEST_PATH = ".Workflow/agent-workflows/shared/widget.test.ts";

const TICKET_BODY = `## Parent PRD
#${PRD}

## What to build
Do the thing.

## Acceptance criteria
- [ ] \`make test\` exits 0 with a test asserting a fake \`GitExec\` receives no push
- [ ] \`make test\` exits 0 with a test asserting exactly one push

## Files claimed
- ${SUBJECT}
`;

const PRD_BODY = `## What to build
The larger feature #${ISSUE} is one slice of.
`;

const TICKET: TicketRead = { title: "Author acceptance tests", body: TICKET_BODY };

/** A test file carrying the one marker the author must leave: `test.fails(` naming the ticket. */
function failsTest(issue: number = ISSUE): string {
  const [criterion] = extractCriteria(TICKET_BODY);
  return `import { expect, test } from "vitest";\n// ${criterion}\ntest.fails("#${issue}: no push", () => {\n  expect(1).toBe(2);\n});\n`;
}

function answer(files: AuthoredFile[]): FakeStage {
  return createFakeStage(JSON.stringify({ files }));
}

/**
 * Starts the author with `files` as the model's answer and hands back the attempt beside what
 * reached `writeFile` — so a refusal test can await the rejection and then show nothing was written.
 */
function authoring(
  files: AuthoredFile[],
  options: { ticket?: TicketRead; readFile?: (path: string) => string | undefined; prdBody?: string } = {},
): { attempt: Promise<AuthoredFile[]>; written: string[]; stage: FakeStage } {
  const stage = answer(files);
  const written: string[] = [];
  const attempt = authorAcceptanceTests({
    exec: stage.exec,
    writeFile: (path) => written.push(path),
    issueNumber: ISSUE,
    ticket: options.ticket ?? TICKET,
    prdBody: options.prdBody,
    readFile: options.readFile ?? (() => undefined),
  });
  return { attempt, written, stage };
}

/** The prompt the author was actually handed — over stdin, since it inlines whole files. */
async function promptFor(options: Parameters<typeof authoring>[1] = {}): Promise<string> {
  const { attempt, stage } = authoring([{ path: TEST_PATH, content: failsTest() }], options);
  await attempt;
  expect(stage.stdins[0], "the author's prompt goes over stdin").toBeDefined();
  return stage.stdins[0] as string;
}

describe("authorAcceptanceTests", () => {
  it("hands the author each criterion verbatim, fenced, with the count", async () => {
    // ADR-0128: the criterion string is an identifier `testsForCriteria` greps for, so what the
    // author copies from has to be byte-identical to what the grep looks for.
    const prompt = await promptFor();
    for (const criterion of extractCriteria(TICKET_BODY)) expect(prompt).toContain(`~~~\n${criterion}\n~~~`);
    expect(prompt).toContain("2 acceptance criteria");
  });

  it("shows the author the text of every file the ticket claims, not just its path", async () => {
    // ADR-0098: the first production run asserted a quoted YAML key was bare. The file itself
    // reaches the prompt so the author matches the shape of what it asserts against.
    const prompt = await promptFor({ readFile: (path) => (path === SUBJECT ? '"on": quoted\n' : undefined) });
    expect(prompt).toContain(SUBJECT);
    expect(prompt).toContain('"on": quoted');
  });

  it("says a claimed file does not exist yet rather than showing it empty", async () => {
    expect(await promptFor()).toContain(CLAIMED_FILE_ABSENT);
  });

  it("hands the author the parent PRD, and says when there is none", async () => {
    expect(await promptFor({ prdBody: PRD_BODY })).toContain(PRD_BODY);
    expect(await promptFor()).toContain("(no parent PRD)");
  });

  it("gives the author no tools to read anything else with", async () => {
    const { attempt, stage } = authoring([{ path: TEST_PATH, content: failsTest() }]);
    await attempt;
    expect(stage.calls[0]).not.toContain("--allowedTools");
  });

  it("writes every file the model returned, in the model's order, stubs included", async () => {
    const stub = { path: SUBJECT, content: `export function widget(): never {\n  throw new Error("#${ISSUE}: not built");\n}\n` };
    const { attempt, written } = authoring([{ path: TEST_PATH, content: failsTest() }, stub]);
    const files = await attempt;
    expect(files.map((file) => file.path)).toEqual([TEST_PATH, SUBJECT]);
    expect(written).toEqual([TEST_PATH, SUBJECT]);
  });

  it("accepts it.fails( as the marker too", async () => {
    const content = failsTest().replace("test.fails(", "it.fails(");
    const { attempt, written } = authoring([{ path: TEST_PATH, content }]);
    await attempt;
    expect(written).toEqual([TEST_PATH]);
  });

  it("throws, writing nothing, when the ticket declares no acceptance criteria", async () => {
    const ticket = { title: "No criteria", body: "## What to build\nnothing declared\n" };
    const { attempt, written } = authoring([{ path: TEST_PATH, content: failsTest() }], { ticket });
    await expect(attempt).rejects.toThrow(/no acceptance criteria/);
    expect(written).toEqual([]);
  });

  it.each(["tests/acceptance/162-x.test.ts", "src/widget.test.ts", ".Workflowish/x.test.ts"])(
    "throws, writing nothing, when a path is outside the suite's trees (%s)",
    async (path) => {
      // A test written wherever the model felt like never runs: the suite collects only SUITE_ROOTS.
      const { attempt, written } = authoring([{ path: TEST_PATH, content: failsTest() }, { path, content: failsTest() }]);
      await expect(attempt).rejects.toThrow(new RegExp(`outside ${SUITE_ROOTS.join("/, ")}/`));
      expect(written).toEqual([]);
    },
  );

  it.each([
    ["a plain test(", failsTest().replace("test.fails(", "test(")],
    ["a test.fails( naming another ticket", failsTest(999)],
    ["no test at all", "export const nothing = 1;\n"],
  ])("throws, writing nothing, when a test file carries %s", async (_shape, content) => {
    // A test with no marker is one the implementer cannot turn on and close-ticket cannot see.
    const { attempt, written } = authoring([{ path: TEST_PATH, content }]);
    await expect(attempt).rejects.toThrow(new RegExp(`no test.fails\\( naming #${ISSUE}`));
    expect(written).toEqual([]);
  });

  it("throws, writing nothing, when the model returned only stubs and no test", async () => {
    const { attempt, written } = authoring([{ path: SUBJECT, content: "export const widget = 1;\n" }]);
    await expect(attempt).rejects.toThrow(/no test file/);
    expect(written).toEqual([]);
  });
});

describe("renderCriteria", () => {
  it("numbers each criterion and shows it exactly as extracted, tilde-fenced", () => {
    const rendered = renderCriteria(extractCriteria(TICKET_BODY));
    expect(rendered).toContain("### Criterion 1");
    expect(rendered).toContain("### Criterion 2");
    for (const criterion of extractCriteria(TICKET_BODY)) expect(rendered).toContain(`~~~\n${criterion}\n~~~`);
  });

  it("fences with tildes, so a criterion carrying backticks survives the render", () => {
    expect(renderCriteria(["`make test` exits 0 — check: `make test`"])).toContain(
      "~~~\n`make test` exits 0 — check: `make test`\n~~~",
    );
  });
});

describe("renderFiles", () => {
  it("renders each file's contents under its own path, in the order given", () => {
    const rendered = renderFiles(["a/one.ts", "b/two.ts"], (path) => `contents of ${path}`, NO_CLAIMED_FILES);
    expect(rendered.indexOf("a/one.ts")).toBeLessThan(rendered.indexOf("b/two.ts"));
    expect(rendered).toContain("```\ncontents of a/one.ts\n```");
  });

  it("says a file is absent rather than showing an empty block", () => {
    expect(renderFiles(["not/yet.ts"], () => undefined, NO_CLAIMED_FILES)).toContain(CLAIMED_FILE_ABSENT);
  });

  it("stands the caller's own sentence in for an empty list", () => {
    expect(renderFiles([], () => "unused", NO_CLAIMED_FILES)).toBe(NO_CLAIMED_FILES);
  });
});

const GREEN: TestRunResult = { collected: true, failures: [] };

/** Everything the gate needs to say yes, with a recording git; a test overrides one thing. */
function landing(overrides: Partial<LandDeps> = {}): { deps: LandDeps; git: ReturnType<typeof createFakeGit> } {
  const git = createFakeGit(() => "");
  const deps: LandDeps = {
    runTests: () => GREEN,
    lint: () => null,
    git: git.git,
    paths: [TEST_PATH, SUBJECT],
    commitMessage: "Author acceptance tests for #162 from the spec alone",
    landing: "push",
    ...overrides,
  };
  return { deps, git };
}

function refusal(outcome: ReturnType<typeof landAuthoredBatch>): string {
  expect(outcome.verdict).toBe("refused");
  return outcome.verdict === "refused" ? outcome.reason : "";
}

describe("landAuthoredBatch", () => {
  it("refuses, before any git call, a batch whose test file did not collect", () => {
    const { deps, git } = landing({
      runTests: () => ({ collected: false, collectionError: "widget.test.ts: Cannot find module './widget'", failures: [] }),
    });
    expect(refusal(landAuthoredBatch(deps))).toContain("Cannot find module './widget'");
    expect(git.calls).toEqual([]);
  });

  it("refuses, naming the tests, a batch red under test.fails — those already pass", () => {
    const { deps, git } = landing({
      runTests: () => ({
        collected: true,
        failures: [
          { name: "#162: no push", errorName: "Error" },
          { name: "#162: exactly one push", errorName: "Error" },
        ],
      }),
    });
    const reason = refusal(landAuthoredBatch(deps));
    expect(reason).toContain("2 test(s) are red under test.fails");
    expect(reason).toContain("#162: no push, #162: exactly one push");
    expect(git.calls).toEqual([]);
  });

  it("refuses, before any git call, a batch the linter has findings on", () => {
    // ADR-0102: no review stands between this batch and main, so this is the one venue that can
    // refuse a file the repo cannot accept.
    const { deps, git } = landing({ lint: () => `${TEST_PATH}\n  3:1  error  no-restricted-syntax` });
    expect(refusal(landAuthoredBatch(deps))).toContain("3:1  error  no-restricted-syntax");
    expect(git.calls).toEqual([]);
  });

  it("runs only the test files, and lints every file, of the batch", () => {
    const ran: string[][] = [];
    const linted: string[][] = [];
    const { deps } = landing({
      runTests: (paths) => {
        ran.push(paths);
        return GREEN;
      },
      lint: (paths) => {
        linted.push(paths);
        return null;
      },
    });
    landAuthoredBatch(deps);
    expect(ran).toEqual([[TEST_PATH]]);
    expect(linted).toEqual([[TEST_PATH, SUBJECT]]);
  });

  it("adds, commits, rebases onto origin/main and pushes HEAD:main when landing is push", () => {
    const { deps, git } = landing();
    expect(landAuthoredBatch(deps)).toEqual({ verdict: "pushed" });
    expect(git.calls).toEqual([
      ["add", TEST_PATH, SUBJECT],
      ["commit", "-m", deps.commitMessage],
      ["fetch", "origin", "main"],
      ["rebase", "origin/main"],
      ["push", "origin", "HEAD:main"],
    ]);
  });

  it("commits and stops when landing is commit — the contents: write job pushes (ADR-0091)", () => {
    const { deps, git } = landing({ landing: "commit" });
    expect(landAuthoredBatch(deps)).toEqual({ verdict: "pushed" });
    expect(git.calls).toEqual([
      ["add", TEST_PATH, SUBJECT],
      ["commit", "-m", deps.commitMessage],
    ]);
  });
});

describe("landingFromEnv", () => {
  it("is commit only when ACCEPTANCE_LANDING says so, and push otherwise", () => {
    expect(landingFromEnv({ ACCEPTANCE_LANDING: "commit" })).toBe("commit");
    expect(landingFromEnv({ ACCEPTANCE_LANDING: "push" })).toBe("push");
    expect(landingFromEnv({ ACCEPTANCE_LANDING: "" })).toBe("push");
    expect(landingFromEnv({})).toBe("push");
  });
});

/**
 * The tracker as this lane reads it: `issue view` for the bodies given and the sub-issue list
 * under a PRD, answered here; anything else falls through to `createFakeGh`, which models the
 * publishing writes and throws on the rest — so `fake.calls` staying empty is the proof that the
 * lane sent nothing but reads.
 */
function trackerWith(
  issues: Record<number, TicketRead>,
  subIssues: Record<number, number[]> = {},
): { gh: GhExec; reads: string[][]; fake: ReturnType<typeof createFakeGh> } {
  const fake = createFakeGh();
  const reads: string[][] = [];
  const gh: GhExec = (args) => {
    if (args[0] === "issue" && args[1] === "view") {
      reads.push(args);
      const issue = issues[Number(args[2])];
      if (!issue) throw new Error(`no issue #${args[2]} in this test's tracker`);
      return JSON.stringify(issue);
    }
    for (const [parent, numbers] of Object.entries(subIssues)) {
      if (args[0] === "api" && args[1] === subIssuesPath(Number(parent)) && !args.includes("-F")) {
        reads.push(args);
        return JSON.stringify(numbers.map((number) => ({ number })));
      }
    }
    return fake.gh(args);
  };
  return { gh, reads, fake };
}

describe("runAcceptanceAuthor", () => {
  const TRACKER = { [ISSUE]: TICKET, [PRD]: { title: "PRD", body: PRD_BODY } };

  function run(landingMode: "push" | "commit" = "push") {
    const tracker = trackerWith(TRACKER);
    const stage = answer([{ path: TEST_PATH, content: failsTest() }]);
    const git = createFakeGit(() => "");
    const written: string[] = [];
    const outcome = runAcceptanceAuthor({
      gh: tracker.gh,
      exec: stage.exec,
      writeFile: (path) => written.push(path),
      issueNumber: ISSUE,
      runTests: () => GREEN,
      lint: () => null,
      git: git.git,
      landing: landingMode,
    });
    return { outcome, tracker, stage, git, written };
  }

  it("reads the ticket and its parent PRD, and sends the tracker nothing else", async () => {
    const { outcome, tracker, stage } = run();
    expect(await outcome).toEqual({ verdict: "pushed" });
    expect(tracker.reads).toEqual([
      ["issue", "view", String(ISSUE), "--json", "title,body"],
      ["issue", "view", String(PRD), "--json", "title,body"],
    ]);
    expect(tracker.fake.calls, "no write reached gh — this lane never opens a pull request").toEqual([]);
    expect(stage.stdins[0]).toContain(PRD_BODY);
  });

  it("lands what it wrote with a commit message naming the ticket, and pushes", async () => {
    const { outcome, git, written } = run();
    await outcome;
    expect(written).toEqual([TEST_PATH]);
    const commit = git.calls.find((call) => call[0] === "commit");
    expect(commit?.[2]).toContain(`#${ISSUE}`);
    expect(commit?.[2]).toContain(TEST_PATH);
    expect(git.calls.filter((call) => call[0] === "push")).toEqual([["push", "origin", "HEAD:main"]]);
  });

  it("passes the landing mode through: commit means no push", async () => {
    const { outcome, git } = run("commit");
    await outcome;
    expect(git.calls.map((call) => call[0])).toEqual(["add", "commit"]);
  });

  it("reads only the ticket when it names no parent PRD", async () => {
    const tracker = trackerWith({ [ISSUE]: { title: "t", body: TICKET_BODY.replace(`## Parent PRD\n#${PRD}\n\n`, "") } });
    const stage = answer([{ path: TEST_PATH, content: failsTest() }]);
    await runAcceptanceAuthor({
      gh: tracker.gh,
      exec: stage.exec,
      writeFile: () => {},
      issueNumber: ISSUE,
      runTests: () => GREEN,
      lint: () => null,
      git: createFakeGit(() => "").git,
    });
    expect(tracker.reads).toHaveLength(1);
    expect(stage.stdins[0]).toContain("(no parent PRD)");
  });
});

describe("refireAcceptance", () => {
  const PRD_NUMBER = 301;
  const KEPT = "make test exits 0 with a criterion the edit leaves untouched";
  const DROPPED = "make test exits 0 with a criterion the edit removes";
  const OTHER_DROPPED = "make test exits 0 with a second criterion the edit removes";

  function slice(criteria: string[]): TicketRead {
    return {
      title: "slice",
      body: `## Parent PRD\n#${PRD_NUMBER}\n\n## Acceptance criteria\n${criteria.map((c) => `- [ ] ${c}`).join("\n")}\n\n## Files claimed\n- none\n`,
    };
  }

  /** A checkout whose suite carries one test per (path, criterion) — beside its subject, under `.Workflow/` or `.claude/`. */
  function checkoutWith(tests: Record<string, string>): string {
    const root = scratchDir("refire-acceptance");
    for (const [path, criterion] of Object.entries(tests)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), `// ${criterion}\ntest.fails("#201: x", () => {});\n`, "utf8");
    }
    return root;
  }

  async function refire(prdBody: string, slices: Record<number, TicketRead>, root: string) {
    const calledFor: number[] = [];
    const tracker = trackerWith(
      { [PRD_NUMBER]: { title: "PRD", body: prdBody }, ...slices },
      { [PRD_NUMBER]: Object.keys(slices).map(Number).reverse() },
    );
    const affected = await refireAcceptance({
      gh: tracker.gh,
      prdNumber: PRD_NUMBER,
      authorForSlice: (sliceNumber) => {
        calledFor.push(sliceNumber);
      },
      root,
    });
    return { affected, calledFor, tracker };
  }

  it("re-authors exactly the slices whose existing test lost its criterion, in ascending order", async () => {
    const root = checkoutWith({
      ".Workflow/x.test.ts": DROPPED,
      ".claude/hooks/y.test.ts": OTHER_DROPPED,
      ".Workflow/kept.test.ts": KEPT,
    });
    const { affected, calledFor, tracker } = await refire(
      `## What to build\n${KEPT}\n`,
      { 202: slice([OTHER_DROPPED]), 201: slice([KEPT, DROPPED]), 203: slice([KEPT]) },
      root,
    );
    expect(affected).toEqual([{ sliceNumber: 201 }, { sliceNumber: 202 }]);
    expect(calledFor).toEqual([201, 202]);
    expect(tracker.fake.calls, "reads only").toEqual([]);
  });

  it("re-authors nothing when every existing test's criterion is still in the spec", async () => {
    const root = checkoutWith({ ".Workflow/x.test.ts": KEPT });
    const { affected, calledFor } = await refire(`## What to build\n${KEPT}\n`, { 201: slice([KEPT, DROPPED]) }, root);
    expect(affected).toEqual([]);
    expect(calledFor).toEqual([]);
  });

  it("ignores a slice criterion no existing test names — that is a re-slice, not a re-entry (ADR-0079)", async () => {
    // #201's DROPPED is gone from the spec, but no test ever proved it, so there is nothing to re-author.
    const root = checkoutWith({ ".Workflow/x.test.ts": KEPT });
    const { affected } = await refire(`## What to build\n${KEPT}\n`, { 201: slice([KEPT, DROPPED]) }, root);
    expect(affected).toEqual([]);
  });
});
