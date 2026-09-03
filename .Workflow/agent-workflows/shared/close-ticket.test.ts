import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkoutWithCommits, closeTicket, issueViewRoute, trackerAnswering } from "./close-ticket.fixture.ts";

/**
 * The refusal #360 added to `bin/close-ticket`: an acceptance test lives beside its subject and is
 * marked `test.fails(` until the ticket it names is built, so a ticket still named by such a line
 * is a ticket nobody has finished — whatever its criteria's own `check:` commands say. The close is
 * refused before a single check runs, naming the lines.
 *
 * Every case here is driven through the script's own command line, against a real repository and a
 * `gh` this suite records: which lines survive is only ever interesting as the answer to whether a
 * close reached the tracker, so that is what gets asserted — the message the real script printed
 * and the calls it made, not a function reached behind the CLI.
 */

/** Writes `content` at `path` under `checkout`, creating the directories a suite root needs. */
function fileIn(checkout: string, path: string, content: string): void {
  const resolved = join(checkout, path);
  mkdirSync(dirname(resolved), { recursive: true });
  writeFileSync(resolved, content);
}

describe("a close refused by a surviving test.fails( line", () => {
  const NO_CRITERIA = "Just a task. No acceptance criteria in this body at all.\n";
  const THING_TEST = ".Workflow/agent-workflows/thing/thing.test.ts";
  const HOOK_TEST = ".claude/hooks/hook.test.ts";

  /** Closes #999 against a checkout holding `files` (path to content), with a ticket body that has no criteria of its own. */
  function closingWith(files: Record<string, string>) {
    const { checkout, shas } = checkoutWithCommits(1);
    for (const [path, content] of Object.entries(files)) fileIn(checkout, path, content);
    const gh = trackerAnswering([issueViewRoute(NO_CRITERIA)]);
    const result = closeTicket(["999", `${shas[0]}..${shas[0]}`, checkout], gh.path);
    return { result, ghCalls: gh.calls().map((call) => call.slice(0, 2)) };
  }

  it("refuses before any check or close, naming every test.fails( or it.fails( line under the suite's two trees that names the ticket", () => {
    const { result, ghCalls } = closingWith({
      [THING_TEST]: 'import { test } from "vitest";\n\ntest.fails("#999: the thing works", () => {});\n',
      [HOOK_TEST]: 'it.fails("#999: the hook fires", () => {});\n',
    });

    expect(result.status, result.stderr).not.toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("#999 is still named by 2 test.fails( line(s)");
    expect(result.stderr).toContain(`${THING_TEST}:3`);
    expect(result.stderr).toContain(`${HOOK_TEST}:1`);
    expect(ghCalls).toEqual([["issue", "view"]]);
  });

  it("closes the same ticket once the line has dropped its .fails", () => {
    const { result, ghCalls } = closingWith({ [THING_TEST]: 'test("#999: the thing works", () => {});\n' });

    expect(result.status, result.stderr).toBe(0);
    expect(ghCalls).toContainEqual(["issue", "close"]);
  });

  it("does not read #99 as #999, a turned-on test as unbuilt, a quoted test.fails( as a test, or a file outside the suite's trees at all", () => {
    const { result, ghCalls } = closingWith({
      ".Workflow/a.test.ts":
        'test.fails("#99: a different ticket", () => {});\ntest("#999: turned on already", () => {});\nconst sample = \'-  test.fails("#999: quoted as fixture data", () => {\';\n',
      ".Workflow/worktrees/other/b.test.ts": 'test.fails("#999: a sibling checkout", () => {});\n',
      "tests/c.test.ts": 'test.fails("#999: nothing collects this", () => {});\n',
    });

    expect(result.stderr).not.toContain("still named by");
    expect(result.status, result.stderr).toBe(0);
    expect(ghCalls).toContainEqual(["issue", "close"]);
  });
});
