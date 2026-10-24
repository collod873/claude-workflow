import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, matchesGlob } from "node:path";

export const LINTABLE = /\.(?:[cm]?[jt]s|[jt]sx)$/;

export function listedFiles(root) {
  const output = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { cwd: root, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
  );
  const names = new Set(output.split("\0").filter(Boolean));
  return [...names].filter((name) => existsSync(join(root, name))).sort();
}

export function matching(files, globs) {
  return files.filter((file) =>
    globs.some((glob) => matchesGlob(file, glob) || matchesGlob(file, `${glob}/**`)),
  );
}
