import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";
import { DISPATCH_REQUESTS_PATH_ENV } from "./dispatch-request";

/**
 * Two guards over `.github/workflows`, both derived from what a workflow *does* rather than from a
 * list of the files that happened to be wrong on the day someone looked.
 *
 * A `permissions:` block does not add to the default token — it **replaces** it, and every scope
 * left out is set to `none`. There is no local venue where a token exists at all, so the only
 * evidence that a lane holds the permissions its own code needs arrives as a 403 in production,
 * after the run has spent whatever it spent getting there.
 */

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

/* -------------------------------------------------------------------------------------------- */
/* Guard 1: a workflow that checks out grants itself contents.                                    */
/* -------------------------------------------------------------------------------------------- */

/**
 * `run-watchdog.yml` (#41) died on its first real run having listed `actions: read` and
 * `issues: write` and nothing else: `actions/checkout` failed with `remote: Repository not found`
 * — a message that names an access problem as a missing repository, three retries deep, before the
 * workflow reached a line of its own code.
 */

const WORKFLOWS_DIR = join(REPO_ROOT, ".github/workflows");

/** A `permissions:` block at the top level of the file, which replaces the default token entirely. */
const DECLARES_PERMISSIONS = /^permissions:\s*$/m;

/** `contents:` granted at either level — `read` for a clone, `write` for a push. */
const GRANTS_CONTENTS = /^ {2}contents: (read|write)$/m;

/** Any step that clones the repo. */
const CHECKS_OUT = /uses: actions\/checkout@/;

const workflows = readdirSync(WORKFLOWS_DIR)
  .filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"))
  .map((name) => ({ name, source: readFileSync(join(WORKFLOWS_DIR, name), "utf8") }));

describe("a workflow that checks out grants itself contents", () => {
  it.each(workflows)("$name", ({ name, source }) => {
    if (!CHECKS_OUT.test(source) || !DECLARES_PERMISSIONS.test(source)) return;

    expect(
      GRANTS_CONTENTS.test(source),
      `${name} runs actions/checkout and declares a permissions: block without contents — that block ` +
        "replaces the default token rather than adding to it, so the checkout will fail with " +
        "`remote: Repository not found` before the workflow reaches any of its own steps",
    ).toBe(true);
  });

  it("actually finds the workflows that check out, so a passing suite is not an empty sweep", () => {
    const checkingOut = workflows.filter(({ source }) => CHECKS_OUT.test(source));

    expect(checkingOut.length).toBeGreaterThanOrEqual(3);
    // Every one of them also declares permissions today, so none of the cases above is skipped.
    for (const { name, source } of checkingOut) {
      expect(DECLARES_PERMISSIONS.test(source), `${name} declares no permissions block`).toBe(true);
    }
  });
});

/* -------------------------------------------------------------------------------------------- */
/* Guard 2: a job grants itself the writes its own entrypoints perform.                           */
/* -------------------------------------------------------------------------------------------- */

/**
 * The guard above answers "can this workflow clone?". This one answers the question that has cost
 * real money twice: **can the step that runs a model's decision actually carry it out?**
 *
 * Lane 02 and lane 03 both declared `contents: read` and both ended by sending a
 * `repository_dispatch`, so both hand-offs 403'd after a successful publish
 * ([ADR-0091](../../../docs/adr/0091-the-token-that-spends-a-model-and-the-token-that-starts-the.md)
 * split each into a model job and a sender job). Lane 05 then did it again in a different scope:
 * `implement.yml` declared `issues: read` and reached `gh issue create` after 19 turns and $0.44,
 * leaving an orphaned claim branch behind (#181, #196).
 *
 * Three design facts this guard is built around, none of them optional:
 *
 * 1. **There are no named write helpers to key off.** `shared/gh.ts`'s `execGh` is a raw argv
 *    executor and every write is an argv literal at its call site. So a write is recognised by its
 *    argv, not by a function name on an allowlist.
 * 2. **Permissions are per job**, never per workflow, so the unit here is the job that runs the
 *    step — a workflow-level block only supplies the default a job did not override.
 * 3. **Reachability is by call, not by import.** `integrate.ts` imports a *constant* from
 *    `implement.ts`, which imports the out-of-brief filer, which creates an issue.
 *    `run-ratification.ts` imports a *parser* from `run-release.ts`, which composes a release PR.
 *    Neither lane performs the write, and a guard that walked the import closure would demand two
 *    permissions nobody needs — which is how a guard trains its readers to widen tokens. So this
 *    walks a symbol-level call graph from the entrypoint's module body outwards.
 *
 * **Conditional writes are over-approximated, deliberately.** `acceptance/push-gate.ts` skips its
 * push under `ACCEPTANCE_LANDING=commit`; a write that some runs skip is still a write the token
 * has to be able to perform on the runs that don't, and a deriver that tried to evaluate runtime
 * gates would be a partial interpreter. The single exception is the ADR-0091 seam itself, below:
 * `requestDispatch` does not send when `DISPATCH_REQUESTS_PATH` is set, because that is not a
 * conditional write but a *relocation* of the write into the sender job, and the workflow — not
 * the caller — is what sets it. That case is recognised at the job level and nowhere else.
 */

