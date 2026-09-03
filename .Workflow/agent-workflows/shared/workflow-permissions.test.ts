import { existsSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { DISPATCH_REQUESTS_PATH_ENV } from "./dispatch-request";
import { readWorkflows } from "./read-workflow";
import { readRepoText, REPO_ROOT } from "./repo-sources";

interface WorkflowJob {
  env?: Record<string, unknown>;
  steps?: Array<{ run?: string; uses?: string; env?: Record<string, unknown> }>;
}

const DECLARES_PERMISSIONS = /^permissions:\s*$/m;

const GRANTS_CONTENTS = /^ {2}contents: (read|write)$/m;

const CHECKS_OUT = /uses: actions\/checkout@/;

const workflows = readWorkflows<{ jobs?: Record<string, WorkflowJob> }>().map(({ name, source, workflow }) => ({ name, source, workflow }));

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
    for (const { name, source } of checkingOut) {
      expect(DECLARES_PERMISSIONS.test(source), `${name} declares no permissions block`).toBe(true);
    }
  });
});

type Permission = "contents" | "issues" | "pull-requests";

const DISPATCHES_PATH = "repos/{owner}/{repo}/dispatches";

interface WriteClass {
  permission: Permission;
  what: string;
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

const ENTRYPOINT = /npx tsx\s+(\S+\.ts)\b/g;

const MODULE_BODY = "#module";

const NO_RUNTIME = "#type-only";

const DECLARATION = /^(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function|const|let|var|class)\s+([A-Za-z_$][\w$]*)/;

const TYPE_LINE = /^(?:import\b|export\s*[{*]|(?:export\s+)?(?:type|interface|enum|declare)\b)/;

const IMPORT_STATEMENT = /import\s+([\s\S]*?)\s+from\s+"([^"]+)"/g;

const IDENTIFIER = /[A-Za-z_$][A-Za-z0-9_$]*/g;

interface ImportedName {
  specifier: string;
  symbol: string;
}

interface Module {
  symbols: Map<string, string>;
  imports: Map<string, ImportedName>;
}

