import { describe, expect, it } from "vitest";
import { totalOutside } from "./reads-outside-brief.ts";
import { SAVED_PR, git, heard, saving } from "./scenarios.ts";

function savedWithAutoMerge<Saved extends ReturnType<typeof saving>>(saved: Saved, opening: RegExp[]): Saved {
  expect(heard(saved.run())).toEqual({ status: 0, stderr: "", lines: [expect.stringContaining(SAVED_PR)] });
  expect(saved.pushed()).toBe(saved.built);
  expect(saved.calls()).toEqual([
    [expect.stringMatching(/^issue view 726\b/), saved.built],
    ...opening.map((call) => [expect.stringMatching(call), saved.built]),
    [expect.stringMatching(/^pr merge ticket\/726 --auto .*--match-head-commit [0-9a-f]{40}$/), saved.built],
  ]);
  return saved;
}

describe("the save step pushes the branch before anything can refuse it, and opens the PR red or green (#726)", () => {
  it("pushes the build as it stands past a gate that refuses it and a main that moved on, then opens the PR with auto-merge on", () => {
    const { session, built, judged } = savedWithAutoMerge(saving(), [/^pr create .*--base main --head ticket\/726\b/]);

    expect(git(session, "rev-parse", "HEAD")).toBe(built);
    expect(judged()).toBe(false);
  });

  it("keeps the PR already open for the branch, with auto-merge on at the new head", () => {
    savedWithAutoMerge(saving({ alreadyOpen: true }), [/^pr create .*--head ticket\/726\b/, /^pr view ticket\/726\b/]);
  });

  it("says one line naming the branch it kept, and opens nothing, when the push fails", () => {
    const { run, pushed, calls } = saving({ remoteRefuses: "the remote refuses every push" });

    const result = run();

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr.trimEnd().split("\n")).toEqual([expect.stringContaining("ticket/726")]);
    expect(result.stderr).toMatch(/kept/);
    expect(pushed()).toBe("");
    expect(calls()).toEqual([]);
  });
});

describe("bin/save's red exits name the stop the fixer reads (#835)", () => {
  it("a push is refused leaves a save log whose first line names the push is refused row", () => {
    const { run, log } = saving({ remoteRefuses: "the remote refuses every push" });

    const result = run();

    expect(result.status).toBe(1);
    expect(log().split("\n")[0]).toBe("1 refusals, stopped at: Save: the push is refused");
  });

  it("a PR that is not open with auto-merge on leaves a save log whose first line names that row", () => {
    const { run, log } = saving({ autoMergeRefused: true });

    const result = run();

    expect(result.status).toBe(1);
    expect(log().split("\n")[0]).toBe("1 refusals, stopped at: Save: the PR is not open with auto-merge on");
  });
});

describe("bin/save meters what each stage read outside its brief, from the stage's own stream (#809)", () => {
  it("reads outside the brief are counted and named per stage, from the stage's stream", () => {
    const { run, prBody } = saving({
      brief: ["# Brief for ticket 726", "", "## Claimed files", "", "### src/ticket-shape.ts", "", "1  export const shaped = 2;", ""].join("\n"),
      streams: {
        "test-author": ["src/ticket-shape.ts", "src/post.ts"],
        build: ["src/ticket-shape.ts"],
      },
    });

    const result = run();

    expect(result.status).toBe(0);
    const body = prBody();
    expect(body).toContain("Builds #726");
    expect(body).toMatch(/test-author read 1\b[^\n]*outside its brief/);
    expect(body).toContain("src/post.ts");
    expect(body).toMatch(/build read 0\b[^\n]*outside its brief/);
    expect(body).not.toContain("ticket-shape");
  });
});

describe("bin/save hands reads outside the brief back to the filer when there are enough to matter (#904)", () => {
  const brief = ["# Brief for ticket 726", "", "## Claimed files", "", "### src/ticket-shape.ts", "", "1  export const shaped = 2;", ""].join("\n");

  it("posts a 'reads back to the filer' line on the PR and the ticket when 5 or more distinct files outside the brief were read", () => {
    const { run, prBody, ticketComments } = saving({
      brief,
      streams: {
        "test-author": ["src/a.ts", "src/b.ts", "src/c.ts"],
        build: ["src/c.ts", "src/d.ts", "src/e.ts"],
      },
    });

    const result = run();

    expect(result.status).toBe(0);
    const body = prBody() ?? "";
    const line = body.split("\n").find((row) => row.startsWith("reads back to the filer (meter):"));
    expect(line).toMatch(/^reads back to the filer \(meter\): 5\b/);
    for (const file of ["src/a.ts", "src/b.ts", "src/c.ts", "src/d.ts", "src/e.ts"]) expect(line).toContain(file);
    expect(ticketComments()).toEqual([line]);
    expect(totalOutside(body)).toBe(6);
  });

  it("hands nothing back when 4 or fewer distinct files outside the brief were read, and posts no comment on the ticket", () => {
    const { run, prBody, ticketComments } = saving({
      brief,
      streams: {
        "test-author": ["src/a.ts", "src/b.ts"],
        build: ["src/b.ts", "src/c.ts"],
      },
    });

    const result = run();

    expect(result.status).toBe(0);
    const body = prBody() ?? "";
    expect(body).toContain("reads back to the filer (meter): nothing to hand back");
    expect(ticketComments()).toEqual([]);
    expect(totalOutside(body)).toBe(4);
  });
});

