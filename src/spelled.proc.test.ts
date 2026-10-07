import { copyFileSync, cpSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import ts from "typescript";
import { parse } from "yaml";
import { BIN, execute, heard, plant, scratch, script, type WorkflowStep } from "./scenarios.ts";

const WORKFLOWS = join(BIN, "..", ".github", "workflows");

const ACTIONS = join(BIN, "..", ".github", "actions");
const ISSUE = String.raw`(?:\$\{\{[^}]*\}\}|"\$\w+"|\d+)`;
const SPELLINGS = [
  /labels\.\*\.name\s*,\s*'([^']*)'/g,
  /github\.event\.label\.name\s*==\s*'([^']*)'/g,
  new RegExp(String.raw`bin/mark\s+${ISSUE}\s+([a-z][\w-]*)`, "g"),
  /grep -qx\s+([\w-]+)/g,
  /--(?:add|remove)-label\s+([\w-]+)/g,
];
const spelledIn = (text: string) => SPELLINGS.flatMap((spelling) => [...text.matchAll(spelling)].map(([, name]) => name ?? ""));
const workflowFiles = () => [...readdirSync(WORKFLOWS).map((file) => join(WORKFLOWS, file)), ...readdirSync(ACTIONS).map((action) => join(ACTIONS, action, "action.yml"))];

const spelled = (...args: string[]) => execute(join(BIN, "spelled"), scratch("spelled-"), {}, args);
const KEYS = [
  ["TICKET", "ticket"],
  ["SPEC", "spec"],
  ["NOTE", "note"],
  ["RESEARCH", "research"],
  ["BUILDING", "building"],
  ["CHECKING", "checking"],
  ["QUEUED", "queued"],
  ["RESOLVING", "resolving"],
  ["LANDING", "landing"],
  ["SLICING", "slicing"],
  ["RESEARCHING", "researching"],
  ["WAITING", "waiting"],
  ["ASKED", "asked"],
  ["PAUSED", "paused"],
  ["STUCK", "stuck"],
] as const;
const SPELLED = [...KEYS, ["TICKET_PREFIX", "ticket/"], ["OWNER", "collod873"], ["MACHINE", "collod873-machine[bot]"], ["OWNER_CALL", "owner call"]] as const;
const USAGE = `spelled: usage: spelled labels | spelled <${SPELLED.map(([key]) => key).join("|")}>\n`;
const NAMING = ["post.ts", "slicer.ts", "done-checker.ts", "researcher.ts", "closer.ts", "wave.ts", "builder.ts"].map((file) => join(BIN, "..", "src", file));

