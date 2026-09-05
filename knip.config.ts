import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = import.meta.dirname;

const INVOCATION = /\.Workflow\/[A-Za-z0-9/._-]+\.ts/g;

function filesIn(dir: string): string[] {
  let names: string[];
  try {
    names = readdirSync(join(REPO_ROOT, dir));
  } catch {
    return [];
  }
  return names
    .map((name) => join(dir, name))
    .filter((path) => statSync(join(REPO_ROOT, path)).isFile());
}

const venueFiles = [...filesIn(".github/workflows"), ...filesIn("bin"), ...filesIn(".claude/hooks")];

const invoked = new Set<string>();
for (const file of venueFiles) {
  const text = readFileSync(join(REPO_ROOT, file), "utf8");
  for (const match of text.matchAll(INVOCATION)) invoked.add(match[0]);
}

/** A `@shell` tag carrying prose after it, anywhere in a file: the same tag knip reads on exports. */
const SHELL_TAG = /@shell[ \t]+\S/;

/**
 * A file earns its entry by carrying `@shell` and its own reason, so the excuse sits next to the
 * code rather than in this config, where it would be indistinguishable from dead code.
 */
function shellLaunched(dir: string): string[] {
  return filesIn(dir)
    .filter((path) => path.endsWith(".mjs"))
    .filter((path) => SHELL_TAG.test(readFileSync(join(REPO_ROOT, path), "utf8")));
}

const SPAWNED_TAG = /@shell[ \t]+spawns[ \t]+`([^`\n]+)`/g;

const FIXTURE_TAG = /@fixture[ \t]+\S/;

const SUITE_ONLY = /\.(fake|fixture|stub|setup)\.ts$|\.fixtures\//;

function sourcesUnder(dir: string): string[] {
  let names: string[];
  try {
    names = readdirSync(join(REPO_ROOT, dir));
  } catch {
    return [];
  }
  return names.flatMap((name) => {
    const path = join(dir, name);
    return statSync(join(REPO_ROOT, path)).isDirectory() ? sourcesUnder(path) : [path];
  });
}

/**
 * A spawned argv[0] earns its exemption where an export does: at the call site, tagged `@shell`,
 * so the excuse cannot outlive the call it names and go on sitting here as a bare string.
 */
function spawnedNames(dirs: string[]): string[] {
  const named = new Set<string>();
  for (const path of dirs.flatMap((dir) => sourcesUnder(dir))) {
    if (!/\.(m|c)?(t|j)s$/.test(path)) continue;
    const text = readFileSync(join(REPO_ROOT, path), "utf8");
    for (const match of text.matchAll(SPAWNED_TAG)) named.add(match[1]);
  }
  return [...named].sort();
}

/**
 * A suite-only file earns its exemption where an export does: by carrying `@fixture` and its own
 * reason, so the excuse cannot outlive the file and go on sitting here as a bare glob.
 */
function suiteOnly(dirs: string[]): string[] {
  return dirs
    .flatMap((dir) => sourcesUnder(dir))
    .filter((path) => SUITE_ONLY.test(path) && /\.(m|c)?(t|j)s$/.test(path))
    .filter((path) => FIXTURE_TAG.test(readFileSync(join(REPO_ROOT, path), "utf8")))
    .sort();
}

const production = (paths: string[]) => paths.map((path) => `${path}!`);

export default {
  entry: production([
    ...shellLaunched(".claude/hooks"),
    ...shellLaunched("bin"),
    ...[...invoked].sort(),
  ]),
  project: ["**/*.{js,mjs,ts}!"],

  includeEntryExports: true,
  ignoreExportsUsedInFile: true,

  ignore: suiteOnly([".Workflow", "bin", ".claude"]),

  /**
   * to find. `@shell` is a real production caller knip cannot see (a subprocess, a dynamic
   * `import()` from a shell heredoc); `@fixture` is a builder the suite alone is meant to reach.
   * `shellLaunched` above applies the first of them to whole scripts, which have no export to tag.
   */
  tags: ["-shell", "-fixture"],

  ignoreUnresolved: spawnedNames([".Workflow", "bin", ".claude"]),
  ignoreBinaries: spawnedNames([".Workflow", "bin", ".claude"]),
};
