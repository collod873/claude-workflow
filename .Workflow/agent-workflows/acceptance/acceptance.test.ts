import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it, test, vi } from "vitest";
import type { GhExec } from "../shared/gh";
import { createFakeGh } from "../shared/gh.fake";
import { subIssuesPath } from "../shared/gh-paths";
import { ACCEPTING_LABEL } from "../shared/labels";
import type { GitExec } from "../shared/git";
import { createFakeGit } from "../shared/git.fake";
import { scratchDir } from "../shared/scratch.fixture";
import { CHECKOUT_SESSION_DENIED_TOOLS } from "../shared/stage";
import type { SuiteLayout } from "../shared/suite-layout";
import type { GateVerdict } from "../shared/run-gauntlet";
import { createFakeStage, createFakeStages, type FakeStage } from "../shared/stage.fake";
import { makeTempRepo } from "../shared/temp-repo.fixture";
import { extractCriteria, type TicketRead } from "../shared/ticket-shape";
import type { TestRunResult } from "../shared/vitest-json";
import {
  additiveRefusal,
  authorAcceptanceTests,
  changedFiles,
  colocatedTests,
  commitAuthoredBatch,
  exampleSubject,
  judgeAuthoredBatch,
  NO_CLAIMED_FILES,
  NO_EARLIER_ATTEMPT,
  NO_TARGET_TESTS,
  readAuthoredChanges,
  renderCheckContract,
  refireAcceptance,
  renderCriteria,
  REPAIR_ROUNDS,
  runAcceptanceAuthor,
  suiteOf,
  type AuthoredBatch,
  type BatchVerdict,
  type ChangedFile,
  type CommitDeps,
  type JudgeDeps,
} from "./acceptance";

const ISSUE = 162;
const PRD = 145;
const SUBJECT = ".Workflow/agent-workflows/shared/widget.ts";
const TEST_PATH = ".Workflow/agent-workflows/shared/widget.test.ts";

const SUITE: SuiteLayout = { files: [TEST_PATH], roots: [".Workflow", ".claude"], suffixes: [".test.ts"] };

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

const SUMMARY = JSON.stringify({ summary: "tested both criteria" });

function failsTest(issue: number = ISSUE): string {
  const bodies = extractCriteria(TICKET_BODY)
    .map(
      (_criterion, i) =>
        `test.fails("#${issue}.${i + 1}: criterion ${i + 1}", () => {\n  expect(1).toBe(2);\n});`,
    )
    .join("\n");
  return `import { expect, test } from "vitest";\n${bodies}\n`;
}

function created(path: string, content: string): ChangedFile {
  return { path, created: true, deleted: false, added: content.split("\n"), removed: [] };
}

function diffOf(files: ChangedFile[]): string {
  return files
    .map((file) =>
      [
        `diff --git a/${file.path} b/${file.path}`,
        ...(file.created ? ["new file mode 100644"] : []),
        ...(file.deleted ? ["deleted file mode 100644"] : []),
        `--- ${file.created ? "/dev/null" : `a/${file.path}`}`,
        `+++ ${file.deleted ? "/dev/null" : `b/${file.path}`}`,
        "@@ -1 +1 @@",
        ...file.removed.map((line) => `-${line}`),
        ...file.added.map((line) => `+${line}`),
      ].join("\n"),
    )
    .join("\n");
}

function checkoutShowing(...rounds: ChangedFile[][]): ReturnType<typeof createFakeGit> {
  const diffs = rounds.map(diffOf);
  return createFakeGit((args) => (args[0] === "diff" ? (diffs.length > 1 ? diffs.shift() : diffs[0]) ?? "" : ""));
}

const AUTHORED = [created(TEST_PATH, failsTest())];

function authoring(
  files: ChangedFile[],
  options: { ticket?: TicketRead; prdBody?: string } = {},
): { attempt: Promise<AuthoredBatch>; stage: FakeStage; git: ReturnType<typeof createFakeGit> } {
  const stage = createFakeStage(SUMMARY);
  const git = checkoutShowing(files);
  const attempt = authorAcceptanceTests({
    exec: stage.exec,
    git: git.git,
    issueNumber: ISSUE,
    ticket: options.ticket ?? TICKET,
    prdBody: options.prdBody,
    suite: SUITE,
  });
  return { attempt, stage, git };
}

async function promptFor(options: Parameters<typeof authoring>[1] = {}): Promise<string> {
  const { attempt, stage } = authoring(AUTHORED, options);
  await attempt;
  expect(stage.stdins[0], "the author's prompt goes over stdin").toBeDefined();
  return stage.stdins[0] as string;
}

