import { copyFileSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { execute, scratch, script, type Run } from "./scenarios.ts";

const REPO = resolve(import.meta.dirname, "..");
const CHECK = readFileSync(join(REPO, "core", "check"), "utf8");
const UNUSED = (CHECK.match(/^run unused (.+)$/m) as RegExpMatchArray)[1].split(" ");
const PLANTED = ["reached", "lonely"];

function planted(registry: string[]): string {
  const root = scratch("knip-entries-");
  mkdirSync(join(root, "core", "bin"), { recursive: true });
  writeFileSync(join(root, "package.json"), '{"name":"planted","version":"0.0.0","type":"module"}\n');
  symlinkSync(join(REPO, "node_modules"), join(root, "node_modules"));
  copyFileSync(join(REPO, "core", "knip.config.ts"), join(root, "core", "knip.config.ts"));
  writeFileSync(join(root, "core", "parts.ts"), `export const parts = [\n${registry.map((file) => `  { name: "${file}", file: "${file}", stops: "" },\n`).join("")}];\n`);
  for (const name of PLANTED) {
    script(join(root, "core", "bin", name), `node core/${name}.ts\n`);
    writeFileSync(join(root, "core", `${name}.ts`), `export const ${name} = 1;\n`);
    writeFileSync(join(root, "core", `${name}.test.ts`), `import { ${name} } from "./${name}.ts";\nconsole.log(${name});\n`);
  }
  return root;
}

function unused(root: string): Run {
  return execute(UNUSED[0], root, { PATH: `${join(REPO, "node_modules", ".bin")}:${process.env.PATH ?? ""}` }, UNUSED.slice(1));
}

describe("knip counts its entries from the registered parts, not from the tests (ADR-0086, #710)", () => {
  it("fails an export that only a test imports, and passes one a registered part reaches", () => {
    const untouched = unused(planted(["core/knip.config.ts", "core/bin/reached"]));

    expect(untouched.stdout).toContain("core/lonely.ts");
    expect(untouched.stdout).not.toContain("core/reached.ts");
    expect(untouched.status).toBe(1);

    const called = unused(planted(["core/knip.config.ts", "core/bin/reached", "core/bin/lonely"]));

    expect(called.stdout).toBe("");
    expect(called.status).toBe(0);
  });
});
