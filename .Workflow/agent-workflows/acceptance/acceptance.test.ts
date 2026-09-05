import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { SUITE_ROOTS } from "../shared/affected-tests";
import type { GhExec } from "../shared/gh";
import { createFakeGh } from "../shared/gh.fake";
import { subIssuesPath } from "../shared/gh-paths";
import { createFakeGit } from "../shared/git.fake";
import { scratchDir } from "../shared/scratch.fixture";
import type { GateVerdict } from "../shared/run-gauntlet";
import { createFakeStage, createFakeStages, type FakeStage } from "../shared/stage.fake";
import { extractCriteria, type TicketRead } from "../shared/ticket-shape";
import type { TestRunResult } from "../shared/vitest-json";
import {
  authorAcceptanceTests,
  CLAIMED_FILE_ABSENT,
  commitAuthoredBatch,
  judgeAuthoredBatch,
  landingFromEnv,
  NO_CLAIMED_FILES,
  refireAcceptance,
  renderCriteria,
  renderFiles,
  runAcceptanceAuthor,
  type AuthoredBatch,
  type AuthoredFile,
  type BatchVerdict,
  type CommitDeps,
  type JudgeDeps,
} from "./acceptance";

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

function failsTest(issue: number = ISSUE): string {
  const bodies = extractCriteria(TICKET_BODY)
    .map(
      (_criterion, i) =>
        `test.fails("#${issue}.${i + 1}: criterion ${i + 1}", () => {\n  expect(1).toBe(2);\n});`,
    )
    .join("\n");
  return `import { expect, test } from "vitest";\n${bodies}\n`;
}

function answer(files: AuthoredFile[]): FakeStage {
  return createFakeStage(JSON.stringify({ files }));
}

