/**
 * The `diff <root> <path>` subcommand shared by every `regenerate && diff` generator in this
 * family (ADR-0056) — `generate-contract.ts`, `generate-corpus-fixture.ts`, and now
 * `generate-boundaries-doc.ts` (#305): exit 1 and print the mismatch when `path` disagrees with a
 * fresh generation of `root`, exit 0 when they match. Extracted here so a third copy of the
 * dispatch is what the clone gate catches, not what it has to baseline.
 */
export function runDiffSubcommand(
  scriptName: string,
  pathArgName: string,
  args: string[],
  diff: (root: string, committedPath: string) => string | undefined,
): never {
  const [, root, committedPath] = args;
  if (!root || !committedPath) {
    console.error(`usage: ${scriptName} diff <root> ${pathArgName}`);
    process.exit(2);
  }
  const mismatch = diff(root, committedPath);
  if (mismatch) {
    console.log(mismatch);
    process.exit(1);
  }
  process.exit(0);
}

export interface GeneratorCli {
  scriptName: string;
  /** The name of the committed path in `diff`'s usage message, e.g. `"<docPath>"`. */
  pathArgName: string;
  generate: (root: string) => string;
  diff: (root: string, committedPath: string) => string | undefined;
  /** `undefined` when the tree isn't one this generator describes — skips `diff` with exit 0, same as every other gate in this family opts a tree out. */
  isConfigured?: (root: string) => boolean;
  /** What the non-`diff` branch does with a fresh generation. Defaults to writing it to stdout. */
  onGenerate?: (root: string, output: string) => void;
}

/** The whole CLI a `regenerate && diff` generator's `isMain` block dispatches to — call this as its only line. */
export function runGeneratorCli(cli: GeneratorCli): void {
  const args = process.argv.slice(2);
  if (args[0] === "diff") {
    if (cli.isConfigured?.(args[1] ?? process.cwd()) === false) process.exit(0);
    runDiffSubcommand(cli.scriptName, cli.pathArgName, args, cli.diff);
  } else {
    const root = args[0] ?? process.cwd();
    (cli.onGenerate ?? ((_, output) => process.stdout.write(output)))(root, cli.generate(root));
  }
}
