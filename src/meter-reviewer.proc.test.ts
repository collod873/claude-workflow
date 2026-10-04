import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { METERS } from "./meter-reviewer.ts";
import { NO_EM_DASH } from "./reviewer.ts";
import { metering } from "./meter-reviewer.part.ts";
import { fileDiff } from "./reviewer.part.ts";

const WORKFLOW = join(import.meta.dirname, "..", ".github", "workflows", "check.yml");
const TANGLE = "src/tangle.ts joins billing and shipping, which change for different reasons";
const keyOf = (name: string) => name.replaceAll(" ", "_");
const answer = (found: Record<string, string[]> = {}) => Object.fromEntries(METERS.map(({ name }) => [keyOf(name), found[name] ?? []]));

function edit(run: ReturnType<typeof metering>): string {
  const [body] = run.edited();
  if (body === undefined) throw new Error("no pr edit call");
  return body;
}

interface Schema {
  required: string[];
  properties: Record<string, { type: string; minItems?: number; items?: { type: string; pattern: string } }>;
}

function asked(): { prompt: string; schema: Schema } {
  const { run, hired, handed } = metering();
  expect(run().status).toBe(0);
  const argv = hired();
  const schemaText = argv[argv.indexOf("--json-schema") + 1];
  if (schemaText === undefined) throw new Error("no --json-schema in the meter reviewer's argv");
  return { prompt: handed(), schema: JSON.parse(schemaText) as Schema };
}

describe("bin/meters puts one line per meter on a ticket PR's body, beside the reviewer (#920)", () => {
  it("puts one line per meter on the PR body, and replaces an earlier line rather than adding a second, keeping the rest of the body", () => {
    const found = metering({ verdict: answer({ depth: [TANGLE] }) });
    expect(found.run().status).toBe(0);
    expect(edit(found)).toContain(`depth (meter): would refuse, ${TANGLE}`);
    for (const { name } of METERS.filter(({ name }) => name !== "depth")) expect(edit(found)).toContain(`${name} (meter): would refuse nothing`);

    const already = metering({
      prBody: "Builds #810\n\nconsent-only quote (meter): would refuse nothing\ndepth (meter): would refuse, an earlier finding\n",
      verdict: answer({ depth: [TANGLE] }),
    });
    expect(already.run().status).toBe(0);
    const replaced = edit(already);
    expect(replaced.match(/^depth \(meter\):/gm)).toHaveLength(1);
    expect(replaced).toContain(TANGLE);
    expect(replaced).not.toContain("an earlier finding");
    expect(replaced).toContain("Builds #810");
    expect(replaced).toContain("consent-only quote (meter): would refuse nothing");
  });

  it("keeps a finding byte for byte, even one that reads like a replacement pattern", () => {
    const odd = "src/cost.ts prints $& and $1 where a price belongs";
    const { run, edited } = metering({ prBody: "Builds #810\n\ndepth (meter): would refuse nothing\n", verdict: answer({ depth: [odd] }) });

    expect(run().status).toBe(0);
    expect(edited()[0]).toContain(`depth (meter): would refuse, ${odd}`);
  });

  it("ends red when the PR body cannot be read or edited, or the model leaves a meter unanswered", () => {
    expect(metering({ prBodyUnreadable: true }).run().status).toBe(1);
    expect(metering({ prEditFails: true }).run().status).toBe(1);

    const unanswered = metering({ verdict: { depth: [] } });
    expect(unanswered.run().status).toBe(1);
    expect(unanswered.edited().join("\n")).not.toMatch(new RegExp(METERS.map(({ name }) => `${name} \\(meter\\)`).join("|")));
  });

  it("prints its lines and edits nothing with --print, so a merged PR can be read back", () => {
    const { run, edited } = metering({ verdict: answer({ "hollow test": ["the test for the cap passes with the cap removed"] }) });

    const printed = run("9810", {}, ["--print"]);
    expect(printed.status).toBe(0);
    expect(printed.stdout.trim().split("\n")).toHaveLength(METERS.length + 1);
    expect(printed.stdout).toContain("hollow test (meter): would refuse, the test for the cap passes with the cap removed");
    expect(edited()).toEqual([]);
  });

  it("hires no model on a PR that is not a ticket's, and --help reads no PR", () => {
    const untracked = metering({ branch: "land/session" });
    expect(untracked.run().status).toBe(0);
    expect(untracked.spent()).toBe(false);

    const help = metering();
    const said = help.run("--help");
    expect(said.status).toBe(0);
    expect(said.stdout).toContain("meters: usage: meters [--print] <pr number>");
    expect(help.read()).toBe(false);
  });

  it("leaves its transcript in the machine logs", () => {
    const { root, run } = metering();

    expect(run().status).toBe(0);
    expect(readFileSync(join(root, ".git", "machine-logs", "meters-9810.jsonl"), "utf8")).toContain('"structured_output"');
  });
});