describe("authorAcceptanceTests", () => {
  it("hands the author each criterion verbatim, fenced, with the count", async () => {
    const prompt = await promptFor();
    for (const criterion of extractCriteria(TICKET_BODY)) expect(prompt).toContain(`~~~\n${criterion}\n~~~`);
    expect(prompt).toContain("2 criteria");
  });

  it("names every file the ticket claims, leaving the author to read it from the checkout", async () => {
    expect(await promptFor()).toContain(`- \`${SUBJECT}\``);
  });

  it("hands the author the parent PRD, and says when there is none", async () => {
    expect(await promptFor({ prdBody: PRD_BODY })).toContain(PRD_BODY);
    expect(await promptFor()).toContain("(no parent PRD)");
  });

  it("tells the author the target's own suite roots and test suffixes, not this repository's", async () => {
    const foreign: SuiteLayout = {
      files: ["src/a.test.tsx", "scripts/b.test.mjs"],
      roots: ["scripts", "src"],
      suffixes: [".test.mjs", ".test.tsx"],
    };
    const stage = createFakeStage(SUMMARY);
    await authorAcceptanceTests({
      exec: stage.exec,
      git: checkoutShowing([]).git,
      issueNumber: ISSUE,
      ticket: TICKET,
      suite: foreign,
    });

    const prompt = stage.stdins[0] as string;
    expect(prompt).toContain("`scripts/**`, `src/**`");
    expect(prompt).toContain("`.test.mjs`, `.test.tsx`");
    expect(prompt).not.toContain(".Workflow/**");
    expect(prompt).not.toMatch(/\{\{\w+\}\}/);
  });

  it("keeps this repository's own house rules out of a prompt aimed at another repository", async () => {
    const here = await promptFor();
    expect(here).toContain("shared/gh.fake.ts");

    const stage = createFakeStage(SUMMARY);
    await authorAcceptanceTests({
      exec: stage.exec,
      git: checkoutShowing([]).git,
      issueNumber: ISSUE,
      ticket: TICKET,
      suite: { files: ["src/a.test.tsx"], roots: ["src"], suffixes: [".test.tsx"] },
      houseRules: "",
    });
    expect(stage.stdins[0]).not.toContain("shared/gh.fake.ts");
    expect(stage.stdins[0]).not.toMatch(/\{\{\w+\}\}/);
  });

  it("works the checkout like the implementer does, denied only history rewrites, the tracker and the web", async () => {
    const { attempt, stage } = authoring(AUTHORED);
    await attempt;
    const argv = stage.calls[0];
    expect(argv[argv.indexOf("--disallowedTools") + 1]).toBe(CHECKOUT_SESSION_DENIED_TOOLS.join(","));
    expect(argv).not.toContain("--allowedTools");
  });

  it("reads back what the author changed from the checkout's own diff, new files included", async () => {
    const stub = created(SUBJECT, `export function widget(): never {\n  throw new Error("#${ISSUE}: not built");\n}`);
    const { attempt, git } = authoring([...AUTHORED, stub]);
    const { files } = await attempt;
    expect(files.map((file) => file.path)).toEqual([TEST_PATH, SUBJECT]);
    expect(git.calls).toEqual([
      ["add", "--intent-to-add", "."],
      ["diff", "HEAD", "--no-renames", "--unified=0"],
    ]);
  });

  it("throws, touching nothing, when the ticket declares no acceptance criteria", async () => {
    const ticket = { title: "No criteria", body: "## What to build\nnothing declared\n" };
    const { attempt, stage, git } = authoring(AUTHORED, { ticket });
    await expect(attempt).rejects.toThrow(/no acceptance criteria/);
    expect(stage.calls).toEqual([]);
    expect(git.calls).toEqual([]);
  });
});

describe("readAuthoredChanges", () => {
  it("sees a line appended to a committed test and a file nothing has added yet, against a real checkout", () => {
    const repo = makeTempRepo("acceptance-changes");
    repo.write(TEST_PATH, 'test("kept", () => {});\n');
    repo.commit("seed");
    repo.write(TEST_PATH, `test("kept", () => {});\n${failsTest()}`);
    repo.write(SUBJECT, "export const widget = 1;\n");

    const files = readAuthoredChanges((args) => repo.git(...args));

    expect(files.map((file) => [file.path, file.created, file.removed])).toEqual([
      [TEST_PATH, false, []],
      [SUBJECT, true, []],
    ]);
    expect(files[0].added).toContain('test.fails("#162.1: criterion 1", () => {');
  });
});

describe("changedFiles", () => {
  it("reads a deleted file and the lines an edit removed", () => {
    const diff = [
      "diff --git a/.Workflow/gone.test.ts b/.Workflow/gone.test.ts",
      "deleted file mode 100644",
      "--- a/.Workflow/gone.test.ts",
      "+++ /dev/null",
      "@@ -1 +0,0 @@",
      '-test("gone", () => {});',
      "diff --git a/.Workflow/kept.test.ts b/.Workflow/kept.test.ts",
      "--- a/.Workflow/kept.test.ts",
      "+++ b/.Workflow/kept.test.ts",
      "@@ -2 +2 @@",
      '-test("before", () => {});',
      '+test("after", () => {});',
    ].join("\n");

    expect(changedFiles(diff)).toEqual([
      { path: ".Workflow/gone.test.ts", created: false, deleted: true, added: [], removed: ['test("gone", () => {});'] },
      {
        path: ".Workflow/kept.test.ts",
        created: false,
        deleted: false,
        added: ['test("after", () => {});'],
        removed: ['test("before", () => {});'],
      },
    ]);
  });
});

