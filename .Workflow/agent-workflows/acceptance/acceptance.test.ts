import { describe, expect, it } from "vitest";
import { createFakeStage } from "../shared/stage.fake";
import { CRITERIA_ITEM_RE } from "../shared/ticket-shape";
import {
  authorAcceptanceTests,
  extractCriteria,
  parentPrdNumber,
  readTicket,
  runAcceptanceAuthor,
} from "./acceptance";

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
    const stage = createFakeStage(
      authorResponse([
        {
          path: "tests/acceptance/162-no-push-on-collection-error.test.ts",
          content: `// ${firstCriterion}\nimport { describe, it, expect } from "vitest";\ndescribe("x", () => { it("y", () => { expect(true).toBe(false); }); });\n`,
        },
      ]),
    );
    const written = new Map<string, string>();

    const paths = await authorAcceptanceTests({
      exec: stage.exec,
      writeFile: (path, content) => written.set(path, content),
      issueNumber: 162,
      ticket: { title: "Author acceptance tests", body: TICKET_BODY },
      prdBody: PRD_BODY,
    });

    expect(paths).toEqual(["tests/acceptance/162-no-push-on-collection-error.test.ts"]);
    const content = written.get("tests/acceptance/162-no-push-on-collection-error.test.ts");
    expect(content).toBeDefined();
    // The criterion string appears verbatim in the written test.
    expect(content).toContain(firstCriterion);
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
