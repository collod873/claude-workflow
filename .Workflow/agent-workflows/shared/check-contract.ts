import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { z } from "zod";

/**
 * The check contract's one new seam (spec #117 §"The shared seam"): a single module owning the
 * six-slot schema, per-venue slot resolution (including the broader-slot degradation), and the
 * probe that writes a fresh contract from a target repo's tree. `bin/gauntlet` is bash and must
 * not learn to parse JSON — this is where that parsing lives instead, so the runner and the
 * generator cannot disagree about the same schema.
 *
 * The six slots — `stop`, `test`, `test_one`, `typecheck`, `lint`, `all` — are era 6's, unchanged
 * (`agent-skills` ADR-0006/ADR-0022; see `docs/adr/0056-bin-gauntlet-runs-the-check-contract-instead-of-three-hardco.md`
 * and CONTEXT.md's "Check contract" entry). Nothing here renames, renumbers, or removes a slot.
 *
 * `test_related` is a seventh, added by #335 — the turn venue ran no tests at all, and the runner
 * this repo installs has a form (`vitest related`) that runs only the test files importing the
 * file just edited: one to three files, sub-second, at the venue where a repair is cheapest. It is
 * an addition and not a rename, so a contract written against the six still parses every slot it
 * names; a target that has no such form carries it as the sanctioned `cmd: null` and its turn
 * venue runs no tests, exactly as before.
 */

export const SLOT_NAMES = [
  "stop",
  "test",
  "test_one",
  "test_related",
  "typecheck",
  "lint",
  "all",
] as const;
export type SlotName = (typeof SLOT_NAMES)[number];

/**
 * One slot: a command to run, or the sanctioned `cmd: null` opt-out — either way carrying a
 * `why` that names a **declaration site**, never a measurement (ADR-0056: a stopwatch reading in
 * `why` is a second, unwatched copy of a fact the runner already holds live).
 */
export const Slot = z.object({
  cmd: z.string().min(1).nullable(),
  why: z.string().min(1),
});
export type Slot = z.infer<typeof Slot>;

/**
 * The six-slot schema. `.strict()` is load-bearing: it is what makes a typo'd or invented slot
 * name a validation failure instead of a silently-ignored extra key — the reader this file gives
 * the contract, the same way a dead command is `exit 2` rather than a quiet no-op.
 */
export const CheckContract = z
  .object({
    stop: Slot,
    test: Slot,
    test_one: Slot,
    test_related: Slot,
    typecheck: Slot,
    lint: Slot,
    all: Slot,
  })
  .strict();
export type CheckContract = z.infer<typeof CheckContract>;

function isSlotName(name: string): name is SlotName {
  return (SLOT_NAMES as readonly string[]).includes(name);
}

/**
 * The one exported builder for a `CheckContract` fixture (CODING_STANDARDS.md: "a schema-typed
 * fixture through one exported builder"), every slot defaulting to a null opt-out so a test names
 * only the slot it is actually about.
 *
 * @fixture Reached only from the suite, by design — `knip.config.ts` asks whether a *lane* reaches
 * a thing, and the honest answer for a fixture builder is no.
 */
export function checkContractFixture(
  overrides: Partial<Record<SlotName, Partial<Slot>>> = {},
): CheckContract {
  const contract = {} as Record<SlotName, Slot>;
  for (const name of SLOT_NAMES) {
    contract[name] = { cmd: null, why: `${name} fixture default`, ...overrides[name] };
  }
  return CheckContract.parse(contract);
}

/** What resolving a requested form against a contract produced. */
export interface SlotResolution {
  /** The slot actually run. */
  slot: SlotName;
  /** That slot's resolved command — the same lookup a caller would otherwise repeat. */
  cmd: string | null;
  /** True when `requested` was not itself a schema slot and had to degrade to `slot`. */
  substituted: boolean;
  /** The form actually asked for, present only when it differs from `slot`. */
  requested?: string;
}