describe("additiveRefusal", () => {
  const edited = (path: string, added: string[], removed: string[] = []): ChangedFile => ({
    path,
    created: false,
    deleted: false,
    added,
    removed,
  });

  it("admits a new test file naming the ticket, and a new stub beside it", () => {
    expect(additiveRefusal(ISSUE, [...AUTHORED, created(SUBJECT, "export const widget = 1;")], SUITE)).toBeUndefined();
  });

  it("admits tests appended to an existing test file, with their import on its own line", () => {
    const appended = edited(TEST_PATH, ['import { widget } from "./widget";', ...failsTest().split("\n")]);
    expect(additiveRefusal(ISSUE, [appended], SUITE)).toBeUndefined();
  });

  it("accepts it.fails( as the marker too", () => {
    expect(additiveRefusal(ISSUE, [created(TEST_PATH, failsTest().replace("test.fails(", "it.fails("))], SUITE)).toBeUndefined();
  });

  it("refuses a line removed from an existing test file, naming the file and the count", () => {
    const rewritten = edited(TEST_PATH, failsTest().split("\n"), ['test("one", () => {});', 'test("two", () => {});']);
    expect(additiveRefusal(ISSUE, [rewritten], SUITE)).toBe(
      `author removed 2 existing line(s) from ${TEST_PATH}; an acceptance batch only adds lines, so a new import goes on its own line and no existing test is touched`,
    );
  });

  it("refuses an edit to an existing file that is not a test, even one that only adds", () => {
    expect(additiveRefusal(ISSUE, [...AUTHORED, edited(SUBJECT, ["export const more = 2;"])], SUITE)).toMatch(
      new RegExp(`author edited ${SUBJECT}, an existing file that is not a test`),
    );
  });

  it("refuses a deleted file", () => {
    const gone = { ...edited(".Workflow/agent-workflows/shared/old.test.ts", [], ["x"]), deleted: true };
    expect(additiveRefusal(ISSUE, [...AUTHORED, gone], SUITE)).toMatch(/author deleted .*old\.test\.ts/);
  });

  it("refuses a checkout the author left untouched", () => {
    expect(additiveRefusal(ISSUE, [], SUITE)).toBe("author changed nothing in the checkout");
  });

  it.each(["tests/acceptance/162-x.test.ts", "src/widget.test.ts", ".Workflowish/x.test.ts"])(
    "refuses a path outside the suite's trees (%s)",
    (path) => {
      expect(additiveRefusal(ISSUE, [...AUTHORED, created(path, failsTest())], SUITE)).toBe(
        `author wrote outside ${SUITE.roots.join("/, ")}/: ${path}`,
      );
    },
  );

  it.each([
    ["a plain test(", failsTest().replace(/test\.fails\(/g, "test(")],
    ["a test.fails( naming another ticket", failsTest(999)],
    ["no test at all", "export const nothing = 1;"],
  ])("refuses a test file carrying %s", (_shape, content) => {
    expect(additiveRefusal(ISSUE, [created(TEST_PATH, content)], SUITE)).toMatch(
      new RegExp(`no test file carrying a test.fails\\( naming #${ISSUE}`),
    );
  });

  it("refuses a batch of stubs and no test", () => {
    expect(additiveRefusal(ISSUE, [created(SUBJECT, "export const widget = 1;")], SUITE)).toMatch(/no test file/);
  });
});

describe("exampleSubject", () => {
  it("names the busiest tree and the busiest suffix, so the worked example looks like this repository", () => {
    const suite: SuiteLayout = {
      files: ["src/a.test.tsx", "src/b.test.tsx", "scripts/c.test.mjs"],
      roots: ["scripts", "src"],
      suffixes: [".test.mjs", ".test.tsx"],
    };

    expect(exampleSubject(suite, "widget")).toEqual({ subject: "src/widget.tsx", test: "src/widget.test.tsx" });
  });

  it("falls back to the first of each when the counts cannot separate them", () => {
    const suite: SuiteLayout = { files: [], roots: [".Workflow"], suffixes: [".test.ts"] };

    expect(exampleSubject(suite, "widget")).toEqual({ subject: ".Workflow/widget.ts", test: ".Workflow/widget.test.ts" });
  });
});

describe("suiteOf", () => {
  it("refuses a target whose runner collects nothing, rather than authoring into a tree nothing reads", () => {
    expect(() => suiteOf({ suite: { files: [], roots: [], suffixes: [] } })).toThrow(/collects no tests at all/);
  });

  it("takes the caller's suite as given when it names a tree", () => {
    expect(suiteOf({ suite: SUITE })).toBe(SUITE);
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
  it("says which phase it is in and what each cost, so a run stuck here is not silence", () => {
    const lines: string[] = [];
    judgeAuthoredBatch(judging({ log: (line) => lines.push(line) }), BATCH, SUITE.suffixes);
    const said = lines.join("\n");
    expect(said).toContain("running the authored batch");
    expect(said).toContain("batch ran in");
    expect(said).toContain("gating");
    expect(said).toContain("turn venue answered in");
  });

  it("says the batch ran even when it comes back red, so the slow phase is named either way", () => {
    const lines: string[] = [];
    judgeAuthoredBatch(
      judging({
        log: (line) => lines.push(line),
        runTests: () => ({ collected: false, collectionError: "no module", failures: [] }),
      }),
      BATCH,
      SUITE.suffixes,
    );
    expect(lines.join("\n")).toContain("batch ran in");
  });

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
      SUITE.suffixes,
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
      SUITE.suffixes,
    );
    expect(redReason(verdict)).toContain("2 test(s) are red under test.fails");
    expect(redReason(verdict)).toContain("#162: no push, #162: exactly one push");
  });

  it("is red with the gate's own output when the whole gate is red, so clones and wiring count here too", () => {
    expect(redReason(judgeAuthoredBatch(judging({ gate: () => GATE_RED }), BATCH, SUITE.suffixes))).toContain(CLONE_REPORT);
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
      SUITE.suffixes,
    );
    expect(verdict).toEqual({ ok: true });
    expect(ran).toEqual([[TEST_PATH]]);
    expect(gateRuns).toBe(1);
  });
});

