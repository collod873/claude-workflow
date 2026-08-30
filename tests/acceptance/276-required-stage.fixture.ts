import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { repoRoot } from "./workflow-shape.fixture";

/**
 * The readers #276's three acceptance tests share.
 *
 * Not a `.test.ts`, so `vitest.config.ts`'s `tests/acceptance/**\/*.test.ts` include never collects
 * it as a suite — it is only ever imported by one. `.fixture.ts` is the name this directory already
 * gives a file whose job is to be unreachable from a lane.
 *
 * All three of this ticket's criteria close on the same two moves: run a command from the checkout
 * root and report what it did (`npx tsc --noEmit`, `grep -q ...`, `npx vitest run .Workflow
 * .claude`), and read `shared/stage.ts`'s `StageOptions` declaration. Copied into three test files
 * that is three spawn-and-report helpers to get subtly different from each other, which is the
 * divergence this directory's fixture convention exists to prevent and which `bin/clone-gate`
 * reports on push.
 *
 * **Why nothing here imports the subject.** CI restores `tests/acceptance/` from trunk and restores
 * only that directory, so an import of `shared/stage.ts` would be a specifier the branch under test
 * controls — an implementer could satisfy the criteria by editing the thing the test reached
 * through. The subject is reached the way a shell reaches it instead: `tsc` is pointed at a
 * generated call site, and `stage.ts` is read as text.
 *
 * A missing `stage.ts` reads as empty text rather than as an exception, because a criterion has to
 * come back red rather than throw.
 */

/** The file this ticket claims, as `npx tsc --noEmit` and the criterion's own `grep` see it. */
export const STAGE_SOURCE = path.join(
  repoRoot,
  ".Workflow",
  "agent-workflows",
  "shared",
  "stage.ts",
);

/** The same file spelled the way criterion 2's `grep` spells it — relative to the checkout root. */
export const STAGE_SOURCE_RELATIVE = ".Workflow/agent-workflows/shared/stage.ts";

export interface CommandRun {
  status: number | null;
  stdout: string;
  stderr: string;
}

/**
 * Runs a command from the checkout root, exactly as a criterion's own check spells it.
 *
 * The runner's own markers are stripped from the child's environment so a spawned `vitest` starts a
 * clean run rather than believing it is already inside one.
 */
export function runFromRoot(command: string, args: string[], timeout: number): CommandRun {
  const env: Record<string, string | undefined> = { ...process.env, CI: "1" };
  delete env.VITEST;
  delete env.VITEST_WORKER_ID;
  delete env.VITEST_POOL_ID;
  delete env.VITEST_MODE;

  const run = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    env: env as NodeJS.ProcessEnv,
    timeout,
    maxBuffer: 64 * 1024 * 1024,
  });

  return { status: run.status, stdout: run.stdout ?? "", stderr: run.stderr ?? "" };
}

/** Both of a run's streams, for an assertion about what a compiler said rather than about its code. */
export function combinedOutput(run: CommandRun): string {
  return `${run.stdout}\n${run.stderr}`;
}

/**
 * `""` when a run was green, and the whole run when it was not.
 *
 * Asserted against `""` rather than comparing exit codes, so a red criterion prints the command's
 * own output — which is the only thing that says *why* the repo did not typecheck or which test
 * failed.
 */
export function failureReport(label: string, run: CommandRun): string {
  if (run.status === 0) return "";
  return `\`${label}\` exited ${String(run.status)}\nstdout:\n${run.stdout}\nstderr:\n${run.stderr}`;
}

/** `stage.ts` as text, or `""` when it is not there — a missing file fails an assertion, not a read. */
export function stageSource(): string {
  return existsSync(STAGE_SOURCE) ? readFileSync(STAGE_SOURCE, "utf8") : "";
}

/**
 * The body of `export interface StageOptions { ... }`, up to the closing brace in column 0 — `null`
 * when the file declares no such interface.
 *
 * A deliberately literal reader rather than a TypeScript parse: what criterion 2 asserts is the
 * text a `grep` matches and a maintainer reads, and the field being *inside* `StageOptions` is the
 * part a bare `grep` cannot tell you.
 */