function authoring(
  files: AuthoredFile[],
  options: { ticket?: TicketRead; readFile?: (path: string) => string | undefined; prdBody?: string } = {},
): { attempt: Promise<AuthoredBatch>; written: string[]; stage: FakeStage } {
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

async function promptFor(options: Parameters<typeof authoring>[1] = {}): Promise<string> {
  const { attempt, stage } = authoring([{ path: TEST_PATH, content: failsTest() }], options);
  await attempt;
  expect(stage.stdins[0], "the author's prompt goes over stdin").toBeDefined();
  return stage.stdins[0] as string;
}

describe("authorAcceptanceTests", () => {
  it("hands the author each criterion verbatim, fenced, with the count", async () => {
    const prompt = await promptFor();
    for (const criterion of extractCriteria(TICKET_BODY)) expect(prompt).toContain(`~~~\n${criterion}\n~~~`);
    expect(prompt).toContain("2 acceptance criteria");
  });

  it("shows the author the text of every file the ticket claims, not just its path", async () => {
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
    const { files } = await attempt;
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

const GATE_GREEN: GateVerdict = { ok: true };

const CLONE_REPORT = "Clone found (typescript):\n - widget.test.ts [12:1 - 17:3]\n   widget.test.ts [30:1 - 35:3]\ngauntlet: FAILED at clones";

const GATE_RED: GateVerdict = { ok: false, output: CLONE_REPORT };

const BATCH = [TEST_PATH, SUBJECT];

function judging(overrides: Partial<JudgeDeps> = {}): JudgeDeps {
  return { runTests: () => GREEN, gate: () => GATE_GREEN, ...overrides };
}

function redReason(verdict: BatchVerdict): string {
  expect(verdict.ok).toBe(false);
  return verdict.ok ? "" : verdict.reason;
}

describe("judgeAuthoredBatch", () => {
  it("is red, before the gate runs, when a test file did not collect", () => {
    let gateRan = false;
    const verdict = judgeAuthoredBatch(
      judging({
        runTests: () => ({ collected: false, collectionError: "widget.test.ts: Cannot find module './widget'", failures: [] }),
        gate: () => {
          gateRan = true;
          return GATE_GREEN;
        },
      }),
      BATCH,
    );
    expect(redReason(verdict)).toContain("Cannot find module './widget'");
    expect(gateRan).toBe(false);
  });

  it("is red, naming the tests, when any is red under test.fails, since those already pass", () => {
    const verdict = judgeAuthoredBatch(
      judging({
        runTests: () => ({
          collected: true,
          failures: [
            { name: "#162: no push", errorName: "Error" },
            { name: "#162: exactly one push", errorName: "Error" },
          ],
        }),
      }),
      BATCH,
    );
    expect(redReason(verdict)).toContain("2 test(s) are red under test.fails");
    expect(redReason(verdict)).toContain("#162: no push, #162: exactly one push");
  });

  it("is red with the gate's own output when the whole gate is red, so clones and wiring count here too", () => {
    expect(redReason(judgeAuthoredBatch(judging({ gate: () => GATE_RED }), BATCH))).toContain(CLONE_REPORT);
  });

  it("runs only the test files of the batch, then the gate once", () => {
    const ran: string[][] = [];
    let gateRuns = 0;
    const verdict = judgeAuthoredBatch(
      judging({
        runTests: (paths) => {
          ran.push(paths);
          return GREEN;
        },
        gate: () => {
          gateRuns += 1;
          return GATE_GREEN;
        },
      }),
      BATCH,
    );
    expect(verdict).toEqual({ ok: true });
    expect(ran).toEqual([[TEST_PATH]]);
    expect(gateRuns).toBe(1);
  });
});

function committing(landing: CommitDeps["landing"]): { deps: CommitDeps; git: ReturnType<typeof createFakeGit> } {
  const git = createFakeGit(() => "");
  return { deps: { git: git.git, paths: BATCH, commitMessage: "Author acceptance tests for #162 from the spec alone", landing }, git };
}

describe("commitAuthoredBatch", () => {
  it("adds, commits, rebases onto origin/main and pushes HEAD:main when landing is push", () => {
    const { deps, git } = committing("push");
    commitAuthoredBatch(deps);
    expect(git.calls).toEqual([
      ["add", TEST_PATH, SUBJECT],
      ["commit", "-m", deps.commitMessage],
      ["fetch", "origin", "main"],
      ["rebase", "origin/main"],
      ["push", "origin", "HEAD:main"],
    ]);
  });

  it("commits and stops when landing is commit, since the contents: write job pushes (ADR-0091)", () => {
    const { deps, git } = committing("commit");
    commitAuthoredBatch(deps);
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

function trackerWith(
  issues: Record<number, TicketRead>,
  subIssues: Record<number, number[]> = {},
  writes?: string[][],
): { gh: GhExec; reads: string[][]; fake: ReturnType<typeof createFakeGh> } {
  const fake = createFakeGh();
  const reads: string[][] = [];
  const gh: GhExec = (args) => {
    if (writes && !(args[0] === "issue" && args[1] === "view")) {
      writes.push(args);
      return "";
    }
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
      gate: () => GATE_GREEN,
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
    expect(tracker.fake.calls, "no write reached gh; this lane never opens a pull request").toEqual([]);
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
      gate: () => GATE_GREEN,
      git: createFakeGit(() => "").git,
    });
    expect(tracker.reads).toHaveLength(1);
    expect(stage.stdins[0]).toContain("(no parent PRD)");
  });
});

describe("runAcceptanceAuthor: a red batch is one repair turn, not a verdict", () => {
  const TRACKER = { [ISSUE]: TICKET, [PRD]: { title: "PRD", body: PRD_BODY } };
  const HELPER = ".Workflow/agent-workflows/shared/widget.fixture.ts";

  async function repairRun(gates: GateVerdict[], first: { sessionId?: string } = { sessionId: "author-1" }) {
    const writes: string[][] = [];
    const tracker = trackerWith(TRACKER, {}, writes);
    const stage = createFakeStages([
      { text: JSON.stringify({ files: [{ path: TEST_PATH, content: failsTest() }] }), ...first },
      JSON.stringify({ files: [{ path: HELPER, content: "export const arrange = 1;\n" }, { path: TEST_PATH, content: failsTest() }] }),
    ]);
    const git = createFakeGit(() => "");
    const written: string[] = [];
    const verdicts = [...gates];
    const outcome = await runAcceptanceAuthor({
      gh: tracker.gh,
      exec: stage.exec,
      writeFile: (path) => written.push(path),
      issueNumber: ISSUE,
      runTests: () => GREEN,
      gate: () => verdicts.shift() ?? GATE_RED,
      git: git.git,
      log: () => {},
    });
    return { outcome, stage, git, written, writes };
  }

  it("resumes the author's session with the judgement, rewrites the files, and lands the repaired batch", async () => {
    const { outcome, stage, git, written, writes } = await repairRun([GATE_RED, GATE_GREEN]);
    expect(outcome).toEqual({ verdict: "pushed" });
    expect(stage.calls[1]).toContain("--resume");
    expect(stage.calls[1]).toContain("author-1");
    expect(stage.stdins[1]).toContain(CLONE_REPORT);
    expect(written).toEqual([TEST_PATH, HELPER, TEST_PATH]);
    expect(git.calls.find((call) => call[0] === "add")).toEqual(["add", HELPER, TEST_PATH]);
    expect(writes).toEqual([]);
  });

  it("stops after that one round when still red: needs-human, the judgement on the ticket, nothing committed", async () => {
    const { outcome, stage, git, writes } = await repairRun([GATE_RED, GATE_RED]);
    expect(outcome.verdict).toBe("refused");
    expect(stage.calls).toHaveLength(2);
    expect(git.calls).toEqual([]);
    expect(writes).toContainEqual(["issue", "edit", String(ISSUE), "--add-label", "needs-human"]);
    const comment = writes.find((call) => call[0] === "issue" && call[1] === "comment");
    expect(comment?.[4]).toContain("one repair round");
    expect(comment?.[4]).toContain(CLONE_REPORT);
  });

  it("has no round to resume when the first answer came back without a session, so it stops on the first judgement", async () => {
    const { outcome, stage, writes } = await repairRun([GATE_RED], {});
    expect(outcome.verdict).toBe("refused");
    expect(stage.calls).toHaveLength(1);
    expect(writes).toContainEqual(["issue", "edit", String(ISSUE), "--add-label", "needs-human"]);
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

  function checkoutWith(tests: Record<string, Array<[sliceNumber: number, index: number]>>): string {
    const root = scratchDir("refire-acceptance");
    for (const [path, refs] of Object.entries(tests)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      const body = refs.map(([sliceNumber, index]) => `test.fails("#${sliceNumber}.${index}: x", () => {});`).join("\n");
      writeFileSync(join(root, path), `${body}\n`, "utf8");
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
      ".Workflow/x.test.ts": [[201, 2]],
      ".claude/hooks/y.test.ts": [[202, 1]],
      ".Workflow/kept.test.ts": [
        [201, 1],
        [203, 1],
      ],
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
    const root = checkoutWith({ ".Workflow/x.test.ts": [[201, 1]] });
    const { affected, calledFor } = await refire(`## What to build\n${KEPT}\n`, { 201: slice([KEPT, DROPPED]) }, root);
    expect(affected).toEqual([]);
    expect(calledFor).toEqual([]);
  });

  it("ignores a slice criterion no existing test names, since that is a re-slice, not a re-entry (ADR-0079)", async () => {
    const root = checkoutWith({ ".Workflow/x.test.ts": [[201, 1]] });
    const { affected } = await refire(`## What to build\n${KEPT}\n`, { 201: slice([KEPT, DROPPED]) }, root);
    expect(affected).toEqual([]);
  });
});