function committing(onOrigin: boolean): { deps: CommitDeps; git: ReturnType<typeof createFakeGit> } {
  const git = createFakeGit((args) =>
    args[0] === "ls-remote" ? (onOrigin ? "abc123\trefs/heads/accept/issue-162\n" : "") : "",
  );
  return {
    deps: {
      git: git.git,
      paths: BATCH,
      commitMessage: "test: author acceptance tests for #162 from the spec alone",
      branch: "accept/issue-162",
      log: () => {},
    },
    git,
  };
}

describe("commitAuthoredBatch", () => {
  it("cuts the ticket's branch off the checked-out trunk and pushes it, never touching main", () => {
    const { deps, git } = committing(false);
    commitAuthoredBatch(deps);
    expect(git.calls).toEqual([
      ["ls-remote", "--heads", "origin", "accept/issue-162"],
      ["checkout", "-B", "accept/issue-162"],
      ["add", TEST_PATH, SUBJECT],
      ["commit", "--allow-empty", "-m", deps.commitMessage],
      ["push", "--no-verify", "origin", "HEAD:accept/issue-162"],
    ]);
    expect(git.calls.flat()).not.toContain("HEAD:main");
  });

  it("pushes past the pre-push hook, whose whole suite the implementer re-runs on this same branch", () => {
    const { deps, git } = committing(false);
    commitAuthoredBatch(deps);
    expect(git.calls.at(-1)).toContain("--no-verify");
  });

  it("commits a batch that adds nothing the tree did not already have, rather than dying on an empty index", () => {
    const { deps, git } = committing(false);
    commitAuthoredBatch(deps);
    expect(git.calls.find((call) => call[0] === "commit")).toContain("--allow-empty");
  });

  it("commits on top of the branch a sibling run already pushed, rather than replacing it", () => {
    const { deps, git } = committing(true);
    commitAuthoredBatch(deps);
    expect(git.calls).toEqual([
      ["ls-remote", "--heads", "origin", "accept/issue-162"],
      ["fetch", "origin", "accept/issue-162"],
      ["checkout", "-B", "accept/issue-162", "origin/accept/issue-162"],
      ["add", TEST_PATH, SUBJECT],
      ["commit", "--allow-empty", "-m", deps.commitMessage],
      ["push", "--no-verify", "origin", "HEAD:accept/issue-162"],
    ]);
  });
});

type SubIssueRef = number | { number: number; state: string };

function trackerWith(
  issues: Record<number, TicketRead>,
  subIssues: Record<number, SubIssueRef[]> = {},
  writes?: string[][],
): { gh: GhExec; reads: string[][]; fake: ReturnType<typeof createFakeGh> } {
  return trackerReading(issues, subIssues, writes);
}

const notALaneStamp = (args: string[]): boolean =>
  args[0] !== "label" && !(args[0] === "issue" && args[1] === "edit" && args.includes(ACCEPTING_LABEL));

function trackerReading(
  issues: Record<number, TicketRead>,
  subIssues: Record<number, SubIssueRef[]>,
  writes?: string[][],
): { gh: GhExec; reads: string[][]; fake: ReturnType<typeof createFakeGh> } {
  const fake = createFakeGh();
  const reads: string[][] = [];
  const gh: GhExec = (args) => {
    if (writes && !(args[0] === "issue" && args[1] === "view")) {
      writes.push(args);
      return "";
    }
    if (args[0] === "label" || (args[0] === "issue" && args[1] === "edit")) {
      fake.calls.push(args);
      return "";
    }
    if (args[0] === "issue" && args[1] === "view" && args[args.indexOf("--json") + 1] === "labels") return "{}";
    if (args[0] === "issue" && args[1] === "view") {
      reads.push(args);
      const issue = issues[Number(args[2])];
      if (!issue) throw new Error(`no issue #${args[2]} in this test's tracker`);
      return JSON.stringify(issue);
    }
    for (const [parent, numbers] of Object.entries(subIssues)) {
      if (args[0] === "api" && args[1] === subIssuesPath(Number(parent)) && !args.includes("-F")) {
        reads.push(args);
        return JSON.stringify(numbers.map((ref) => (typeof ref === "number" ? { number: ref, state: "open" } : ref)));
      }
    }
    return fake.gh(args);
  };
  return { gh, reads, fake };
}

