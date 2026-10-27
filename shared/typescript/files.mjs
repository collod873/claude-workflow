import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, matchesGlob } from "node:path";

export const LINTABLE = /\.(?:[cm]?[jt]s|[jt]sx)$/;

export const configShaped = (file) =>
  /\.(?:[cm]?js|json)$/.test(file) || (/\.[cm]?ts$/.test(file) && !file.startsWith("src/"));

export function listedFiles(root) {
  const output = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { cwd: root, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
  );
  const names = new Set(output.split("\0").filter(Boolean));
  return [...names].filter((name) => existsSync(join(root, name))).sort();
}

const matched = new WeakMap();

function literalPrefix(glob) {
  const wild = glob.search(/[*?[{!]/);
  return wild === -1 ? glob : glob.slice(0, wild);
}

function matchingOne(files, glob) {
  if (!matched.has(files)) matched.set(files, new Map());
  const byGlob = matched.get(files);
  if (!byGlob.has(glob)) {
    const prefix = literalPrefix(glob);
    byGlob.set(
      glob,
      new Set(
        files.filter(
          (file) =>
            file.startsWith(prefix) && (matchesGlob(file, glob) || matchesGlob(file, `${glob}/**`)),
        ),
      ),
    );
  }
  return byGlob.get(glob);
}

export function matching(files, globs) {
  const sets = globs.map((glob) => matchingOne(files, glob));
  return files.filter((file) => sets.some((set) => set.has(file)));
}