/** The permission scopes this guard derives. Anything outside these three has not yet bitten. */
type Permission = "contents" | "issues" | "pull-requests";

/**
 * The dispatch endpoint, as a plain string rather than a pattern.
 *
 * `gh-paths.ts` does not carry this one — it generates the `issues/...` builder/matcher pairs, and
 * a dispatch has no variable segment to build. The linter's `no-restricted-syntax` rule bans the
 * template-literal and regex-literal spellings of a `repos/{owner}/{repo}/...` path for exactly
 * that reason, and leaves the plain literal alone, which is how `dispatch-request.ts` and
 * `gh-paths.ts`'s own `GIT_REFS_PATH` spell theirs. So this is a substring test, matched against
 * the same literal the senders send.
 */
const DISPATCHES_PATH = "repos/{owner}/{repo}/dispatches";

interface WriteClass {
  permission: Permission;
  /** How the failure message names the write, in the voice of the entrypoint that performs it. */
  what: string;
  /** The argv literal proving the write, or `undefined` — matched across Prettier's line breaks. */
  find: (body: string) => string | undefined;
}

const WRITE_CLASSES: WriteClass[] = [
  {
    permission: "contents",
    what: "sends a repository_dispatch",
    find: (body) => (body.includes(DISPATCHES_PATH) ? DISPATCHES_PATH : undefined),
  },
  {
    permission: "issues",
    what: "creates, comments on, edits or closes an issue",
    find: (body) => /"issue",\s*"(?:create|comment|edit|close|reopen|delete)"/.exec(body)?.[0],
  },
  {
    permission: "pull-requests",
    what: "opens a pull request",
    find: (body) => /"pr",\s*"create"/.exec(body)?.[0],
  },
];

/** How every venue in this repo spells running an entrypoint. */
const ENTRYPOINT = /npx tsx\s+(\S+\.ts)\b/g;

/** The synthetic symbol holding a module's top-level statements — where an entrypoint guard lives. */
const MODULE_BODY = "#module";

/** A symbol nothing can call: type declarations, import lines, re-export lines. */
const NO_RUNTIME = "#type-only";

/** A top-level value declaration, at column 0 because Prettier puts it there. */
const DECLARATION = /^(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function|const|let|var|class)\s+([A-Za-z_$][\w$]*)/;

/** A top-level line that declares no callable thing — its identifiers reach no code. */
const TYPE_LINE = /^(?:import\b|export\s*[{*]|(?:export\s+)?(?:type|interface|enum|declare)\b)/;

/** Every `import … from "…"` in a module, with its clause and its specifier. */
const IMPORT_STATEMENT = /import\s+([\s\S]*?)\s+from\s+"([^"]+)"/g;

/** Identifiers a chunk mentions — the over-approximation of "what this code could call". */
const IDENTIFIER = /[A-Za-z_$][A-Za-z0-9_$]*/g;

/** Where one imported name comes from. `symbol` is `"*"` for a namespace import. */
interface ImportedName {
  specifier: string;
  symbol: string;
}

interface Module {
  /** Top-level symbol name → its source text, plus `#module` for the statements between them. */
  symbols: Map<string, string>;
  /** Local name → the module and export it came from. Type-only imports are omitted. */
  imports: Map<string, ImportedName>;
}

/**
 * Splits a module into its top-level symbols.
 *
 * Prettier is the parser here: a top-level declaration starts at column 0 and everything belonging
 * to it is indented, so a column-0 line is either a new declaration, a closer, or a statement of
 * the module body. That is an approximation, and it errs towards putting stray lines in
 * `#module` — reachable rather than invisible, which is the safe direction for a permissions guard.
 */