describe("runAcceptanceAuthor", () => {
  const TRACKER = { [ISSUE]: TICKET, [PRD]: { title: "PRD", body: PRD_BODY } };

  function run() {
    const tracker = trackerWith(TRACKER);
    const stage = createFakeStage(SUMMARY);
    const git = checkoutShowing(AUTHORED);
    const outcome = runAcceptanceAuthor({
      gh: tracker.gh,
      exec: stage.exec,
      issueNumber: ISSUE,
      runTests: () => GREEN,
      gate: () => GATE_GREEN,
      git: git.git,
      suite: SUITE,
    });
    return { outcome, tracker, stage, git };
  }

  it("reads the ticket and its parent PRD, and sends the tracker nothing else", async () => {
    const { outcome, tracker, stage } = run();
    expect(await outcome).toEqual({ verdict: "pushed" });
    expect(tracker.reads).toEqual([
      ["issue", "view", String(ISSUE), "--json", "title,body"],
      ["issue", "view", String(PRD), "--json", "title,body"],
    ]);
    expect(tracker.fake.calls.filter(notALaneStamp), "no write reached gh; this lane never opens a pull request").toEqual([]);
    expect(tracker.fake.calls[0]).toEqual(expect.arrayContaining(["label", "create", ACCEPTING_LABEL]));
    expect(stage.stdins[0]).toContain(PRD_BODY);
  });

  const STRIKE_SIGNATURE = "author wrote no test file carrying a test.fails( naming #162";

  function struck(tracker: { gh: GhExec }, bodies: string[]): GhExec {
    return (args) =>
      args[0] === "issue" && args[1] === "view" && args[args.indexOf("--json") + 1] === "comments"
        ? JSON.stringify({ comments: bodies.map((body) => ({ body })) })
        : tracker.gh(args);
  }

  function runAtRung(rung: string | undefined, bodies: string[]) {
    const tracker = trackerWith(TRACKER);
    const stage = createFakeStage(SUMMARY);
    const outcome = runAcceptanceAuthor({
      gh: struck(tracker, bodies),
      exec: stage.exec,
      issueNumber: ISSUE,
      runTests: () => GREEN,
      gate: () => GATE_GREEN,
      git: checkoutShowing(AUTHORED).git,
      suite: SUITE,
      rung,
    });
    return { outcome, stage };
  }

  it("hands the author what every earlier run died on when the reconciler sends it back at rung two", async () => {
    const { outcome, stage } = runAtRung("fresh-eyes", [
      `<!-- strike:v1 run=910 conclusion=failure -->\n<!-- strike-signature:${STRIKE_SIGNATURE} -->`,
    ]);

    expect(await outcome).toEqual({ verdict: "pushed" });
    expect(stage.stdins[0]).toContain(STRIKE_SIGNATURE);
  });

  it("tells rung one there was no earlier attempt, so a first author reads no strike it has to answer", async () => {
    const { outcome, stage } = runAtRung(undefined, [
      `<!-- strike:v1 run=910 conclusion=failure -->\n<!-- strike-signature:${STRIKE_SIGNATURE} -->`,
    ]);

    await outcome;
    expect(stage.stdins[0]).not.toContain(STRIKE_SIGNATURE);
    expect(stage.stdins[0]).toContain(NO_EARLIER_ATTEMPT);
  });

  it("lands what the author changed with a commit message naming the ticket, and pushes", async () => {
    const { outcome, git } = run();
    await outcome;
    expect(git.calls).toContainEqual(["add", TEST_PATH]);
    const commit = git.calls.find((call) => call[0] === "commit");
    expect(commit?.at(-1)).toContain(`#${ISSUE}`);
    expect(commit?.at(-1)).toContain(TEST_PATH);
    expect(git.calls.filter((call) => call[0] === "push")).toEqual([
      ["push", "--no-verify", "origin", `HEAD:accept/issue-${ISSUE}`],
    ]);
  });

  it("reads only the ticket when it names no parent PRD", async () => {
    const tracker = trackerWith({ [ISSUE]: { title: "t", body: TICKET_BODY.replace(`## Parent PRD\n#${PRD}\n\n`, "") } });
    const stage = createFakeStage(SUMMARY);
    await runAcceptanceAuthor({
      gh: tracker.gh,
      exec: stage.exec,
      issueNumber: ISSUE,
      runTests: () => GREEN,
      gate: () => GATE_GREEN,
      git: checkoutShowing(AUTHORED).git,
      suite: SUITE,
    });
    expect(tracker.reads).toHaveLength(1);
    expect(stage.stdins[0]).toContain("(no parent PRD)");
  });
});