describe("bin/meters puts a discard (meter) line on the PR body, read by code from the diff, for each added gh, git or bin/mark call whose error is thrown away (#1080)", () => {
  const discardLine = (diff: string) => {
    const found = metering({ diff });
    expect(found.run().status).toBe(0);
    return edit(found).split("\n").find((line) => line.startsWith("discard (meter):"));
  };

  it("names the file and line of a gh call that sends its stderr to /dev/null, and refuses nothing when the gh call keeps its stderr", () => {
    const thrown = `${fileDiff("bin/close", 'gh pr view "$pr" --json body 2>/dev/null')}`.replace("@@ -0,0 +1 @@\n", "@@ -10,2 +10,3 @@\n set -u\n-old\n+kept\n");
    expect(discardLine(thrown)).toBe("discard (meter): would refuse, bin/close:12 sends a gh call's stderr to /dev/null");
    expect(discardLine(fileDiff("bin/close", 'gh pr view "$pr" --json body'))).toBe("discard (meter): would refuse nothing");
  });

  it("names a git call ending in || true and a gh spawn with stderr ignore, and quotes the why a quiet: comment gives", () => {
    const diff = [
      fileDiff("bin/land", "git fetch origin main || true"),
      fileDiff("src/close.ts", "spawnSync(\"gh\", [\"label\", \"create\", name], { stdio: [\"ignore\", \"pipe\", \"ignore\"] });"),
      fileDiff("bin/mark", "gh label create landing 2>/dev/null # quiet: the label already exists on every repo after the first run"),
      fileDiff("src/count.ts", "const total = lines.length || true;"),
    ].join("");

    expect(discardLine(diff)).toBe(
      [
        "discard (meter): would refuse, bin/land:1 puts || true on a git call",
        "src/close.ts:1 spawns a gh call with its stderr ignored",
        'bin/mark:1 sends a gh call\'s stderr to /dev/null, quiet: "the label already exists on every repo after the first run"',
      ].join("; "),
    );
  });

  it("reads a call wrapped over several added lines, a shell call continued with a backslash and a spawn whose stdio sits on its own line, and a single-quoted stdio", () => {
    const wrapped = [
      'gh pr view "$pr" \\',
      "  --json body \\",
      "  --jq .body 2>/dev/null",
      "const listed = spawnSync(",
      '  "git",',
      '  ["ls-files"],',
      '  { stdio: ["ignore", "pipe", "ignore"] },',
      ");",
      "spawnSync('gh', ['auth', 'status'], { stdio: 'ignore' });",
      'gh pr view "$pr"',
      "count=$((count + 1)) || true",
    ].join("\n+");

    expect(discardLine(fileDiff("bin/close", wrapped).replace("@@ -0,0 +1 @@", "@@ -0,0 +1,11 @@"))).toBe(
      [
        "discard (meter): would refuse, bin/close:1 sends a gh call's stderr to /dev/null",
        "bin/close:4 spawns a git call with its stderr ignored",
        "bin/close:9 spawns a gh call with its stderr ignored",
      ].join("; "),
    );
  });

  it("does not join added lines across a bracket inside a string or a comment, so each discard is named on its own line (#1088)", () => {
    const stray = [
      'echo "usage: close (pr"',
      "gh pr view 1 2>/dev/null",
      "# pick the label [first",
      "git fetch origin || true",
      'const open = "(";',
      "spawnSync('gh', ['auth'], { stdio: 'ignore' }); // close ]",
      "bin/mark 9 building || true",
    ].join("\n+");

    expect(discardLine(fileDiff("bin/close", stray).replace("@@ -0,0 +1 @@", "@@ -0,0 +1,7 @@"))).toBe(
      [
        "discard (meter): would refuse, bin/close:2 sends a gh call's stderr to /dev/null",
        "bin/close:4 puts || true on a git call",
        "bin/close:6 spawns a gh call with its stderr ignored",
        "bin/close:7 puts || true on a bin/mark call",
      ].join("; "),
    );
  });

  it("still puts the discard line on the PR body when the model leaves a meter unanswered, and the run stays red", () => {
    const unanswered = metering({ diff: fileDiff("bin/mark", "gh label create landing || true"), verdict: { depth: [] } });

    expect(unanswered.run().status).toBe(1);
    const body = edit(unanswered);
    expect(body).toContain("discard (meter): would refuse, bin/mark:1 puts || true on a gh call");
    expect(body).not.toContain("depth (meter)");
  });

  it("prints the discard line beside the model's lines with --print, for a refusing diff and a clean one, and edits nothing", () => {
    const refusing = metering({ diff: fileDiff("bin/mark", "gh label create landing 2>/dev/null") });
    const printed = refusing.run("9810", {}, ["--print"]);
    expect(printed.status).toBe(0);
    expect(printed.stdout).toContain("discard (meter): would refuse, bin/mark:1 sends a gh call's stderr to /dev/null");
    expect(printed.stdout).toContain("depth (meter): would refuse nothing");
    expect(refusing.edited()).toEqual([]);

    const clean = metering({ diff: fileDiff("bin/mark", "gh label create landing") });
    expect(clean.run("9810", {}, ["--print"]).stdout).toContain("discard (meter): would refuse nothing");
  });

  it("names a PR body it could not edit in its red stop when the model also failed, rather than dropping that error", () => {
    const both = metering({ diff: fileDiff("bin/mark", "gh label create landing || true"), verdict: { depth: [] }, prEditFails: true });

    const ran = both.run();
    expect(ran.status).toBe(1);
    expect(ran.stdout + ran.stderr).toMatch(/answered no done when[^\n]*discard line is not on it/);
  });

  it("puts the discard line on the PR body beside the model's meter lines, which stay as they were", () => {
    const found = metering({ diff: fileDiff("bin/mark", "bin/mark landing 2>/dev/null"), verdict: answer({ depth: [TANGLE] }) });
    const ran = found.run();
    expect(ran.status).toBe(0);
    expect(ran.stdout).toContain(`put ${METERS.length + 1} meter lines on its PR body, 2 would refuse`);
    const body = edit(found);
    expect(body).toContain("discard (meter): would refuse, bin/mark:1 sends a bin/mark call's stderr to /dev/null");
    expect(body).toContain(`depth (meter): would refuse, ${TANGLE}`);
    for (const { name } of METERS.filter(({ name }) => name !== "depth")) expect(body).toContain(`${name} (meter): would refuse nothing`);
  });
});