function splitSymbols(source: string): Map<string, string> {
  const symbols = new Map<string, string>();
  let current = MODULE_BODY;

  const append = (line: string) => symbols.set(current, `${symbols.get(current) ?? ""}\n${line}`);

  for (const line of source.split("\n")) {
    if (line === "" || /^\s/.test(line)) {
      append(line);
      continue;
    }
    const declared = DECLARATION.exec(line);
    if (declared) current = declared[1];
    else if (TYPE_LINE.test(line)) current = NO_RUNTIME;
    else current = MODULE_BODY;
    append(line);
  }

  return symbols;
}

/** The local names a module imports at runtime, and what each one is in its own module. */
function readImports(source: string): Map<string, ImportedName> {
  const imports = new Map<string, ImportedName>();

  for (const [, clause, specifier] of source.matchAll(IMPORT_STATEMENT)) {
    if (/^type\s/.test(clause)) continue;

    const namespace = /^\*\s+as\s+([A-Za-z_$][\w$]*)$/.exec(clause.trim());
    if (namespace) {
      imports.set(namespace[1], { specifier, symbol: "*" });
      continue;
    }

    const named = /\{([\s\S]*)\}/.exec(clause);
    const defaultName = /^([A-Za-z_$][\w$]*)\s*(?:,|$)/.exec(clause.trim());
    if (defaultName) imports.set(defaultName[1], { specifier, symbol: MODULE_BODY });

    for (const binding of named?.[1].split(",") ?? []) {
      const parts = binding.trim().split(/\s+as\s+|\s+/);
      if (parts[0] === "type" || parts.length === 0 || parts[0] === "") continue;
      imports.set(parts[parts.length - 1], { specifier, symbol: parts[0] });
    }
  }

  return imports;
}

/** The `.ts` file a relative specifier names, or `undefined` for a package or a missing file. */
function resolveSpecifier(from: string, specifier: string): string | undefined {
  if (!specifier.startsWith(".")) return undefined;
  const base = resolve(dirname(from), specifier);
  const candidates = [base, `${base}.ts`, base.replace(/\.js$/, ".ts"), join(base, "index.ts")];
  return candidates.find((path) => path.endsWith(".ts") && existsSync(path));
}

/** One derived requirement: a job, the permission its entrypoint needs, and the line that proves it. */
interface Requirement {
  workflow: string;
  job: string;
  entrypoint: string;
  permission: Permission;
  what: string;
  /** Repo-relative file and the argv literal found there — what a reader checks the claim against. */
  evidence: string;
}

/**
 * Every write reachable by a call from `entrypoint`'s module body, transitively.
 *
 * `modules` is the parse cache; the walk is over `(file, symbol)` pairs, so importing a constant
 * from a module reaches that constant and nothing else.
 */
function reachableWrites(entrypoint: string, root: string): Map<Permission, { what: string; evidence: string }> {
  const modules = new Map<string, Module>();
  const found = new Map<Permission, { what: string; evidence: string }>();
  const seen = new Set<string>();
  const queue = [{ file: entrypoint, symbol: MODULE_BODY }];

  const load = (file: string): Module | undefined => {
    if (!modules.has(file)) {
      if (!existsSync(file)) return undefined;
      const source = readFileSync(file, "utf8");
      modules.set(file, { symbols: splitSymbols(source), imports: readImports(source) });
    }
    return modules.get(file);
  };

  while (queue.length > 0) {
    const { file, symbol } = queue.pop() as { file: string; symbol: string };
    const key = `${file}::${symbol}`;
    if (seen.has(key) || symbol === NO_RUNTIME) continue;
    seen.add(key);

    const module = load(file);
    if (module === undefined) continue;

    const body = symbol === "*" ? [...module.symbols.values()].join("\n") : module.symbols.get(symbol);
    if (body === undefined) continue;

    for (const { permission, what, find } of WRITE_CLASSES) {
      const hit = find(body);
      if (hit !== undefined && !found.has(permission)) {
        const literal = hit.replace(/\s+/g, " ");
        found.set(permission, { what, evidence: `${relative(root, file)} — ${literal}` });
      }
    }

    for (const name of body.match(IDENTIFIER) ?? []) {
      if (module.symbols.has(name)) queue.push({ file, symbol: name });
      const imported = module.imports.get(name);
      const target = imported && resolveSpecifier(file, imported.specifier);
      if (imported && target) queue.push({ file: target, symbol: imported.symbol });
    }
  }

  return found;
}