describe("runAcceptanceAuthor: a red batch is one repair turn, not a verdict", () => {
  const TRACKER = { [ISSUE]: TICKET, [PRD]: { title: "PRD", body: PRD_BODY } };
  const HELPER = ".Workflow/agent-workflows/shared/widget.fixture.ts";
  const REPAIRED = [created(HELPER, "export const arrange = 1;"), ...AUTHORED];

  async function repairRun(gates: GateVerdict[], first: { sessionId?: string } = { sessionId: "author-1" }) {
    const writes: string[][] = [];
    const tracker = trackerWith(TRACKER, {}, writes);
    const stage = createFakeStages([
      { text: SUMMARY, ...first },
      ...Array.from({ length: REPAIR_ROUNDS }, () => ({ text: SUMMARY, sessionId: "author-1" })),
    ]);
    const git = checkoutShowing(AUTHORED, REPAIRED);
    const verdicts = [...gates];
    const outcome = await runAcceptanceAuthor({
      gh: tracker.gh,
      exec: stage.exec,
      issueNumber: ISSUE,
      runTests: () => GREEN,
      gate: () => verdicts.shift() ?? GATE_RED,
      git: git.git,
      log: () => {},
      suite: SUITE,
    });
    return { outcome, stage, git, writes };
  }

  const landed = (git: ReturnType<typeof createFakeGit>) => git.calls.filter((call) => call[0] === "commit" || call[0] === "push");

  it("resumes the author's session with the judgement, rereads the checkout, and lands the repaired batch", async () => {
    const { outcome, stage, git, writes } = await repairRun([GATE_RED, GATE_GREEN]);
    expect(outcome).toEqual({ verdict: "pushed" });
    expect(stage.calls[1]).toContain("--resume");
    expect(stage.calls[1]).toContain("author-1");
    expect(stage.stdins[1]).toContain(CLONE_REPORT);
    expect(git.calls).toContainEqual(["add", HELPER, TEST_PATH]);
    expect(writes.filter(notALaneStamp)).toEqual([]);
    expect(writes).toContainEqual(["issue", "edit", String(ISSUE), "--add-label", ACCEPTING_LABEL]);
  });

  it("stops after the last repair round when still red: the judgement on the ticket, no needs-human, nothing committed", async () => {
    const { outcome, stage, git, writes } = await repairRun(
      Array.from({ length: REPAIR_ROUNDS + 1 }, (_unused, round) => ({ ok: false, output: `${CLONE_REPORT}\nround ${round}` })),
    );
    expect(outcome.verdict).toBe("refused");
    expect(stage.calls, "one authoring call, then every repair round, and no more").toHaveLength(REPAIR_ROUNDS + 1);
    expect(landed(git)).toEqual([]);
    expect(writes.some((call) => call.includes("needs-human"))).toBe(false);
    const comment = writes.find((call) => call[0] === "issue" && call[1] === "comment");
    expect(comment?.[4]).toContain(`all ${REPAIR_ROUNDS} of its repair rounds`);
    expect(comment?.[4]).toContain(CLONE_REPORT);
  });

  it("has no round to resume when the first answer came back without a session, so it stops on the first judgement", async () => {
    const { outcome, stage, writes } = await repairRun([GATE_RED], {});
    expect(outcome.verdict).toBe("refused");
    expect(stage.calls).toHaveLength(1);
    expect(writes.some((call) => call.includes("needs-human"))).toBe(false);
    expect(writes.find((call) => call[0] === "issue" && call[1] === "comment")?.[4]).toContain(`all ${REPAIR_ROUNDS} of its repair rounds`);
  });

  it("hands a diff that removed a line to the repair round rather than to the tests", async () => {
    const writes: string[][] = [];
    const rewrote: ChangedFile = { path: TEST_PATH, created: false, deleted: false, added: failsTest().split("\n"), removed: ["x"] };
    let testsRan = 0;
    const stage = createFakeStages([
      { text: SUMMARY, sessionId: "author-1" },
      { text: SUMMARY, sessionId: "author-1" },
    ]);
    const outcome = await runAcceptanceAuthor({
      gh: trackerWith(TRACKER, {}, writes).gh,
      exec: stage.exec,
      issueNumber: ISSUE,
      runTests: () => {
        testsRan += 1;
        return GREEN;
      },
      gate: () => GATE_GREEN,
      git: checkoutShowing([rewrote], AUTHORED).git,
      log: () => {},
      suite: SUITE,
    });
    expect(outcome).toEqual({ verdict: "pushed" });
    expect(stage.stdins[1]).toContain(`author removed 1 existing line(s) from ${TEST_PATH}`);
    expect(testsRan).toBe(1);
  });
});

describe("refireAcceptance", () => {
  const PRD_NUMBER = 301;
  const KEPT = "make test exits 0 with a criterion the edit leaves untouched";
  const DROPPED = "make test exits 0 with a criterion the edit removes";
  const OTHER_DROPPED = "make test exits 0 with a second criterion the edit removes";
  const SLICER_WORDING = "make test exits 0 with wording only the slicer ever wrote";

  const SPEC_BEFORE = `## What to build\n${KEPT}\n${DROPPED}\n${OTHER_DROPPED}\n`;
  const SPEC_AFTER = `## What to build\n${KEPT}\n`;

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

  async function refire(
    prdBody: string,
    slices: Record<number, TicketRead>,
    root: string,
    { noEarlierBody = false, closed = [] as number[] } = {},
  ) {
    const calledFor: number[] = [];
    const tracker = trackerWith(
      { [PRD_NUMBER]: { title: "PRD", body: prdBody }, ...slices },
      {
        [PRD_NUMBER]: Object.keys(slices)
          .map(Number)
          .reverse()
          .map((number) => ({ number, state: closed.includes(number) ? "closed" : "open" })),
      },
    );
    const affected = await refireAcceptance({
      gh: tracker.gh,
      prdNumber: PRD_NUMBER,
      bodyBeforeEdit: noEarlierBody ? undefined : SPEC_BEFORE,
      authorForSlice: (sliceNumber) => {
        calledFor.push(sliceNumber);
      },
      root,
    });
    return { affected, calledFor, tracker };
  }

  it("re-authors exactly the slices whose existing test lost a criterion this edit removed, in ascending order", async () => {
    const root = checkoutWith({
      ".Workflow/x.test.ts": [[201, 2]],
      ".claude/hooks/y.test.ts": [[202, 1]],
      ".Workflow/kept.test.ts": [
        [201, 1],
        [203, 1],
      ],
    });
    const { affected, calledFor, tracker } = await refire(
      SPEC_AFTER,
      { 202: slice([OTHER_DROPPED]), 201: slice([KEPT, DROPPED]), 203: slice([KEPT]) },
      root,
    );
    expect(affected).toEqual([{ sliceNumber: 201 }, { sliceNumber: 202 }]);
    expect(calledFor).toEqual([201, 202]);
    expect(tracker.fake.calls, "reads only").toEqual([]);
  });

  it("re-authors nothing when the edit leaves every slice's criteria untouched, whatever else it changed", async () => {
    const root = checkoutWith({ ".Workflow/x.test.ts": [[201, 1]] });
    const { affected, calledFor } = await refire(
      `${SPEC_BEFORE}A sentence the owner added.\n`,
      { 201: slice([SLICER_WORDING]) },
      root,
    );
    expect(affected).toEqual([]);
    expect(calledFor).toEqual([]);
  });

  it("re-authors nothing when the spec never carried the slicer's wording, which is every slice it ever writes", async () => {
    const root = checkoutWith({ ".Workflow/x.test.ts": [[201, 1]] });
    const { affected } = await refire(SPEC_AFTER, { 201: slice([SLICER_WORDING]) }, root);
    expect(affected).toEqual([]);
  });

  it("never re-authors a closed slice, whose work is already on main", async () => {
    const root = checkoutWith({
      ".Workflow/x.test.ts": [[201, 1]],
      ".Workflow/y.test.ts": [[202, 1]],
    });
    const { affected, calledFor } = await refire(
      SPEC_AFTER,
      { 201: slice([DROPPED]), 202: slice([OTHER_DROPPED]) },
      root,
      { closed: [201] },
    );
    expect(affected).toEqual([{ sliceNumber: 202 }]);
    expect(calledFor).toEqual([202]);
  });

  it("re-authors nothing, and reads nothing, when no earlier body came with the edit", async () => {
    const root = checkoutWith({ ".Workflow/x.test.ts": [[201, 1]] });
    const { affected, calledFor, tracker } = await refire(SPEC_AFTER, { 201: slice([DROPPED]) }, root, {
      noEarlierBody: true,
    });
    expect(affected).toEqual([]);
    expect(calledFor).toEqual([]);
    expect(tracker.reads).toEqual([]);
  });

  it("ignores a slice criterion no existing test names, since that is a re-slice, not a re-entry (ADR-0079)", async () => {
    const root = checkoutWith({ ".Workflow/x.test.ts": [[201, 1]] });
    const { affected } = await refire(SPEC_AFTER, { 201: slice([KEPT, DROPPED]) }, root);
    expect(affected).toEqual([]);
  });
});