export function stageOptionsBlock(): string | null {
  const lines = stageSource().split("\n");
  const start = lines.findIndex((line) => /^\s*export interface StageOptions\b/.test(line));
  if (start === -1) return null;
  const body: string[] = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^\}/.test(lines[i])) return body.join("\n");
    body.push(lines[i]);
  }
  return body.join("\n");
}

/**
 * The same block with its comments removed, so a member declaration is matched rather than the
 * prose above one — every field on `StageOptions` carries a docstring, and this interface's prose
 * talks about the fields by name.
 */
export function stageOptionsMembers(): string | null {
  const block = stageOptionsBlock();
  if (block === null) return null;
  return block.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

/** Whether `StageOptions` declares `stage` as a required `string` — no `?`, anywhere. */
export function declaresRequiredStage(): boolean {
  const members = stageOptionsMembers();
  if (members === null) return false;
  return (
    /^\s*(?:readonly\s+)?stage\s*:\s*string\s*;/m.test(members) &&
    !/^\s*(?:readonly\s+)?stage\s*\?\s*:/m.test(members)
  );
}

/**
 * Where a generated `runStage` call site is typechecked — under the checkout root, so the relative
 * import of `stage.ts` and `node_modules` both resolve the way they do for any file in this repo.
 * Written and removed inside one call, so nothing of it outlives the assertion.
 */
const PROBE_DIR = path.join(repoRoot, ".acceptance-276-typecheck");

/** A module specifier for `target` as seen from the probe directory — computed, never written out. */
function specifierTo(target: string): string {
  const relative = path
    .relative(PROBE_DIR, target)
    .split(path.sep)
    .join("/")
    .replace(/\.ts$/, "");
  return relative.startsWith(".") ? relative : `./${relative}`;
}

/**
 * A permissive config on purpose: what is being asked of the compiler is whether a required field is
 * missing from an object literal, which is checked under every setting. Turning `strict` on would
 * risk reporting something about `stage.ts`'s own body instead, and a probe that goes red for that
 * reason says nothing about this ticket.
 */
const PROBE_TSCONFIG = JSON.stringify(
  {
    compilerOptions: {
      noEmit: true,
      strict: false,
      target: "ES2022",
      module: "ESNext",
      moduleResolution: "Bundler",
      esModuleInterop: true,
      allowSyntheticDefaultImports: true,
      resolveJsonModule: true,
      skipLibCheck: true,
    },
    files: ["probe.ts"],
  },
  null,
  2,
);

/**
 * One `runStage` call site, with `options` written out verbatim as its fifth argument.
 *
 * The schema and the executor are reached through `Parameters<typeof runStage>` rather than by
 * importing `structured-output.ts` and `zod`, so the probe pulls in the subject's own graph and
 * nothing else — and so a rename of the structured-output type cannot turn this red for a reason
 * having nothing to do with the stage name.
 */
function probeSource(options: string): string {
  return [
    `import { runStage } from ${JSON.stringify(specifierTo(STAGE_SOURCE))};`,
    ``,
    `type Output = Parameters<typeof runStage>[3];`,
    ``,
    `const exec = async (): Promise<string> => "{}";`,
    `const output = { jsonSchema: "{}", parse: (text: string) => text } as unknown as Output;`,
    ``,
    `export async function callSite(): Promise<unknown> {`,
    `  return runStage("prompt.md", {}, exec, output, ${options});`,
    `}`,
    ``,
  ].join("\n");
}

/**
 * Typechecks one `runStage` call site whose `StageOptions` literal is `options`.
 *
 * This is how "every call site is required to name its stage" is observable from outside: a literal
 * carrying `stage` has to compile, and one that carries every other field but not `stage` has to be
 * refused by the compiler rather than accepted.
 */
export function typecheckCallSite(options: string): CommandRun {
  rmSync(PROBE_DIR, { recursive: true, force: true });
  mkdirSync(PROBE_DIR, { recursive: true });
  try {
    writeFileSync(path.join(PROBE_DIR, "probe.ts"), probeSource(options), "utf8");
    writeFileSync(path.join(PROBE_DIR, "tsconfig.json"), PROBE_TSCONFIG, "utf8");
    return runFromRoot(
      "npx",
      ["tsc", "--project", path.join(PROBE_DIR, "tsconfig.json")],
      600_000,
    );
  } finally {
    rmSync(PROBE_DIR, { recursive: true, force: true });
  }
}