/** What a job's own block, or the workflow default it inherits, grants for one scope. */
function granted(block: unknown, permission: Permission): string {
  if (block === "write-all") return "write";
  if (typeof block === "object" && block !== null) {
    return String((block as Record<string, unknown>)[permission] ?? "none");
  }
  return "none";
}

/**
 * Every write requirement in `root`, derived from the entrypoints its workflows run.
 *
 * Parameterised by root rather than pinned to this repo so the fixture below can be handed to the
 * same code — a guard that has only ever run against a correct tree has not been shown to detect
 * anything, which is why #181 was filed twice.
 */
function derive(root: string): Requirement[] {
  const dir = join(root, ".github/workflows");
  const requirements: Requirement[] = [];

  for (const name of readdirSync(dir).filter((file) => /\.ya?ml$/.test(file))) {
    const workflow = parse(readFileSync(join(dir, name), "utf8")) as {
      permissions?: unknown;
      jobs?: Record<string, { permissions?: unknown; steps?: { run?: unknown }[] }>;
    };

    for (const [job, definition] of Object.entries(workflow.jobs ?? {})) {
      const block = definition.permissions ?? workflow.permissions;
      // ADR-0091's seam: a job that sets this variable does not send its own dispatches, it hands
      // them to the sender job, so the `contents: write` requirement belongs to that job instead.
      const relocatesDispatch = JSON.stringify(definition).includes(DISPATCH_REQUESTS_PATH_ENV);

      for (const step of definition.steps ?? []) {
        for (const [, path] of String(step.run ?? "").matchAll(ENTRYPOINT)) {
          for (const [permission, write] of reachableWrites(join(root, path), root)) {
            if (permission === "contents" && relocatesDispatch) continue;
            if (granted(block, permission) === "write") continue;
            requirements.push({ workflow: name, job, entrypoint: path, permission, ...write });
          }
        }
      }
    }
  }

  return requirements;
}

function describeShortfall(shortfall: Requirement[]): string {
  return shortfall
    .map(
      (r) =>
        `${r.workflow} job "${r.job}" runs ${r.entrypoint}, which ${r.what} (${r.evidence}), ` +
        `but that job does not declare ${r.permission}: write`,
    )
    .join("\n");
}

const FIXTURE_ROOT = join(REPO_ROOT, ".Workflow/agent-workflows/shared/workflow-permissions.fixtures/lane");

describe("a job grants itself the writes its entrypoints perform", () => {
  it("every lane in this repo declares what its own code writes", () => {
    const shortfall = derive(REPO_ROOT);

    expect(
      shortfall.length,
      `A lane spends its run and then 403s on the write it exists to perform:\n${describeShortfall(shortfall)}`,
    ).toBe(0);
  });

  it("fails on a fixture whose permissions are narrower than its entrypoints write", () => {
    const shortfall = derive(FIXTURE_ROOT);

    // `narrow.yml` and `wide.yml` run the same entrypoint reaching the same `issue create`; only
    // the declared permission differs. So this asserts the deriver read the block, not that it
    // reds out everything handed to it.
    expect(shortfall.map((r) => `${r.workflow} ${r.permission}`)).toEqual(["narrow.yml issues"]);
    expect(shortfall[0].evidence).toContain("file-finding.ts");
  });

  it("derives writes across the real lanes, so a passing suite is not an empty sweep", () => {
    // Every requirement the deriver finds in this repo is satisfied — which makes the count above
    // meaningless unless it found something. Re-derive with nothing granted: the same walk, minus
    // the permission check, is the census of what it actually reads out of the entrypoints.
    const census = new Map<string, Set<Permission>>();
    const dir = join(REPO_ROOT, ".github/workflows");

    for (const name of readdirSync(dir).filter((file) => /\.ya?ml$/.test(file))) {
      const source = readFileSync(join(dir, name), "utf8");
      for (const [, path] of source.matchAll(ENTRYPOINT)) {
        const writes = [...reachableWrites(join(REPO_ROOT, path), REPO_ROOT).keys()];
        if (writes.length > 0) census.set(path, new Set(writes));
      }
    }

    expect(census.size).toBeGreaterThanOrEqual(8);
    expect([...(census.get(".Workflow/agent-workflows/implement/implement.ts") ?? [])].sort()).toEqual([
      "contents",
      "issues",
      "pull-requests",
    ]);
  });
});