describe("a subject the test runs as a process gets no stub", () => {
  const HOOK = ".claude/hooks/session-brief.py";
  const HARNESS = ".claude/hooks/test_session_brief.py";

  test("#448.2: the lane refuses a non-test .py under .claude/hooks/, naming it, before any test runs", async () => {
    const tracker = trackerWith({ [ISSUE]: TICKET, [PRD]: { title: "PRD", body: PRD_BODY } }, {}, []);
    let testsRan = false;
    const outcome = await runAcceptanceAuthor({
      gh: tracker.gh,
      exec: createFakeStage(SUMMARY).exec,
      issueNumber: ISSUE,
      runTests: () => {
        testsRan = true;
        return GREEN;
      },
      gate: () => GATE_GREEN,
      git: checkoutShowing([...AUTHORED, created(HOOK, `raise SystemExit("#${ISSUE}: not built")`)]).git,
      log: () => {},
      suite: SUITE,
    });

    const refusal = outcome.verdict === "refused" ? outcome.reason : "";
    expect(refusal).toContain(HOOK);
    expect(refusal).toMatch(/stub|\.proc\.test\.ts/i);
    expect(testsRan).toBe(false);
  });

  test("#448.3: the no-test-file refusal names the suffixes it looked for", () => {
    const suite: SuiteLayout = {
      files: [".claude/hooks/ticket-shape.test.tsx"],
      roots: [".claude"],
      suffixes: [".test.mjs", ".test.tsx"],
    };

    const refusal = additiveRefusal(ISSUE, [created(HARNESS, "def test_brief():\n    assert False")], suite) ?? "";

    expect(refusal).toContain("no test file");
    for (const suffix of suite.suffixes) expect(refusal).toContain(suffix);
  });
});

