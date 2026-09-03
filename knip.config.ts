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

/** A `@shell` tag carrying prose after it, anywhere in a file — the same tag knip reads on exports. */
const SHELL_TAG = /@shell[ \t]+\S/;

/**
 * `@shell` tag below exists to prevent: the file gets excused in a config, with the reason nowhere
 * near it, which is indistinguishable from the dead code this check is for. So a file earns its
 * entry by carrying `@shell` and its own reason, exactly as an exempted export does; one that does
 * not is reported unused, and its author has to wire it or say why.
 */
function shellLaunched(dir: string): string[] {
  return filesIn(dir)
    .filter((path) => path.endsWith(".mjs"))
    .filter((path) => SHELL_TAG.test(readFileSync(join(REPO_ROOT, path), "utf8")));
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

  ignore: ["**/*.fake.ts", "**/*.fixture.ts", "**/*.stub.ts", "**/*.fixtures/**", "**/*.setup.ts"],

  /**
   * to find. `@shell` is a real production caller knip cannot see (a subprocess, a dynamic
   * `import()` from a shell heredoc); `@fixture` is a builder the suite alone is meant to reach.
   * `shellLaunched` above applies the first of them to whole scripts, which have no export to tag.
   */
  tags: ["-shell", "-fixture"],

  ignoreUnresolved: ["bin/gauntlet", "bin/new-adr", "bin/close-ticket"],
};
