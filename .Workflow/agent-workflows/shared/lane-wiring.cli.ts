import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { emitEstate, WORKFLOWS_PATH } from "./lane-wiring";
import { runRegenerator } from "./regenerate-cli";

function readOrEmpty(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

function stale(root: string): { path: string; relative: string; content: string }[] {
  return emitEstate().flatMap(({ name, content }) => {
    const relative = `${WORKFLOWS_PATH}/${name}`;
    const path = join(root, relative);
    return readOrEmpty(path) === content ? [] : [{ path, relative, content }];
  });
}

export function estateIsCurrent(root: string): boolean {
  return stale(root).length === 0;
}

export function regenerateEstate(root: string): string[] {
  return stale(root).map((file) => {
    writeFileSync(file.path, file.content);
    return file.relative;
  });
}

runRegenerator(import.meta.url, {
  name: "lane-wiring",
  target: WORKFLOWS_PATH,
  command: "npm run lane-wiring",
  isCurrent: estateIsCurrent,
  regenerate: regenerateEstate,
});
