import { copyFileSync, cpSync, readdirSync, readFileSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { BIN, execute, heard, plant, scratch, script, type WorkflowStep } from "./scenarios.ts";

const WORKFLOWS = join(BIN, "..", ".github", "workflows");

const spelled = (...args: string[]) => execute(join(BIN, "spelled"), scratch("spelled-"), {}, args);
const rows = () => heard(spelled("labels")).lines.map((line) => line.split("\t"));

describe("bin/spelled prints the machine's labels from one typed set, so no script types its own list (#1100)", () => {
  it("prints every machine label once as name, kind, colour and description, tab separated", () => {
    const printed = rows();

    expect(printed.map(([name, kind]) => `${name} ${kind}`)).toEqual([
      "ticket kind",
      "spec kind",
      "note kind",
      "research kind",
      "building state",
      "checking state",
      "queued state",
      "resolving state",
      "landing state",
      "slicing state",
      "researching state",
      "waiting parked",
      "asked owner",
      "needs-human owner",
      "try- try",
    ]);
    for (const row of printed) {
      expect(row, row.join(" ")).toHaveLength(4);
      expect(row[2], row.join(" ")).toMatch(/^[0-9a-f]{6}$/);
      expect(row[3], row.join(" ")).not.toBe("");
    }
  });

  it("refuses anything but labels, naming its usage", () => {
    for (const args of [[], ["label"], ["labels", "--all"]]) {
      expect(spelled(...args), args.join(" ")).toEqual({ status: 2, stdout: "", stderr: "spelled: usage: spelled labels\n" });
    }
  });

  it("leaves bin/mark spelling no label name, colour or description of its own", () => {
    const mark = readFileSync(join(BIN, "mark"), "utf8");

    for (const [name, , colour, description] of rows()) {
      for (const spelling of [name, colour, description]) expect(mark, spelling).not.toMatch(new RegExp(`(?<![\\w-])${(spelling ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w/-])`));
    }
  });

  it("stops bin/mark before it asks GitHub anything when the labels cannot be read", () => {
    const root = scratch("mark-unspelled-");
    script(join(root, "bin", "spelled"), "printf 'node: not found\\n' >&2\nexit 127\n");
    copyFileSync(join(BIN, "mark"), join(root, "bin", "mark"));
    script(join(root, "bin", "gh"), `printf '%s\\n' "$*" >>"${join(root, "gh-calls")}"\n`);

    expect(execute(join(root, "bin", "mark"), root, { PATH: `${join(root, "bin")}:${process.env.PATH}` }, ["811", "building"])).toEqual({
      status: 1,
      stdout: "",
      stderr: "mark: the labels could not be read: node: not found\n",
    });
    expect(readdirSync(root)).not.toContain("gh-calls");
  });

  it("sets up Node 24 in every job that runs bin/mark, since bin/mark reads its labels through node", () => {
    for (const file of readdirSync(WORKFLOWS)) {
      const { jobs } = parse(readFileSync(join(WORKFLOWS, file), "utf8")) as { jobs: Record<string, { steps: WorkflowStep[] }> };
      for (const [name, { steps }] of Object.entries(jobs)) {
        const marking = steps.findIndex((step) => /(^|\s)bin\/mark\b/.test(step.run ?? "") || step.uses === "./.github/actions/call-owner");
        const node = steps.findIndex((step) => step.uses?.startsWith("actions/setup-node@") === true && step.with?.["node-version"] === 24);
        if (marking >= 0) expect(node, `${file} ${name}`).toBeGreaterThanOrEqual(0);
        if (marking >= 0) expect(node, `${file} ${name}`).toBeLessThan(marking);
      }
    }
  });

  it("lets the stages mark, hold and file only labels the set holds, so a name typed outside it fails typecheck (#1100)", () => {
    const copy = scratch("spelled-typed-");
    for (const kept of ["src", "tsconfig.json", "package.json", "vitest.config.ts"]) cpSync(join(BIN, "..", kept), join(copy, kept), { recursive: true });
    symlinkSync(join(BIN, "..", "node_modules"), join(copy, "node_modules"));
    plant(
      copy,
      "src/misspelled.ts",
      [
        'import { gh, heldOf, labelsOf, mark, NEEDS_HUMAN, post, type MarkedLabel } from "./post.ts";',
        'const held: MarkedLabel = "needs-humans";',
        'mark("811", "fixing");',
        "mark(\"811\", NEEDS_HUMAN, held);",
        'post({ kind: "ticket", title: "t", text: "", labels: ["waitin"] }, gh);',
        'const read = labelsOf("811", gh);',
        'if (read !== "unread" && read.has("resolve")) mark("811", "building");',
        'heldOf([{ name: "spec" }]).has("specs");',
        "",
      ].join("\n"),
    );

    const { stdout } = execute(join(BIN, "..", "node_modules", ".bin", "tsc"), copy, {}, ["--noEmit", "--pretty", "false", "-p", "tsconfig.json"]);

    expect(stdout.split("\n").filter((line) => line.startsWith("src/")).map((line) => /^src\/misspelled\.ts\((\d+),/.exec(line)?.[1])).toEqual(["2", "3", "4", "5", "7", "8"]);
  });
});