/**
 * What a venue runs for a requested form of check. `requested` is ordinarily a schema slot name
 * outright. Where a venue needs a narrower form the schema has no slot for — the `turn` venue
 * lints one file, and there is no `lint_one` — it asks for that narrow name (`lint_one`), and
 * resolution degrades to the **broader** slot the `_one` suffix strips down to (`lint`), reporting
 * the substitution rather than skipping (ADR-0056: "A venue never skips... No slot is invented.").
 * `test_one` needs no degradation: the schema already carries it, so it resolves directly.
 *
 * Throws when `requested` names neither a schema slot nor a `_one` form of one — a caller error
 * (a mistyped venue name), not a degradation case this function is meant to absorb.
 *
 * @shell `bin/gauntlet` is the production caller, and it reaches this through a dynamic `import()`
 * inside a heredoc — an edge no static analysis can see. Deleting this as unused would take the
 * gauntlet with it.
 */
export function resolveSlot(contract: CheckContract, requested: string): SlotResolution {
  if (isSlotName(requested)) {
    return { slot: requested, cmd: contract[requested].cmd, substituted: false };
  }
  const ONE_SUFFIX = "_one";
  const broader = requested.endsWith(ONE_SUFFIX)
    ? requested.slice(0, -ONE_SUFFIX.length)
    : undefined;
  if (broader && isSlotName(broader)) {
    return { slot: broader, cmd: contract[broader].cmd, substituted: true, requested };
  }
  throw new Error(`check-contract: "${requested}" names no slot and no broader form of one`);
}

// --- The probe -----------------------------------------------------------------------------
//
// Writes a contract from what it finds in a target repo's tree, never from a `.claude/contract.json`
// already there — a contract regenerated from its own prior output could never disagree with
// itself, and disagreeing with a stale prior is the whole point of `regenerate && diff` (ADR-0056).
// The probe is Node/JS-scoped for now: it reads `package.json`, the tool config files a repo's own
// scripts point at, and `node_modules/.bin` the same way `bin/gauntlet`'s own preflight does.
// A check the probe cannot see is indistinguishable from a check that is not there, and that
// honest limit is recorded in each null slot's `why` rather than designed around.

interface PackageJson {
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  packageManager?: string;
}

// --- Package manager detection ---------------------------------------------------------------
//
// A repo is not always npm — Lumaria's own tree has no `package-lock.json` at all, only a
// `pnpm-lock.yaml` (ADR-0139) — so every command this probe emits has to be asked in the package
// manager the target actually uses, not assumed to be npm. `.github/actions/target-deps/action.yml`
// makes the identical call, in bash, for the identical reason (installing the target's own
// dependencies rather than this machine's); keep the precedence below in sync with that file's, and
// say so in a comment on both, because a probe and an installer that pick different managers for the
// same repo is a bug neither file's own tests can see.
//
// Precedence: `package.json#packageManager` first — a repo that declares one has said so
// explicitly, corepack-enforced — then the lockfile actually committed, in the same order
// `target-deps/action.yml` checks: `pnpm-lock.yaml`, `yarn.lock`, `bun.lockb`/`bun.lock`, and
// npm (`package-lock.json` or no lockfile at all) last, because npm is also what a probe with no
// evidence either way should default to.

const PACKAGE_MANAGERS = ["npm", "pnpm", "yarn", "bun"] as const;
export type PackageManager = (typeof PACKAGE_MANAGERS)[number];

function isPackageManager(name: string): name is PackageManager {
  return (PACKAGE_MANAGERS as readonly string[]).includes(name);
}

/**
 * The package manager a fresh probe of `root` would use to run everything below —
 * `package.json#packageManager` (e.g. `"pnpm@8.15.0"`) first, then the lockfile actually
 * committed, npm last as the default a probe with no evidence either way falls back to.
 */
