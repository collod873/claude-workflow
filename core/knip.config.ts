import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import ts from "typescript";
import { parts } from "./parts.ts";

const REPO = join(import.meta.dirname, "..");
const MODULE = /\.(m|c)?[jt]s$/;
const RUNS = /core\/[\w.-]+(\/[\w.-]+)*\.(m|c)?[jt]s(?!\w)/g;

const read = (file: string): string => (existsSync(join(REPO, file)) ? readFileSync(join(REPO, file), "utf8") : "");

const importsOf = (file: string): string[] =>
  ts
    .preProcessFile(read(file), true, true)
    .importedFiles.map(({ fileName }) => fileName)
    .filter((target) => target.startsWith("."))
    .map((target) => normalize(join(dirname(file), target)));

const under = (dir: string): string[] =>
  readdirSync(join(REPO, dir), { withFileTypes: true }).flatMap((found) =>
    found.isDirectory() ? (found.name === "node_modules" ? [] : under(`${dir}/${found.name}`)) : [`${dir}/${found.name}`]);

const roots = [
  ...new Set(
    parts
      .map((part) => part.file)
      .filter((file) => file.startsWith("core/"))
      .flatMap((file) => (MODULE.test(file) ? [file] : read(file).match(RUNS) ?? [])),
  ),
];

const reached = new Set<string>();
const waiting = [...roots];
while (waiting.length > 0) {
  const file = waiting.pop() as string;
  if (reached.has(file)) continue;
  reached.add(file);
  waiting.push(...importsOf(file));
}

const calledTests = under("core").filter((file) => file.endsWith(".test.ts") && importsOf(file).every((target) => reached.has(target)));

export default {
  entry: [...roots, ...calledTests],
  project: ["core/**/*.{js,mjs,ts}"],
  includeEntryExports: true,
  vitest: false,
  eslint: { config: ["core/eslint.config.js"] },
  include: ["files", "exports", "nsExports", "types", "nsTypes", "duplicates", "unresolved"],
};