function rawLabels(files: string[], names: string[]): string[] {
  const program = ts.createProgram(files, { strict: true, noEmit: true, allowImportingTsExtensions: true, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext, target: ts.ScriptTarget.ESNext });
  const checker = program.getTypeChecker();
  const found: string[] = [];
  for (const file of files) {
    const source = program.getSourceFile(file);
    if (source === undefined) throw new Error(`${file} did not load`);
    const visit = (node: ts.Node) => {
      if (ts.isStringLiteral(node) && names.includes(node.text)) {
        const wanted = checker.getContextualType(node);
        const members = wanted === undefined ? [] : wanted.isUnion() ? wanted.types : [wanted];
        if (members.some((member) => member.isStringLiteral() && names.includes(member.value))) found.push(`${file.split("/").at(-1) ?? ""}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1} "${node.text}"`);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return found;
}
const REPO = join(BIN, "..");
const machine = (dir: string): string[] =>
  readdirSync(join(REPO, dir), { withFileTypes: true, recursive: true })
    .filter((found) => found.isFile())
    .map((found) => join(found.parentPath, found.name))
    .filter((file) => !/\.(test|part)\.ts$|\/scenarios\.ts$/.test(file));
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
      "paused held",
      "stuck held",
      "try- try",
    ]);
    for (const row of printed) {
      expect(row, row.join(" ")).toHaveLength(4);
      expect(row[2], row.join(" ")).toMatch(/^[0-9a-f]{6}$/);
      expect(row[3], row.join(" ")).not.toBe("");
    }
  });

  it("prints the one label a key names, each key named by its TypeScript constant (#1108)", () => {
    for (const [key, name] of KEYS) expect(spelled(key), key).toEqual({ status: 0, stdout: `${name}\n`, stderr: "" });
  });

  it("exports each label the GitHub part and the stages name, and the ticket branch prefix, as the constant spelled prints it under, and nothing else beside the set (#1118, #1121)", async () => {
    const spelledModule: Record<string, unknown> = await import("./spelled.ts");
    const labelled = Object.entries(spelledModule).filter(([, value]) => typeof value === "string");

    expect(labelled).toEqual(SPELLED.map(([key, name]) => [key, name]));
  });

  it("leaves the GitHub part, the slicer, the done check, the researcher, the closer, the wave reader and the builder no raw string or second constant for a label (#1118)", () => {
    const names = rows().map(([name]) => name ?? "");
    const planted = scratch("spelled-raw-");
    plant(
      planted,
      "src/raw.ts",
      [
        `import { mark, type Held, type MarkedLabel } from "${join(BIN, "..", "src", "post.ts")}";`,
        'const LANDING = "landing" as const satisfies MarkedLabel;',
        'export const raw = (held: Held) => { mark("1", "building"); return held.has("spec") ? LANDING : "a building"; };',
        "",
      ].join("\n"),
    );

    expect(rawLabels([join(planted, "src", "raw.ts")], names)).toEqual(['raw.ts:2 "landing"', 'raw.ts:3 "building"', 'raw.ts:3 "spec"']);
    expect(rawLabels(NAMING, names)).toEqual([]);
  });

  it("prints the ticket branch prefix under TICKET_PREFIX, the one place outside the tests that spells it (#1121)", () => {
    const spelling = /ticket\\?\//;

    expect(spelled("TICKET_PREFIX")).toEqual({ status: 0, stdout: "ticket/\n", stderr: "" });
    expect(
      ["src", "bin", ".github"].flatMap(machine).flatMap((file) =>
        readFileSync(file, "utf8")
          .split("\n")
          .flatMap((line, at) => (spelling.test(line) && !line.startsWith("export const TICKET_PREFIX = ") ? [`${file.slice(REPO.length + 1)}:${at + 1}`] : [])),
      ),
    ).toEqual([]);
  });

  it("prints the owner's login under OWNER and the bot's login under MACHINE, the bot's spelled nowhere else the machine runs but the sender test of tickets.yml (#1123, #1135, #1220)", () => {

    expect(spelled("OWNER")).toEqual({ status: 0, stdout: "collod873\n", stderr: "" });
    expect(spelled("MACHINE")).toEqual({ status: 0, stdout: "collod873-machine[bot]\n", stderr: "" });
    expect(
      ["src", "bin", ".github"].flatMap(machine).flatMap((file) =>
        readFileSync(file, "utf8")
          .split("\n")
          .flatMap((line, at) => (line.includes("collod873-machine") && !line.startsWith("export const MACHINE = ") ? [`${file.slice(REPO.length + 1)}:${at + 1}`] : [])),
      ),
    ).toEqual([".github/workflows/tickets.yml:10"]);
    expect(readFileSync(join(ACTIONS, "stage-logs", "action.yml"), "utf8")).toMatch(/bin\/spelled MACHINE/);
  });

  it("refuses anything but labels or a key it holds, naming its usage", () => {
    for (const args of [[], ["label"], ["labels", "--all"], ["SPECS"], ["spec"], ["SPEC", "NOTE"], ["toString"]]) {
      expect(spelled(...args), args.join(" ")).toEqual({ status: 2, stdout: "", stderr: USAGE });
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
      const { jobs } = parse(readFileSync(join(WORKFLOWS, file), "utf8")) as { jobs: Record<string, { steps?: WorkflowStep[] }> };
      for (const [name, { steps = [] }] of Object.entries(jobs)) {
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
        'import { askedIssue, gh, heldOf, labelsHeld, mark, post, type MarkedLabel } from "./post.ts"; import { PAUSED, STUCK } from "./spelled.ts";',
        'const held: MarkedLabel = "stucks";',
        'mark("811", "fixing");',
        "mark(\"811\", STUCK, held);",
        "mark(\"811\", PAUSED);",
        'post({ kind: "ticket", title: "t", text: "", labels: ["waitin"] }, gh);',
        'const read = labelsHeld("811", gh);',
        'if (read.has("resolve")) mark("811", "building");',
        'heldOf([{ name: "spec" }]).has("specs");',
        'askedIssue("{}")?.labels.some(({ name }) => name === "stuk");',
        'askedIssue("{}")?.labels.has("researh");',
        "",
      ].join("\n"),
    );

    const { stdout } = execute(join(BIN, "..", "node_modules", ".bin", "tsc"), copy, {}, ["--noEmit", "--pretty", "false", "-p", "tsconfig.json"]);

    expect([...new Set(stdout.split("\n").filter((line) => line.startsWith("src/")).map((line) => /^src\/misspelled\.ts\((\d+),/.exec(line)?.[1]))]).toEqual(["2", "3", "4", "5", "6", "8", "9", "10", "11"]);
  });

  it("finds every label a workflow file spells, and finds none, since each asks spelled by key (#1104, #1108)", () => {
    const held = rows().map(([name]) => name);
    const planted = [
      "if: contains(github.event.issue.labels.*.name, 'specs')",
      "if: github.event.label.name == 'waitng'",
      "bin/mark ${{ github.event.issue.number }} bulding || true # quiet: bin/mark names its own refusal",
      'bin/mark "$ISSUE" stucks',
      "grep -qx pausd",
      "gh issue edit 1 --add-label asking",
    ].join("\n");

    expect(spelledIn(planted).filter((name) => !held.includes(name))).toEqual(["specs", "waitng", "bulding", "stucks", "pausd", "asking"]);
    for (const file of workflowFiles()) expect(spelledIn(readFileSync(file, "utf8")), file).toEqual([]);
  });

  it("fails typecheck when a label constant is set to another label the set holds (#1103)", () => {
    const copy = scratch("spelled-swapped-");
    for (const kept of ["src", "tsconfig.json", "package.json", "vitest.config.ts"]) cpSync(join(BIN, "..", kept), join(copy, kept), { recursive: true });
    symlinkSync(join(BIN, "..", "node_modules"), join(copy, "node_modules"));
    const spelledAt = join(copy, "src", "spelled.ts");
    const kept = readFileSync(spelledAt, "utf8");
    const swapped = kept.replace(/(export const STUCK\b[^=]*= )"stuck"/, '$1"waiting"');
    expect(swapped).not.toBe(kept);
    writeFileSync(spelledAt, swapped);

    const { stdout } = execute(join(BIN, "..", "node_modules", ".bin", "tsc"), copy, {}, ["--noEmit", "--pretty", "false", "-p", "tsconfig.json"]);

    expect(stdout.split("\n").filter((line) => line.startsWith("src/")).map((line) => /^src\/([\w.]+)\(/.exec(line)?.[1])).toEqual(["post.test.ts"]);
  });
});