describe("the meter reviewer's schema and prompt ask for each meter as a list that may be empty (#920, #894)", () => {
  it("requires every meter as a list of findings with no em dash, and allows an empty list", () => {
    const { schema } = asked();

    for (const { name } of METERS) {
      expect(schema.required).toContain(keyOf(name));
      expect(schema.properties[keyOf(name)]?.type).toBe("array");
      expect(schema.properties[keyOf(name)]?.minItems).toBeUndefined();
      expect(schema.properties[keyOf(name)]?.items?.pattern).toBe(NO_EM_DASH);
    }
  });

  it("asks for Done when sentences the diff does not hold, behaviour nobody asked for, tests that pass on broken code, and the owner's limits the build drops, and no longer for crammed sentences (#1003)", () => {
    const { prompt } = asked();

    expect(prompt).toMatch(/`done_when`: [^\n]*each `## Done when` sentence the diff does not hold, quoting the sentence/);
    expect(prompt).not.toMatch(/cramming|more than one behaviour/);
    expect(prompt).toMatch(/`beyond_the_ask`: [^\n]*neither the Why nor `## Done when` asks for/);
    expect(prompt).toMatch(/`hollow_test`: [^\n]*would still pass if the behaviour it names were broken/);
    expect(prompt).toMatch(/`lost_limit`: [^\n]*owner's own words/);
    expect(prompt).toMatch(/rule on nothing else/);
  });

  it("asks for each shallow, pass-through or tangled module the diff adds or widens, and names entry points Actions call and one-line test fixture helpers as not findings", () => {
    const { prompt } = asked();

    expect(prompt).toContain("each module the diff adds or widens");
    expect(prompt).toContain("shallow");
    expect(prompt).toContain("pass-through");
    expect(prompt).toContain("joins behaviours that change for different reasons");
    expect(prompt).toContain("naming the module");
    expect(prompt).toMatch(/entry points[^.]*Actions[^.]*call/i);
    expect(prompt).toMatch(/one-line test fixture helpers?/i);
    expect(prompt).toMatch(/not findings/i);
  });

  it("asks about a hand-off spelled on both sides instead of owned by one module, naming both sides (#922)", () => {
    const { prompt } = asked();

    expect(prompt).toMatch(/another stage or workflow/i);
    expect(prompt).toMatch(/marker comment/i);
    expect(prompt).toMatch(/stop line/i);
    expect(prompt).toMatch(/commit subject/i);
    expect(prompt).toMatch(/PR body line/i);
    expect(prompt).toMatch(/naming both/i);
    expect(prompt).toMatch(/message owner/i);
    expect(prompt).toMatch(/one module'?s (?:own )?exports/i);
    expect(prompt).toMatch(/not a finding/i);
  });
});

interface Job {
  needs?: string;
  if?: string;
  "continue-on-error"?: boolean;
  steps: { run?: string; uses?: string; with?: Record<string, string> }[];
}

describe("check.yml runs the meters beside the review, and a red meter run never fails the Check run, so no builder starts on it", () => {
  it("runs main's bin/meters after the check, on a ticket branch only, as a job whose failure the run carries on past and whose logs never take the review's artifact name", () => {
    const { jobs } = parse(readFileSync(WORKFLOW, "utf8")) as { jobs: Record<string, Job> };
    const meters = jobs.meters;
    if (meters === undefined) throw new Error(`no meters job in ${WORKFLOW}`);

    expect(meters.if).toContain("startsWith(github.head_ref, 'ticket/')");
    expect(meters.if).toContain("github.event.pull_request.head.repo.full_name == github.repository");
    expect(meters["continue-on-error"]).toBe(true);
    expect(meters.steps.some((step) => (step.run ?? "").includes("$RUNNER_TEMP/main/bin/meters "))).toBe(true);
    const logs = meters.steps.find((step) => (step.uses ?? "").includes("stage-logs"));
    expect(logs?.with?.artifact).toBeDefined();
    expect(logs?.with?.artifact).not.toBe("machine-logs");
  });
});

describe("check.yml starts the review and the meters beside the check, not after it, on the ticket branches it already gates on (#970)", () => {
  it("starts the review and the meters beside the check", () => {
    const { jobs } = parse(readFileSync(WORKFLOW, "utf8")) as { jobs: Record<string, Job> };
    const review = jobs.review;
    const meters = jobs.meters;
    if (review === undefined || meters === undefined) throw new Error(`no review or meters job in ${WORKFLOW}`);

    expect(review.needs).not.toBe("check");
    expect(meters.needs).not.toBe("check");
    expect(review.if).toContain("startsWith(github.head_ref, 'ticket/')");
    expect(review.if).toContain("github.event.pull_request.head.repo.full_name == github.repository");
    expect(meters.if).toContain("startsWith(github.head_ref, 'ticket/')");
    expect(meters.if).toContain("github.event.pull_request.head.repo.full_name == github.repository");
  });
});

describe("bin/meters ends red at a GitHub read that fails (#1112)", () => {
  it.each([
    { read: "the diff", options: { unreadable: '*"pr diff"*' }, line: "#9810 ended red, its diff could not be read, so no model was spent" },
    { read: "the PR body", options: { prBodyUnreadable: true }, line: "the body of PR #9810 could not be read, so its meter lines are not on it" },
  ])("ends red at unread naming $read, putting nothing on the PR body", ({ read, options, line }) => {
    const { run, edited, spent } = metering(options);

    expect(run()).toMatchObject({ status: 1, stderr: `meters: ${line}\n` });
    expect(edited()).toEqual([]);
    expect(spent()).toBe(read === "the PR body");
  });
});
