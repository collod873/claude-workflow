import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { METERS } from "./meter-reviewer.ts";
import { NO_EM_DASH } from "./reviewer.ts";
import { reviewing } from "./scenarios.ts";

const WORKFLOW = join(import.meta.dirname, "..", ".github", "workflows", "check.yml");
const TANGLE = "src/tangle.ts joins billing and shipping, which change for different reasons";
const keyOf = (name: string) => name.replaceAll(" ", "_");
const answer = (found: Record<string, string[]> = {}) => Object.fromEntries(METERS.map(({ name }) => [keyOf(name), found[name] ?? []]));
const metering = (options: Parameters<typeof reviewing>[0] = {}) => reviewing({ bin: "meters", verdict: answer(), ...options });

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
    const { run, edited } = metering({ prBody: "Builds #810\n\ncramming (meter): would refuse nothing\n", verdict: answer({ cramming: [odd] }) });

    expect(run().status).toBe(0);
    expect(edited()[0]).toContain(`cramming (meter): would refuse, ${odd}`);
  });

  it("ends red when the PR body cannot be read or edited, or the model leaves a meter unanswered", () => {
    expect(metering({ prBodyUnreadable: true }).run().status).toBe(1);
    expect(metering({ prEditFails: true }).run().status).toBe(1);

    const unanswered = metering({ verdict: { depth: [] } });
    expect(unanswered.run().status).toBe(1);
    expect(unanswered.edited()).toEqual([]);
  });

  it("prints its lines and edits nothing with --print, so a merged PR can be read back", () => {
    const { run, edited } = metering({ verdict: answer({ "hollow test": ["the test for the cap passes with the cap removed"] }) });

    const printed = run("9810", {}, ["--print"]);
    expect(printed.status).toBe(0);
    expect(printed.stdout.trim().split("\n")).toHaveLength(METERS.length);
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

  it("asks for crammed criteria, behaviour nobody asked for, tests that pass on broken code, and the owner's limits the build drops", () => {
    const { prompt } = asked();

    expect(prompt).toMatch(/`cramming`: [^\n]*more than one behaviour/);
    expect(prompt).toMatch(/`beyond_the_ask`: [^\n]*neither the Why nor the criteria ask for/);
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

describe("check.yml runs the meters beside the review, and a red meter run never fails the Check run, so no fixer starts on it", () => {
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