export function detectPackageManager(root: string, pkg: PackageJson): PackageManager {
  const declared = pkg.packageManager?.split("@")[0]?.trim();
  if (declared && isPackageManager(declared)) return declared;

  if (existsSync(join(root, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(join(root, "yarn.lock"))) return "yarn";
  if (existsSync(join(root, "bun.lockb")) || existsSync(join(root, "bun.lock"))) return "bun";
  return "npm";
}

/** The command that runs `name` as a `package.json#scripts` entry, in `pm`'s own run form. */
function runScript(pm: PackageManager, name: string): string {
  switch (pm) {
    case "pnpm":
      return `pnpm run ${name}`;
    case "yarn":
      return `yarn ${name}`;
    case "bun":
      return `bun run ${name}`;
    case "npm":
      return `npm run ${name}`;
  }
}

/** The dedicated `test` command each manager publishes, for the one script npm shortens to `npm test`. */
function testCommand(pm: PackageManager): string {
  switch (pm) {
    case "pnpm":
      return "pnpm test";
    case "yarn":
      return "yarn test";
    case "bun":
      return "bun test";
    case "npm":
      return "npm test";
  }
}

/** The command that runs `invocation` (e.g. `"tsc --noEmit"`) as a locally installed binary, without a declared script. */
function execBin(pm: PackageManager, invocation: string): string {
  switch (pm) {
    case "pnpm":
      return `pnpm exec ${invocation}`;
    case "yarn":
      return `yarn ${invocation}`;
    case "bun":
      return `bunx ${invocation}`;
    case "npm":
      return `npx ${invocation}`;
  }
}

function readPackageJson(root: string): PackageJson | undefined {
  const path = join(root, "package.json");
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as PackageJson;
  } catch {
    return undefined;
  }
}

function hasDependency(pkg: PackageJson, name: string): boolean {
  return Boolean(pkg.dependencies?.[name] ?? pkg.devDependencies?.[name]);
}

/** Whether `<root>/node_modules/.bin/<tool>` exists — the same precondition `bin/gauntlet` checks. */
function binInstalled(root: string, tool: string): boolean {
  return existsSync(join(root, "node_modules", ".bin", tool));
}

const SKIP_DIRS = new Set(["node_modules", ".git"]);
const TEST_FILE_NAME = /\.(test|spec)\.[cm]?[jt]sx?$/;

/**
 * Whether any file under `root` (excluding `node_modules` and `.git`, at any depth) looks like a
 * test file. Corroborating evidence for the `test` slot when nothing declares a test command —
 * 3D-Printing's actual shape (`docs/research/gauntlet-portability-2026-08.md` §3): a real suite,
 * declared nowhere, that a probe trusting only `package.json#scripts` would miss entirely.
 */
function hasTestFile(root: string): boolean {
  const stack: string[] = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    if (dir === undefined) break;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) stack.push(join(dir, entry.name));
      } else if (TEST_FILE_NAME.test(entry.name)) {
        return true;
      }
    }
  }
  return false;
}

const BIOME_CONFIG_NAMES = ["biome.json", "biome.jsonc"];
const ESLINT_CONFIG_NAMES = [
  ".eslintrc",
  ".eslintrc.js",
  ".eslintrc.cjs",
  ".eslintrc.json",
  "eslint.config.js",
  "eslint.config.mjs",
  "eslint.config.cjs",
  "eslint.config.ts",
];

function anyFileExists(root: string, names: readonly string[]): boolean {
  return names.some((name) => existsSync(join(root, name)));
}

function probeTypecheck(root: string, pkg: PackageJson, pm: PackageManager): Slot {
  const script = pkg.scripts?.typecheck;
  if (script) return { cmd: runScript(pm, "typecheck"), why: `package.json#scripts.typecheck (${script})` };
  if (existsSync(join(root, "tsconfig.json")) && binInstalled(root, "tsc")) {
    return {
      cmd: execBin(pm, "tsc --noEmit"),
      why: "tsconfig.json present and tsc installed; no package.json#scripts.typecheck declared",
    };
  }
  return {
    cmd: null,
    why: "no package.json#scripts.typecheck, and no tsconfig.json with tsc installed",
  };
}

function probeLint(root: string, pkg: PackageJson, pm: PackageManager): Slot {
  const script = pkg.scripts?.lint;
  if (script) return { cmd: runScript(pm, "lint"), why: `package.json#scripts.lint (${script})` };
  if (anyFileExists(root, BIOME_CONFIG_NAMES) && binInstalled(root, "biome")) {
    return {
      cmd: execBin(pm, "biome check ."),
      why: "biome.json present and biome installed; no package.json#scripts.lint declared",
    };
  }
  if (anyFileExists(root, ESLINT_CONFIG_NAMES) && binInstalled(root, "eslint")) {
    return {
      cmd: execBin(pm, "eslint ."),
      why: "eslint config present and eslint installed; no package.json#scripts.lint declared",
    };
  }
  return {
    cmd: null,
    why: "no package.json#scripts.lint, and no biome or eslint config with the tool installed",
  };
}

