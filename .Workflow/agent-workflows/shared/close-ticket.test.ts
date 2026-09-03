import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkoutWithCommits, closeTicket, inCloseTicket, issueViewRoute, trackerAnswering } from "./close-ticket.fixture.ts";

/**
 * The refusal #360 added to `bin/close-ticket`: an acceptance test lives beside its subject and is
 * marked `test.fails(` until the ticket it names is built, so a ticket still named by such a line
 * is a ticket nobody has finished — whatever its criteria's own `check:` commands say. The close is
 * refused before a single check runs, naming the lines.
 *
 * Driven through the real interpreter, like the rest of the script's suite: a TypeScript belief
 * about what the Python decides is the thing `render-body.proc.test.ts` found wrong once already.
 */

/** Writes `content` at `path` under `checkout`, creating the directories a suite root needs. */
function fileIn(checkout: string, path: string, content: string): void {
  const resolved = join(checkout, path);
  mkdirSync(dirname(resolved), { recursive: true });
  writeFileSync(resolved, content);
}

describe("surviving_fails_lines", () => {
  it("names every test.fails( or it.fails( line under the suite's two trees that names the ticket", () => {
    const { checkout } = checkoutWithCommits(1);
    fileIn(checkout, ".Workflow/agent-workflows/thing/thing.test.ts", 'import { test } from "vitest";\n\ntest.fails("#999: the thing works", () => {});\n');
    fileIn(checkout, ".claude/hooks/hook.test.ts", 'it.fails("#999: the hook fires", () => {});\n');

    const { stdout } = inCloseTicket(`print(json.dumps(module.surviving_fails_lines(payload["checkout"], "999")))`, { checkout });

    expect(JSON.parse(stdout)).toEqual([
      ".Workflow/agent-workflows/thing/thing.test.ts:3",
      ".claude/hooks/hook.test.ts:1",
    ]);
  });

  it("does not read #99 as #999, a turned-on test as unbuilt, a quoted test.fails( as a test, or a file outside the suite's trees at all", () => {
    const { checkout } = checkoutWithCommits(1);
    fileIn(
      checkout,
      ".Workflow/a.test.ts",
      'test.fails("#99: a different ticket", () => {});\ntest("#999: turned on already", () => {});\nconst sample = \'-  test.fails("#999: quoted as fixture data", () => {\';\n',
    );
    fileIn(checkout, ".Workflow/worktrees/other/b.test.ts", 'test.fails("#999: a sibling checkout", () => {});\n');
    fileIn(checkout, "tests/c.test.ts", 'test.fails("#999: nothing collects this", () => {});\n');

    const { stdout } = inCloseTicket(`print(json.dumps(module.surviving_fails_lines(payload["checkout"], "999")))`, { checkout });

    expect(JSON.parse(stdout)).toEqual([]);
  });
});

describe("a close refused by a surviving test.fails( line, driven end to end", () => {
  const NO_CRITERIA = "Just a task. No acceptance criteria in this body at all.\n";
  const THING_TEST = ".Workflow/agent-workflows/thing/thing.test.ts";

  /** Closes #999 against a checkout whose one test file holds `line`, with a ticket body that has no criteria of its own. */
  function closingWith(line: string) {
    const { checkout, shas } = checkoutWithCommits(1);
    fileIn(checkout, THING_TEST, `${line}\n`);
    const gh = trackerAnswering([issueViewRoute(NO_CRITERIA)]);
    const result = closeTicket(["999", `${shas[0]}..${shas[0]}`, checkout], gh.path);
    return { result, ghCalls: gh.calls().map((call) => call.slice(0, 2)) };
  }

  it("refuses before any check or close, and names the line the ticket has not turned green", () => {
    const { result, ghCalls } = closingWith('test.fails("#999: the thing works", () => {});');

    expect(result.status, result.stderr).not.toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("#999 is still named by 1 test.fails( line(s)");
    expect(result.stderr).toContain(`${THING_TEST}:1`);
    expect(ghCalls).toEqual([["issue", "view"]]);
  });

  it("closes the same ticket once the line has dropped its .fails", () => {
    const { result, ghCalls } = closingWith('test("#999: the thing works", () => {});');

    expect(result.status, result.stderr).toBe(0);
    expect(ghCalls).toContainEqual(["issue", "close"]);
  });
});