describe("the lane budget bounds the acceptance author's model session", () => {
  const TRACKER = { [ISSUE]: TICKET, [PRD]: { title: "PRD", body: PRD_BODY } };
  const TIMED_OUT = /timed out after \d+ minutes at \S+/;
  const WELL_PAST_ANY_BUDGET_MS = 6 * 60 * 60 * 1000;

  function sessionThatNeverReturns() {
    const writes: string[][] = [];
    const tracker = trackerWith(TRACKER, {}, writes);
    const hangingExec = (() => new Promise(() => {})) as unknown as FakeStage["exec"];
    let settlement: string | undefined;
    void runAcceptanceAuthor({
      gh: tracker.gh,
      exec: hangingExec,
      issueNumber: ISSUE,
      runTests: () => GREEN,
      gate: () => GATE_GREEN,
      git: checkoutShowing(AUTHORED).git,
      log: () => {},
      suite: SUITE,
    }).then(
      (outcome) => {
        settlement = JSON.stringify(outcome);
      },
      (thrown: unknown) => {
        settlement = String((thrown as Error)?.message ?? thrown);
      },
    );
    return { writes, settlement: () => settlement };
  }

  async function settleMicrotasks(): Promise<void> {
    for (let turn = 0; turn < 20; turn += 1) await Promise.resolve();
  }

  test("#503.1: the acceptance author's session runs under the lane budget, not a bare runStageSession", async () => {
    vi.useFakeTimers();
    try {
      const run = sessionThatNeverReturns();
      await vi.advanceTimersByTimeAsync(30_000);
      await settleMicrotasks();
      expect(run.settlement(), "the budget is a duration, so half a minute in the session is still running").toBeUndefined();

      await vi.advanceTimersByTimeAsync(WELL_PAST_ANY_BUDGET_MS);
      await settleMicrotasks();
      expect(
        run.settlement(),
        "a model session that never returns ends on the lane budget instead of running forever",
      ).toBeDefined();
      expect(String(run.settlement())).toMatch(/timed out|budget/i);
    } finally {
      vi.useRealTimers();
    }
  });

  test("#503.2: an elapsed budget strikes the ticket with the timed-out signature", async () => {
    vi.useFakeTimers();
    try {
      const run = sessionThatNeverReturns();
      await vi.advanceTimersByTimeAsync(WELL_PAST_ANY_BUDGET_MS);
      await settleMicrotasks();

      const strike = run.writes.find((call) => call.some((arg) => TIMED_OUT.test(arg)));
      expect(strike, `nothing matching ${TIMED_OUT} reached the tracker: ${JSON.stringify(run.writes)}`).toBeDefined();
      expect(strike, "the strike lands on the ticket the lane was authoring for").toContain(String(ISSUE));
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("the acceptance lane rings no lane, leaving the handoff to the reconciler", () => {
  test("a pushed batch dispatches nothing, so a ticket reaches implement only by recompute", async () => {
    const writes: string[][] = [];
    const tracker = trackerWith({ [ISSUE]: TICKET, [PRD]: { title: "PRD", body: PRD_BODY } }, {}, writes);

    await runAcceptanceAuthor({
      gh: tracker.gh,
      exec: createFakeStage(SUMMARY).exec,
      issueNumber: ISSUE,
      runTests: () => GREEN,
      gate: () => GATE_GREEN,
      git: checkoutShowing(AUTHORED).git,
      log: () => {},
      suite: SUITE,
    });

    const dispatched = writes.filter((call) => call.join(" ").includes("dispatches"));
    expect(dispatched, `acceptance rang a lane: ${JSON.stringify(dispatched)}`).toEqual([]);
  });
});

describe("the acceptance lane never reaches trunk", () => {
  test("the authored batch is pushed to the ticket's branch, and no call in the lane targets main", async () => {
    const tracker = trackerWith({ [ISSUE]: TICKET, [PRD]: { title: "PRD", body: PRD_BODY } });
    const git = checkoutShowing(AUTHORED);

    const outcome = await runAcceptanceAuthor({
      gh: tracker.gh,
      exec: createFakeStage(SUMMARY).exec,
      issueNumber: ISSUE,
      runTests: () => GREEN,
      gate: () => GATE_GREEN,
      git: git.git,
      log: () => {},
      suite: SUITE,
    });

    expect(outcome).toEqual({ verdict: "pushed" });

    const pushes = git.calls.filter((call) => call[0] === "push");
    expect(pushes).toEqual([["push", "--no-verify", "origin", `HEAD:accept/issue-${ISSUE}`]]);
    expect(git.calls.flat()).not.toContain("main");
    expect(git.calls.filter((call) => call[0] === "rebase"), "a branch push races nobody").toHaveLength(0);
  });
});

describe("colocatedTests", () => {
  it("finds the suite's tests sitting beside a claimed subject, whatever the subject's extension", () => {
    const suite: SuiteLayout = {
      files: [
        ".claude/hooks/close-gate.proc.test.ts",
        ".Workflow/agent-workflows/shared/widget.test.ts",
        ".Workflow/agent-workflows/shared/widget-other.test.ts",
      ],
      roots: [".Workflow", ".claude"],
      suffixes: [".test.ts"],
    };

    expect(colocatedTests([".claude/hooks/close-gate.py", ".Workflow/agent-workflows/shared/widget.ts"], suite)).toEqual([
      ".claude/hooks/close-gate.proc.test.ts",
      ".Workflow/agent-workflows/shared/widget.test.ts",
    ]);
    expect(colocatedTests([], suite)).toEqual([]);
  });
});

describe("what the author is pointed at", () => {
  it("lists the tests beside a claimed subject by path, so it appends to them rather than inventing them", async () => {
    expect(await promptFor()).toContain(`- \`${TEST_PATH}\``);
  });

  it("says so plainly when the ticket claims nothing and no test sits beside anything", async () => {
    const ticket = { title: "t", body: TICKET_BODY.replace(`## Files claimed\n- ${SUBJECT}\n`, "") };
    const prompt = await promptFor({ ticket });
    expect(prompt).toContain(NO_TARGET_TESTS);
    expect(prompt).toContain(NO_CLAIMED_FILES);
  });
});

describe("renderCheckContract", () => {
  it("tabulates the target's own slots, so an enrolled repo is judged by its contract and not this one's", () => {
    const table = renderCheckContract({ test: { cmd: "npm test" }, lint: { cmd: "npm run lint" }, absent: {} });

    expect(table).toContain("`test`");
    expect(table).toContain("`npm test`");
    expect(table).toContain("`npm run lint`");
    expect(table).not.toContain("absent");
    expect(renderCheckContract({})).toContain("names no check contract");
  });
});

describe("refireAcceptance reaches the tracker without building an api argv of its own", () => {
  test.fails("#624.1: reading which slices are still open sends gh no api argv", async () => {
    const prdNumber = 301;
    let sawApiArgv = false;
    const gh: GhExec = (args) => {
      if (args[0] === "api") {
        sawApiArgv = true;
        return "[]";
      }
      if (args[0] === "issue" && args[1] === "view") {
        return JSON.stringify({ title: "PRD", body: "## What to build\nsomething\n" });
      }
      return "";
    };

    await refireAcceptance({
      gh,
      prdNumber,
      bodyBeforeEdit: "## What to build\nold\n",
      authorForSlice: () => {},
    });

    expect(sawApiArgv).toBe(false);
  });
});
