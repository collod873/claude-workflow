import { type Tree } from "./loaded-docs.ts";

const ROOTS = ["core", ".claude/hooks", ".claude/skills", "bin"];
const SKIPPED = ["node_modules", "__pycache__"];

export function machineryFiles(tree: Tree): string[] {
  const walk = (dir: string): string[] =>
    tree
      .entries(dir)
      .filter((entry) => !SKIPPED.includes(entry))
      .sort()
      .flatMap((entry) => {
        const path = `${dir}/${entry}`;
        return tree.read(path) === undefined ? walk(path) : [path];
      });
  return ROOTS.flatMap(walk);
}