function splitSymbols(source: string): Map<string, string> {
  const symbols = new Map<string, string>();
  let current = MODULE_BODY;

  const append = (line: string) => symbols.set(current, `${symbols.get(current) ?? ""}\n${line}`);

  for (const line of source.split("\n")) {
    if (line === "" || /^[\s)}\]]/.test(line)) {
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

function resolveSpecifier(from: string, specifier: string): string | undefined {
  if (!specifier.startsWith(".")) return undefined;
  const base = resolve(dirname(from), specifier);
  const candidates = [base, `${base}.ts`, base.replace(/\.js$/, ".ts"), join(base, "index.ts")];
  return candidates.find((path) => path.endsWith(".ts") && existsSync(path));
}

interface Requirement {
  workflow: string;
  job: string;
  entrypoint: string;
  permission: Permission;
  what: string;
  evidence: string;
}

function reachableWrites(entrypoint: string, root: string): Map<Permission, { what: string; evidence: string }> {
  const modules = new Map<string, Module>();
  const found = new Map<Permission, { what: string; evidence: string }>();
  const seen = new Set<string>();
  const queue = [{ file: entrypoint, symbol: MODULE_BODY }];

  const load = (file: string): Module | undefined => {
    if (!modules.has(file)) {
      if (!existsSync(file)) return undefined;
      const source = readRepoText(file);
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

function granted(block: unknown, permission: Permission): string {
  if (block === "write-all") return "write";
  if (typeof block === "object" && block !== null) {
    return String((block as Record<string, unknown>)[permission] ?? "none");
  }
  return "none";
}

function derive(root: string): Requirement[] {
  const requirements: Requirement[] = [];

  for (const { name, workflow } of readWorkflows<{
    permissions?: unknown;
    jobs?: Record<string, { permissions?: unknown; steps?: { run?: unknown }[] }>;
  }>(join(root, ".github/workflows"))) {
    for (const [job, definition] of Object.entries(workflow.jobs ?? {})) {
      const block = definition.permissions ?? workflow.permissions;
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

  it("reds narrow.yml, the fixture lane held permanently wrong so this guard always has a defect to catch", () => {
    const shortfall = derive(FIXTURE_ROOT);

    expect(
      shortfall.map((r) => `${r.workflow} ${r.permission}`),
      "narrow.yml runs an entrypoint reaching `issue create` while declaring issues: read, the shape " +
        "of #181's implement.yml and of the dispatch before ADR-0091. Real instances get fixed, and a " +
        "guard whose only subject is a correct tree has never been shown to detect anything",
    ).toEqual(["narrow.yml issues"]);
    expect(shortfall[0].evidence).toContain("file-finding.ts");
  });

  it("greens wide.yml, the control carrying the same write with issues: write on the job", () => {
    expect(
      derive(FIXTURE_ROOT).map((r) => r.workflow),
      "wide.yml runs the same entrypoint and declares the permission on the job, the level that " +
        "counts — so the red above is the deriver reading a permissions block, not the deriver " +
        "failing everything it is handed",
    ).not.toContain("wide.yml");
  });

  it("derives writes across the real lanes, so a passing suite is not an empty sweep", () => {
    const census = new Map<string, Set<Permission>>();

    for (const { source } of workflows) {
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

const INSTALLS_CLAUDE = /npm install -g @anthropic-ai\/claude-code@/;
const BINDS_MODEL_SECRET = /^\s+CLAUDE_CODE_OAUTH_TOKEN: \$\{\{ secrets\.CLAUDE_CODE_OAUTH_TOKEN \}\}$/m;

const spendsModel = (source: string) => INSTALLS_CLAUDE.test(source) || BINDS_MODEL_SECRET.test(source);

const CANCELS_IN_PROGRESS = /^\s*cancel-in-progress: true\s*$/m;

describe("a lane that spends a model does not cancel itself", () => {
  it.each(workflows)("$name", ({ name, source }) => {
    if (!spendsModel(source)) return;

    expect(
      CANCELS_IN_PROGRESS.test(source),
      `${name} spends a model and carries cancel-in-progress: true — the next event on the same ` +
        "group kills the run mid-call, so the money is spent and the answer is thrown away, and " +
        "the run history reads `cancelled` as though a human pressed stop. Use " +
        "`cancel-in-progress: false` so a second event queues behind the first",
    ).toBe(false);
  });

  it("actually finds the lanes that spend a model, so a passing suite is not an empty sweep", () => {
    const spending = workflows.filter(({ source }) => spendsModel(source)).map(({ name }) => name);

    expect(spending.length).toBeGreaterThanOrEqual(9);
    expect(spending).toEqual(expect.arrayContaining(["shape.yml", "spec.yml", "acceptance.yml", "ratify.yml"]));
    expect(spending).not.toContain("ratify-on-prd-close.yml");
  });
});

const DECLARES_CONCURRENCY = /^concurrency:\s*$/m;
const NAMES_GROUP = /^ {2}(?:#.*\n)*\s*group: \S/m;

function performsWrite(source: string): boolean {
  for (const [, path] of source.matchAll(ENTRYPOINT)) {
    if (reachableWrites(join(REPO_ROOT, path), REPO_ROOT).size > 0) return true;
  }
  return false;
}

describe("a lane that spends or writes declares a concurrency group", () => {
  it.each(workflows)("$name", ({ name, source }) => {
    if (!spendsModel(source) && !performsWrite(source)) return;

    expect(
      DECLARES_CONCURRENCY.test(source) && NAMES_GROUP.test(source),
      `${name} spends a model or performs a write and declares no concurrency group — two events ` +
        "for the same subject run side by side and both act, so one PRD slices into two sets of " +
        "sub-issues, or one close opens two release pull requests. Declare a group keyed on the " +
        "subject the run acts for",
    ).toBe(true);
  });

  it("actually finds the lanes that act, so a passing suite is not an empty sweep", () => {
    const acting = workflows
      .filter(({ source }) => spendsModel(source) || performsWrite(source))
      .map(({ name }) => name);

    expect(acting.length).toBeGreaterThanOrEqual(10);
    expect(acting).toEqual(
      expect.arrayContaining(["to-tickets.yml", "ratify-on-prd-close.yml", "implement.yml"]),
    );
  });
});

const GH_PLACEHOLDER = "{owner}/{repo}";

function placeholderJobsWithoutCheckout(workflow: { jobs?: Record<string, WorkflowJob> } | null): Array<[string, WorkflowJob]> {
  return Object.entries(workflow?.jobs ?? {}).filter(([, job]) => {
    const steps = job.steps ?? [];
    if (steps.some((step) => step.uses?.startsWith("actions/checkout@"))) return false;
    return steps.some((step) => step.run?.includes(GH_PLACEHOLDER));
  });
}

describe("a checkout-less job that sends to gh's {owner}/{repo} sets GH_REPO", () => {
  it.each(workflows)("$name", ({ name, workflow }) => {
    for (const [jobName, job] of placeholderJobsWithoutCheckout(workflow)) {
      const sending = (job.steps ?? []).filter((step) => step.run?.includes(GH_PLACEHOLDER));

      for (const step of sending) {
        expect(
          "GH_REPO" in (job.env ?? {}) || "GH_REPO" in (step.env ?? {}),
          `${name}'s ${jobName} job runs gh against ${GH_PLACEHOLDER} with no checkout and no ` +
            "GH_REPO — gh expands that placeholder from GH_REPO or the cwd's git remote, so with " +
            "neither the call fails with `not a git repository` and the send is silently lost. " +
            "Add `GH_REPO: ${{ github.repository }}` to the job's env, the shape spec.yml uses",
        ).toBe(true);
      }
    }
  });

  it("actually finds the jobs that send, so a passing suite is not an empty sweep", () => {
    const sending = workflows.flatMap(({ name, workflow }) =>
      placeholderJobsWithoutCheckout(workflow).map(([jobName]) => `${name}#${jobName}`),
    );

    expect(sending).toEqual(expect.arrayContaining(["verify.yml#signal-fixer", "spec.yml#dispatch"]));
  });
});
