import { cpSync, symlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { execute, plant, scratch, script } from "./scenarios.ts";

const REPO = resolve(import.meta.dirname, "..");
const FAILURE = "https://github.com/collod873/claude-workflow/issues/1031";
const LISTED = ["import { parts } from './src/parts.ts';", "import { stages } from './src/stages.ts';", "console.log(JSON.stringify({ parts: parts.map((part) => part.name), prompts: (await stages()).flatMap((stage) => stage.prompts ?? []).length }));"].join(" ");

function machineCopy(): string {
  const copy = scratch("stages-");
  for (const kept of ["src", "bin", "vitest.config.ts", "package.json", "tsconfig.json"]) cpSync(join(REPO, kept), join(copy, kept), { recursive: true });
  symlinkSync(join(REPO, "node_modules"), join(copy, "node_modules"));
  return copy;
}

function plantStage(copy: string, name: string, { measured = true } = {}): void {
  script(join(copy, "bin", name), `exec node src/${name}.ts\n`);
  plant(copy, `src/${name}.ts`, `import { capped } from "./brief.ts";\nimport { hired } from "./stage.ts";\nexport const handedOn = (body: string): string => \`Judge ${name}: \${capped(body, 100)}\`;\nif (import.meta.main) console.log(typeof hired);\n`);
  const prompts = measured ? `prompts: [{ name: "${name}", file: "src/${name}.ts", cap: 100 + HANDED_ON, slots: ["body"], build: (filled) => handedOn(filled.body ?? "") }],` : "";
  plant(
    copy,
    `src/${name}.part.ts`,
    `import { declareStage, HANDED_ON } from "./stages.ts";\nimport { handedOn } from "./${name}.ts";\ndeclareStage({\n  part: { name: "bin/${name}", file: "bin/${name}", stops: "${FAILURE}" },\n  ${prompts}\n  scenarios: [],\n});\n`,
  );
}

const listed = (copy: string) => JSON.parse(execute("node", copy, {}, ["--input-type=module", "-e", LISTED]).stdout) as { parts: string[]; prompts: number };

describe("each stage declares its own part row, prompts and scenarios in its own part file, and every limit finds it (#1031)", () => {
  it("registers and measures two stages planted side by side, each adding only its own files", () => {
    const copy = machineCopy();
    const before = listed(copy);
    plantStage(copy, "alpha");
    plantStage(copy, "beta");

    const after = listed(copy);

    expect(after.parts).toEqual(expect.arrayContaining(["bin/alpha", "bin/beta"]));
    expect(after.parts).toHaveLength(before.parts.length + 2);
    expect(after.prompts).toBe(before.prompts + 2);
    expect(execute("node", copy, {}, ["src/prompt-bytes.ts"]).status).toBe(0);
  });

  it("refuses a stage whose part file measures no prompt for the model it hires", () => {
    const copy = machineCopy();
    plantStage(copy, "gamma", { measured: false });

    const { status, stderr } = execute("node", copy, {}, ["src/prompt-bytes.ts"]);

    expect(stderr).toBe("src/gamma.ts hires a model and no prompt of that name is measured\n");
    expect(status).toBe(1);
  });
});
