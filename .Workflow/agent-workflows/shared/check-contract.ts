import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
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
 */

export const SLOT_NAMES = ["stop", "test", "test_one", "typecheck", "lint", "all"] as const;
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

function probeTypecheck(root: string, pkg: PackageJson): Slot {
  const script = pkg.scripts?.typecheck;
  if (script) return { cmd: "npm run typecheck", why: `package.json#scripts.typecheck (${script})` };
  if (existsSync(join(root, "tsconfig.json")) && binInstalled(root, "tsc")) {
    return {
      cmd: "npx tsc --noEmit",
      why: "tsconfig.json present and tsc installed; no package.json#scripts.typecheck declared",
    };
  }
  return {
    cmd: null,
    why: "no package.json#scripts.typecheck, and no tsconfig.json with tsc installed",
  };
}

function probeLint(root: string, pkg: PackageJson): Slot {
  const script = pkg.scripts?.lint;
  if (script) return { cmd: "npm run lint", why: `package.json#scripts.lint (${script})` };
  if (anyFileExists(root, BIOME_CONFIG_NAMES) && binInstalled(root, "biome")) {
    return {
      cmd: "npx biome check .",
      why: "biome.json present and biome installed; no package.json#scripts.lint declared",
    };
  }
  if (anyFileExists(root, ESLINT_CONFIG_NAMES) && binInstalled(root, "eslint")) {
    return {
      cmd: "npx eslint .",
      why: "eslint config present and eslint installed; no package.json#scripts.lint declared",
    };
  }
  return {
    cmd: null,
    why: "no package.json#scripts.lint, and no biome or eslint config with the tool installed",
  };
}

function testOneSlot(root: string, pkg: PackageJson): Slot {
  if (hasDependency(pkg, "vitest") && binInstalled(root, "vitest")) {
    return {
      cmd: "npx vitest run <file>",
      why: "vitest's single-file form; no package.json script for it",
    };
  }
  return { cmd: null, why: "no known single-file form for the installed test runner" };
}

function probeTest(root: string, pkg: PackageJson): { test: Slot; test_one: Slot } {
  const script = pkg.scripts?.test;
  if (script) {
    return {
      test: { cmd: "npm test", why: `package.json#scripts.test (${script})` },
      test_one: testOneSlot(root, pkg),
    };
  }
  if (hasDependency(pkg, "vitest") && binInstalled(root, "vitest") && hasTestFile(root)) {
    return {
      test: {
        cmd: "npx vitest run",
        why: "vitest installed and test file(s) found; no package.json#scripts.test declared",
      },
      test_one: testOneSlot(root, pkg),
    };
  }
  return {
    test: {
      cmd: null,
      why: "no package.json#scripts.test, and no installed test runner corroborated by a test file",
    },
    test_one: { cmd: null, why: "no test slot to narrow — see `test`" },
  };
}

const STOP_GATE_HOOK = ".claude/hooks/stop-gate.sh";

function probeStop(root: string): Slot {
  if (existsSync(join(root, STOP_GATE_HOOK))) {
    return { cmd: STOP_GATE_HOOK, why: `declared turn-end hook at ${STOP_GATE_HOOK}` };
  }
  return {
    cmd: null,
    why: `no turn-end check narrower than the full checks found at ${STOP_GATE_HOOK}`,
  };
}

const AGGREGATE_SCRIPT_NAMES = ["check", "verify", "ci"] as const;

function probeAll(pkg: PackageJson): Slot {
  for (const name of AGGREGATE_SCRIPT_NAMES) {
    const script = pkg.scripts?.[name];
    if (script) return { cmd: `npm run ${name}`, why: `package.json#scripts.${name} (${script})` };
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
      typecheck: empty,
      lint: empty,
      all: empty,
    });
  }

  const { test, test_one } = probeTest(root, pkg);
  return CheckContract.parse({
    stop: probeStop(root),
    test,
    test_one,
    typecheck: probeTypecheck(root, pkg),
    lint: probeLint(root, pkg),
    all: probeAll(pkg),
  });
}