function testOneSlot(root: string, pkg: PackageJson, pm: PackageManager): Slot {
  if (hasDependency(pkg, "vitest") && binInstalled(root, "vitest")) {
    return {
      cmd: execBin(pm, "vitest run <file>"),
      why: "vitest's single-file form; no package.json script for it",
    };
  }
  return { cmd: null, why: "no known single-file form for the installed test runner" };
}

/**
 * The turn venue's test form: only the test files that import the file just edited (#335).
 *
 * `vitest related` is the one runner form this probe knows that answers that question; a repo
 * whose runner has no equivalent gets the sanctioned `cmd: null`, and its turn venue runs no tests.
 * Never the broader `test` slot as a fallback — the whole suite at a PostToolUse hook is a tax on
 * every turn, which is the opposite of what putting a check at the earliest venue buys (ADR-0010).
 *
 * No exclusion for `tests/acceptance/`, unlike `timing-baseline.ts`'s own measuring run, and the
 * reason is a property of the tests rather than an oversight: an acceptance test reads the tree
 * through the filesystem and imports nothing but its own fixture, so no edit to a source file is
 * *related* to one. An acceptance test that started importing its subject would surface here as a
 * red turn — which is a fair report on a test that had stopped being written from the ticket alone.
 */
function testRelatedSlot(root: string, pkg: PackageJson, pm: PackageManager): Slot {
  if (hasDependency(pkg, "vitest") && binInstalled(root, "vitest")) {
    return {
      cmd: execBin(pm, "vitest related --run <file>"),
      why: "vitest's related-tests form; no package.json script for it",
    };
  }
  return { cmd: null, why: "no known related-tests form for the installed test runner" };
}

function probeTest(
  root: string,
  pkg: PackageJson,
  pm: PackageManager,
): { test: Slot; test_one: Slot; test_related: Slot } {
  const script = pkg.scripts?.test;
  if (script) {
    return {
      test: { cmd: testCommand(pm), why: `package.json#scripts.test (${script})` },
      test_one: testOneSlot(root, pkg, pm),
      test_related: testRelatedSlot(root, pkg, pm),
    };
  }
  if (hasDependency(pkg, "vitest") && binInstalled(root, "vitest") && hasTestFile(root)) {
    return {
      test: {
        cmd: execBin(pm, "vitest run"),
        why: "vitest installed and test file(s) found; no package.json#scripts.test declared",
      },
      test_one: testOneSlot(root, pkg, pm),
      test_related: testRelatedSlot(root, pkg, pm),
    };
  }
  return {
    test: {
      cmd: null,
      why: "no package.json#scripts.test, and no installed test runner corroborated by a test file",
    },
    test_one: { cmd: null, why: "no test slot to narrow — see `test`" },
    test_related: { cmd: null, why: "no test slot to narrow — see `test`" },
  };
}

const STOP_GATE_HOOK = ".claude/hooks/stop-gate.sh";
const SETTINGS_PATH = ".claude/settings.json";

/**
 * The Stop hook as Claude Code's settings schema declares it: a list of matcher groups, each
 * holding a list of hooks. Only `command` hooks are a turn-end *check* — the other types run
 * something that is not a shell command and so cannot be a contract slot's `cmd`.
 *
 * Lenient by construction (`.catch`, `.optional()`): a settings file carrying keys this schema has
 * never heard of is the normal case, not a defect, and a probe that threw on one would report a
 * repo as having no turn-end check because it had a setting for something else.
 */
const StopHookSettings = z.object({
  hooks: z
    .object({
      Stop: z
        .array(
          z.object({
            hooks: z
              .array(z.object({ type: z.string().optional(), command: z.string().optional() }))
              .optional(),
          }),
        )
        .optional(),
    })
    .optional(),
});

