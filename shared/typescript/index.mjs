import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import { NAMESPACE, plugin } from "./plugin.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
export const SHARED_BLOCKS = new WeakSet();

export const JAVASCRIPT = ["**/*.{js,jsx,mjs,cjs}"];
export const TYPESCRIPT = ["**/*.{ts,tsx,mts,cts}"];
export const SOURCES = [...JAVASCRIPT, ...TYPESCRIPT];
export const ALWAYS_IGNORED = [".claude/worktrees/**", "shared/**"];
const TESTS = ["**/*.{test,spec}.{js,jsx,mjs,cjs,ts,tsx,mts,cts}"];
const PROCESS_TESTS = ["**/*.proc.test.*"];
const CONFIGS = ["**/*.config.*"];
const UNUSED_IGNORED = "^_";

export function shared(blocks) {
  return blocks.map((block) => {
    const named = { ...block, name: `${NAMESPACE}/${block.name ?? "preset"}` };
    SHARED_BLOCKS.add(named);
    return named;
  });
}

function devDependencies(root) {
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  return Object.keys(manifest.devDependencies ?? {}).sort();
}

function scoped(name, rule, { files, ignores = [] }, ...options) {
  return {
    name,
    files,
    ignores,
    rules: { [`${NAMESPACE}/${rule}`]: ["error", ...options] },
  };
}

function settle(options) {
  const tests = options.tests ?? TESTS;
  return {
    root: resolve(options.root ?? join(HERE, "..", "..")),
    ignores: options.ignores ?? [],
    tests,
    processTests: options.processTests ?? PROCESS_TESTS,
    configs: { files: CONFIGS, ignores: [], ...options.configs },
    globalWrites: options.globalWrites ?? tests,
    production: options.production,
    boundaryMocks: options.boundaryMocks,
    sandbox: options.sandbox,
    useClient: options.useClient,
    defaultProject: options.defaultProject ?? [],
  };
}

function projectService({ defaultProject }) {
  return defaultProject.length > 0 ? { allowDefaultProject: defaultProject } : true;
}

function presets(settled) {
  return [
    { name: "ignores", ignores: [...ALWAYS_IGNORED, ...settled.ignores] },
    { name: "sources", files: SOURCES, languageOptions: { globals: globals.node } },
    { ...js.configs.recommended, name: "eslint-recommended" },
    ...tseslint.configs.recommendedTypeChecked,
    {
      name: "type-information",
      languageOptions: {
        parserOptions: { projectService: projectService(settled), tsconfigRootDir: settled.root },
      },
    },
    { ...tseslint.configs.disableTypeChecked, name: "javascript-untyped", files: JAVASCRIPT },
    {
      name: "linter-options",
      linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: "error" },
    },
    {
      name: "unused-vars",
      rules: {
        "no-unused-vars": "off",
        "@typescript-eslint/no-unused-vars": [
          "error",
          {
            argsIgnorePattern: UNUSED_IGNORED,
            varsIgnorePattern: UNUSED_IGNORED,
            caughtErrorsIgnorePattern: UNUSED_IGNORED,
            destructuredArrayIgnorePattern: UNUSED_IGNORED,
            ignoreRestSiblings: true,
          },
        ],
      },
    },
    { name: "plugin", plugins: { [NAMESPACE]: plugin } },
  ];
}

function optional(value, build) {
  return value ? build(value) : [];
}

function sharedRules(settled) {
  const tests = { files: settled.tests };
  return [
    scoped("no-sole-classname-assertion", "no-sole-classname-assertion", tests),
    scoped("no-child-process-in-tests", "no-child-process-in-tests", {
      files: settled.tests,
      ignores: settled.processTests,
    }),
    scoped("config-predicts-environment", "config-predicts-environment", settled.configs),
    scoped("no-top-level-global-write", "no-top-level-global-write", {
      files: settled.globalWrites,
    }),
    ...optional(settled.production, (production) => [
      scoped("no-dev-dependency-import", "no-dev-dependency-import", production, {
        packages: devDependencies(settled.root),
      }),
      scoped("no-test-utils-import", "no-test-utils-import", production),
    ]),
    ...optional(settled.boundaryMocks, ({ modules, home, files = SOURCES, ignores = [] }) => [
      scoped(
        "no-boundary-mock",
        "no-boundary-mock",
        { files, ignores: [home, ...ignores].filter(Boolean) },
        { modules, home },
      ),
    ]),
    ...optional(settled.sandbox, ({ files, helper, ignores = [] }) => [
      scoped(
        "no-mkdtemp-sync",
        "no-mkdtemp-sync",
        { files, ignores: [helper, ...ignores] },
        { helper },
      ),
    ]),
    ...optional(settled.useClient, (files) => [
      scoped("require-use-client", "require-use-client", { files }),
    ]),
  ];
}

export function typescript(options = {}) {
  const settled = settle(options);
  return shared([...presets(settled), ...sharedRules(settled)]);
}