describe("bin/save's consent-only quote (meter) reads the ticket's last > passage under Why (#906)", () => {
  it("puts a consent-only quote (meter) line on the PR, quoting the passage and its word count, when the ticket's last > passage under Why is 5 words or fewer", () => {
    const { run, prBody } = saving({
      why: [
        "The owner proposed a plan and later confirmed it:",
        "",
        "> The assistant proposed building a consent-only quote meter that flags short trailing quotes as likely consent",
        "> rather than intent, spanning this single passage across two consecutive quoted lines held together",
        "",
        "> ok do those",
      ].join("\n"),
    });

    expect(run().status).toBe(0);
    const line = (prBody() ?? "").split("\n").find((row) => row.startsWith("consent-only quote (meter): would refuse,"));
    expect(line).toBeDefined();
    expect(line).toContain("ok do those");
    expect(line).toMatch(/\b3\b/);
    expect(line).toMatch(/\bwords?\b/);
  });

  it("says the quote carries intent, would refuse nothing, when the last > passage is over 5 words, or Why has no > passage at all", () => {
    const long = saving({
      why: ["The owner, in session:", "", "> Let's ship the whole consent meter feature by the end of this week please"].join("\n"),
    });

    expect(long.run().status).toBe(0);
    expect(long.prBody() ?? "").toContain("consent-only quote (meter): would refuse nothing");

    const none = saving({
      why: 'The owner, in session: "this quotes only inline, never a > line, so Why carries no passage at all".',
    });

    expect(none.run().status).toBe(0);
    expect(none.prBody() ?? "").toContain("consent-only quote (meter): would refuse nothing");
  });
});

const SHAPE_ONLY_FIXTURE = [
  'import { describe, expect, it } from "vitest";',
  'import { parse } from "yaml";',
  "",
  'describe("a fixture criterion for #908", () => {',
  '  it("only parses a shape, never touching the shipped code", () => {',
  '    expect(parse("a: 1\\n")).toEqual({ a: 1 });',
  "  });",
  "});",
  "",
].join("\n");

const SHIPPED_VIA_HELPER_FIXTURE = [
  'import { describe, expect, it } from "vitest";',
  'import { checkRepo, heard } from "./scenarios.ts";',
  "",
  'describe("a fixture criterion for #908", () => {',
  '  it("exercises shipped code through a scenarios.ts helper", () => {',
  "    const { run } = checkRepo();",
  "    expect(heard(run()).status).toBe(0);",
  "  });",
  "});",
  "",
].join("\n");

const SHIPPED_VIA_BIN_SPAWN_FIXTURE = [
  'import { describe, it } from "vitest";',
  'import { spawnSync } from "node:child_process";',
  'import { join } from "node:path";',
  "",
  'const BIN = join(import.meta.dirname, "..", "bin");',
  "",
  'describe("a fixture criterion for #908", () => {',
  '  it("spawns a shipped bin script directly", () => {',
  '    spawnSync(join(BIN, "mark"), ["908"]);',
  "  });",
  "});",
  "",
].join("\n");

describe("bin/save flags a shape-only check (meter) whose criteria only test shape, never the shipped code (#908)", () => {
  it("names each flagged criterion by number and check, and still exits 0 and opens the PR", () => {
    const { run, prBody } = saving({
      criteria: [
        "- [ ] a file appears - check: `test -f built.txt`",
        '- [ ] nothing matches - check: `npx vitest run --config vitest.config.ts totally-missing-file -t "does not matter"`',
        '- [ ] shape only - check: `npx vitest run --config vitest.config.ts shape-fixture-shape-only -t "only parses a shape"`',
      ],
      files: { "src/shape-fixture-shape-only.test.ts": SHAPE_ONLY_FIXTURE },
    });

    expect(run().status).toBe(0);
    const flagged = (prBody() ?? "").split("\n").find((row) => row.startsWith("shape-only check (meter): would refuse,"));
    expect(flagged).toBeDefined();
    expect(flagged).toContain("criterion 1");
    expect(flagged).toContain("test -f built.txt");
    expect(flagged).toContain("criterion 2");
    expect(flagged).toContain("totally-missing-file");
    expect(flagged).toContain("criterion 3");
    expect(flagged).toContain("shape-fixture-shape-only");
  });
});

describe("bin/save's shape-only check (meter) would refuse nothing once every criterion's check runs the shipped code (#908)", () => {
  it("puts 'shape-only check (meter): would refuse nothing' on the PR when every check selects a test that runs the shipped code, including through a scenarios.ts helper that calls execute()", () => {
    const { run, prBody } = saving({
      criteria: [
        '- [ ] a fix lands - check: `npx vitest run --config vitest.config.ts shape-fixture-shipped -t "exercises shipped code"`',
        '- [ ] a script runs - check: `npx vitest run --config vitest.config.ts shape-fixture-bin-spawn -t "spawns a shipped bin script directly"`',
      ],
      files: {
        "src/shape-fixture-shipped.test.ts": SHIPPED_VIA_HELPER_FIXTURE,
        "src/shape-fixture-bin-spawn.test.ts": SHIPPED_VIA_BIN_SPAWN_FIXTURE,
      },
    });

    const result = run();

    expect(result.status).toBe(0);
    expect(prBody() ?? "").toContain("shape-only check (meter): would refuse nothing");
  });
});