/**
 * A hook command rewritten relative to the repo root. Claude Code interpolates
 * `$CLAUDE_PROJECT_DIR` to the repo root at hook time, so a declaration written against it names a
 * repo-relative path already — it just says so in a variable a contract reader has no way to
 * expand. Every quoting form the settings docs use is stripped here, because a probe that only
 * understood the unquoted one would publish an absolute-ish path that no other repo could run.
 */
function repoRelativeHookCommand(raw: string): string {
  return raw
    .trim()
    .replace(/^(?:"\$CLAUDE_PROJECT_DIR"|'\$CLAUDE_PROJECT_DIR'|\$\{CLAUDE_PROJECT_DIR\}|\$CLAUDE_PROJECT_DIR)\/?/, "")
    .replace(/^\.\//, "")
    .trim();
}

/**
 * Every `command` hook declared under `Stop` in `<root>/.claude/settings.json`, in file order —
 * each as the `cmd` a contract reader can run and the `raw` text the settings file actually
 * carries, which is what `why` cites.
 */
function declaredStopCommands(root: string): Array<{ cmd: string; raw: string }> {
  const path = join(root, SETTINGS_PATH);
  if (!existsSync(path)) return [];
  let parsed: z.infer<typeof StopHookSettings>;
  try {
    parsed = StopHookSettings.parse(JSON.parse(readFileSync(path, "utf8")));
  } catch {
    // Unreadable or shaped unlike any settings file this understands. Measuring nothing is the
    // honest outcome; the `stop-gate.sh` fallback below still gets its turn.
    return [];
  }
  return (parsed.hooks?.Stop ?? [])
    .flatMap((group) => group.hooks ?? [])
    .filter((hook) => (hook.type ?? "command") === "command")
    .map((hook) => ({ cmd: repoRelativeHookCommand(hook.command ?? ""), raw: (hook.command ?? "").trim() }))
    .filter((hook) => hook.cmd.length > 0);
}

/**
 * A hook naming the check it runs, as a comment a probe can read: `# check-command: bin/gauntlet
 * stop`, or `//` for a hook written in a language that comments that way. First match wins.
 *
 * It exists because #186: a Stop hook is *not* the turn-end check, and publishing one as `stop.cmd`
 * is what let 255 turn-end runs report `clean` in 0.02s each. Claude Code invokes a hook with its
 * payload as JSON on stdin; run as a plain command it gets none, prints nothing and exits 0 — every
 * question a probe can ask about a path on disk (present, executable, the one `settings.json`
 * wires) is answered yes, and the only question that matters is answered `exit 0` forever.
 *
 * So the hook is asked what it runs instead of being taken for it. A comment rather than a flag
 * because reading a file cannot wedge a session, and the alternative — matching `.claude/hooks/X.sh`
 * to `bin/X` by name — is the kind of convention #130 already caught describing only the repos that
 * happen to follow it.
 */
const CHECK_COMMAND_DECLARATION = /^[ \t]*(?:#|\/\/)[ \t]*check-command:[ \t]*(\S.*?)[ \t]*$/m;

/** A command's argv[0], unquoted. Whitespace-split, which is every hook command shape settings.json carries. */
function argv0(command: string): string {
  return (command.trim().split(/\s+/)[0] ?? "").replace(/^["']|["']$/g, "");
}

/** The `check-command:` a hook declares, or `undefined` when the file is unreadable or declares none. */
function declaredCheckCommand(root: string, hookCommand: string): string | undefined {
  const script = argv0(hookCommand);
  if (!script) return undefined;
  const path = isAbsolute(script) ? script : join(root, script);
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
  return CHECK_COMMAND_DECLARATION.exec(text)?.[1];
}

/**
 * Whether a reader who checked this repo out could actually run `cmd`. A command naming a path is
 * held to that path being an executable file here; a bare name is a PATH lookup this probe cannot
 * resolve for a reader's machine and does not pretend to.
 */
function isRunnableHere(root: string, cmd: string): boolean {
  const script = argv0(cmd);
  if (!script.includes("/")) return true;
  try {
    return (statSync(join(root, script)).mode & 0o111) !== 0;
  } catch {
    return false;
  }
}

/**
 * The turn-end check, read from the hook a repo declares — not the hook itself (#186, amending
 * #130).
 *
 * #130 fixed the probe looking in the wrong place: it tested one hardcoded path,
 * `.claude/hooks/stop-gate.sh`, so this repo — whose hook is wired in `.claude/settings.json` —
 * published `stop: null` while running a turn-end check every turn. What it then published was the
 * hook entry point, which is the wrong *kind* of thing: a slot's `cmd` is "the input a runner runs"
 * (CONTEXT.md), and a hook is only runnable by Claude Code, holding a payload this repo's contract
 * has no way to hand it. Both defects are one shape — a `null`, then a green, that nothing measured.
 *
 * `settings.json` is still asked first, because it is the declaration site and the hardcoded path is
 * a convention. Two or more declared Stop hooks publish `null` rather than an arbitrary first one —
 * a repo with two turn-end checks has no single command a contract reader can run, and picking one
 * would be the probe assuming rather than measuring. A hook that declares no `check-command:` is the
 * same `null` for the same reason: this probe found a turn-end check it cannot name, which is not
 * the same as naming one it cannot run.
 */
function probeStop(root: string): Slot {
  const declared = declaredStopCommands(root);
  if (declared.length > 1) {
    return {
      cmd: null,
      why: `${SETTINGS_PATH}#hooks.Stop declares ${declared.length} command hooks — no single turn-end check to name`,
    };
  }

  const hook =
    declared.length === 1
      ? { cmd: declared[0].cmd, site: `wired at ${SETTINGS_PATH}#hooks.Stop` }
      : existsSync(join(root, STOP_GATE_HOOK))
        ? { cmd: STOP_GATE_HOOK, site: `at the conventional ${STOP_GATE_HOOK}` }
        : undefined;

  if (!hook) {
    return {
      cmd: null,
      why: `no Stop hook in ${SETTINGS_PATH}, and no turn-end check at ${STOP_GATE_HOOK}`,
    };
  }

  const check = declaredCheckCommand(root, hook.cmd);
  if (!check) {
    return {
      cmd: null,
      why: `the Stop hook ${hook.cmd} (${hook.site}) declares no \`check-command:\` — a hook entry point is not a command a contract reader can run`,
    };
  }
  if (!isRunnableHere(root, check)) {
    return {
      cmd: null,
      why: `the Stop hook ${hook.cmd} declares \`check-command: ${check}\`, which is not an executable file in this tree`,
    };
  }
  return { cmd: check, why: `${argv0(hook.cmd)}#check-command, ${hook.site}` };
}

const AGGREGATE_SCRIPT_NAMES = ["check", "verify", "ci"] as const;

function probeAll(pkg: PackageJson, pm: PackageManager): Slot {
  for (const name of AGGREGATE_SCRIPT_NAMES) {
    const script = pkg.scripts?.[name];
    if (script) return { cmd: runScript(pm, name), why: `package.json#scripts.${name} (${script})` };
  }
  return {
    cmd: null,
    why: "no aggregate script found among package.json#scripts.{check,verify,ci}",
  };
}

const NO_TOOLCHAIN_WHY = "no package.json found in this tree — no Node toolchain to probe";

/**
 * Writes a fresh `CheckContract` from what `root` actually contains — never from any
 * `.claude/contract.json` already there, which this function does not read. A `null` slot is a
 * `null` this probe measured, not one it assumed.
 */
export function probe(root: string): CheckContract {
  const pkg = readPackageJson(root);
  if (!pkg) {
    const empty: Slot = { cmd: null, why: NO_TOOLCHAIN_WHY };
    return CheckContract.parse({
      stop: empty,
      test: empty,
      test_one: empty,
      test_related: empty,
      typecheck: empty,
      lint: empty,
      all: empty,
    });
  }

  const pm = detectPackageManager(root, pkg);
  const { test, test_one, test_related } = probeTest(root, pkg, pm);
  return CheckContract.parse({
    stop: probeStop(root),
    test,
    test_one,
    test_related,
    typecheck: probeTypecheck(root, pkg, pm),
    lint: probeLint(root, pkg, pm),
    all: probeAll(pkg, pm),
  });
}
