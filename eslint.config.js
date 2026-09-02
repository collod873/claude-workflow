// @ts-check
import path from "node:path";
import tseslint from "typescript-eslint";
import sonarjs from "eslint-plugin-sonarjs";

// Syntactic rules only — no `parserOptions.project`, deliberately. The
// type-aware presets need one, and `tsconfig.json`'s `include` doesn't cover
// this file, so reaching for `recommendedTypeChecked` would need a
// `tsconfig.json` edit this ticket hasn't claimed. See CODING_STANDARDS.md
// and docs/adr/ for the grooming obligation every enabled rule here carries.

const repoPathSelectorMessage =
  "Hand-written GitHub REST paths under repos/{owner}/{repo}/... must be built through " +
  "or matched against .Workflow/agent-workflows/shared/gh-paths.ts, not inlined or hand-rolled.";

/**
 * The inline `err instanceof Error ? err.message : String(err)` narrowing, pointed at the one
 * canonical implementation. Named rather than inlined because `tests/acceptance/**` has to re-declare
 * `no-restricted-syntax` *without* it — that directory may not import the implementation this
 * message names, so the rule cannot apply there (ADR-0102) — while keeping the rest.
 */
const INLINE_REASON_SELECTOR = {
  selector:
    "ConditionalExpression[test.type='BinaryExpression'][test.operator='instanceof'][test.right.name='Error']",
  message:
    "Use reason(err) — or errorMessage(err) when you are matching on the failure rather " +
    "than reporting it — from .Workflow/agent-workflows/shared/reason.ts instead of " +
    "inline `err instanceof Error ? err.message : String(err)` narrowing.",
};

/**
 * Hand-written GitHub REST paths, in the two forms they can take. Named for the same reason as
 * `INLINE_REASON_SELECTOR`: these still hold inside `tests/acceptance/**`, so the re-declaration
 * there spreads them back in rather than dropping them along with the one that cannot.
 */
const REPO_PATH_SELECTORS = [
  {
    // Catches a hand-written path built as a template literal, e.g.
    // `repos/{owner}/{repo}/issues/${n}/sub_issues` — every real
    // publisher/fake site interpolates a number, so it's a
    // TemplateLiteral, never a plain string Literal.
    selector: "TemplateElement[value.raw=/repos\\/\\{owner\\}\\/\\{repo\\}/]",
    message: repoPathSelectorMessage,
  },
  {
    // Catches a hand-written matcher built as a regex literal, e.g.
    // /^repos\/\{owner\}\/\{repo\}\/issues\/(\d+)$/ — a regex
    // literal's `value` stringifies with its escapes intact, so this
    // must key off `regex.pattern`, never `Literal[value=...]`.
    selector:
      "Literal[regex.pattern=/repos\\\\\\/\\\\?\\{?owner\\\\?\\}?\\\\\\/\\\\?\\{?repo\\\\?\\}?/]",
    message: repoPathSelectorMessage,
  },
];

/**
 * The directory an acceptance test may not import outside of, found by walking `filename`'s own
 * path segments rather than trusting the linter's `cwd` — `acceptance-import-boundary.test.ts`
 * lints fixtures from a temp root, and this way it proves the rule without having to fake the
 * repo's cwd to do it. `null` for a file this override's `files:` glob didn't actually match
 * (defensive only; every real call site is already scoped to `tests/acceptance/**`).
 */
function acceptanceBoundaryFor(filename) {
  const parts = filename.split(path.sep);
  for (let i = 0; i < parts.length - 1; i++) {
    if (parts[i] === "tests" && parts[i + 1] === "acceptance") {
      return parts.slice(0, i + 2).join(path.sep);
    }
  }
  return null;
}

/**
 * spec #145's Lane 04 section: "An acceptance test may not import anything outside its own
 * directory" (ADR-0032). `tests/acceptance/**` is restored from `main`'s tip before CI runs it
 * (ADR-0032), so a helper it imported from anywhere else silently reverts to trunk's copy while
 * the test importing it does not — a path filter that is complete only if nothing in the tree it
 * covers reaches outside that tree. The fix this rule enforces is duplication inside
 * `tests/acceptance/`, not a shared helper elsewhere.
 *
 * Only relative specifiers (`.`/`..`) are resolved and checked — a bare specifier is an npm
 * package, which restore-from-tip already covers via `package-lock.json`, not a directory escape.
 */
export const acceptanceImportBoundaryRule = {
  meta: {
    type: "problem",
    docs: {
      description: "An acceptance test may not import anything outside tests/acceptance/ (spec #145, ADR-0032).",
    },
    schema: [],
    messages: {
      outsideBoundary:
        "'{{source}}' resolves outside tests/acceptance/. Restore-from-tip only restores that " +
        "directory, so an acceptance test may not import anything outside it — duplicate the " +
        "helper inside tests/acceptance/ instead (spec #145).",
    },
  },
  create(context) {
    const boundary = acceptanceBoundaryFor(context.filename);
    if (boundary === null) return {};

    function checkSource(node, source) {
      if (typeof source !== "string" || !source.startsWith(".")) return;
      const resolved = path.resolve(path.dirname(context.filename), source);
      const rel = path.relative(boundary, resolved);
      if (rel === ".." || rel.startsWith(`..${path.sep}`)) {
        context.report({ node, messageId: "outsideBoundary", data: { source } });
      }
    }

    return {
      ImportDeclaration(node) {
        checkSource(node, node.source.value);
      },
      ImportExpression(node) {
        if (node.source.type === "Literal") checkSource(node, node.source.value);
      },
      ExportNamedDeclaration(node) {
        if (node.source) checkSource(node, node.source.value);
      },
      ExportAllDeclaration(node) {
        checkSource(node, node.source.value);
      },
      CallExpression(node) {
        if (
          node.callee.type === "Identifier" &&
          node.callee.name === "require" &&
          node.arguments.length === 1 &&
          node.arguments[0].type === "Literal"
        ) {
          checkSource(node, node.arguments[0].value);
        }
      },
    };
  },
};

export default tseslint.config(
  {
    // `.clone-gate-scan/` is the clone gate's in-repo staging tree, created and torn down while a
    // push's other checks are walking the repo (`shared/clone-gate.ts`, `stageForScan`).
    // `.claude/worktrees/` for the reason `vitest.config.ts` gives: an agent session puts a whole
    // second checkout under that path, and linting it from here finds a second `tsconfig.json`
    // — which typescript-eslint refuses outright ("multiple candidate TSConfigRootDirs").
    ignores: ["node_modules/**", "dist/**", "build/**", ".clone-gate-scan/**", ".claude/worktrees/**"],
  },
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts"],
    plugins: { sonarjs },
    languageOptions: {
      parserOptions: {
        // Pinned, because a worktree nested under `.claude/worktrees/` has this repo's root as an
        // ancestor too, so from inside one the parser sees two candidates and stops.
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Hits gh-paths.ts's `..._placeholder: unknown[]` rest param, a
      // deliberately-unused, underscore-prefixed capture of the tagged
      // template's interpolations — turned off rather than reconfigured
      // with `argsIgnorePattern`, per this ticket's zero-refactor-cost rule.
      "@typescript-eslint/no-unused-vars": "off",
      // Ratified in the standards-pass ledger (#24): three copies of the
      // same function body is a fixture nobody extracted yet, not three
      // coincidences.
      "sonarjs/no-identical-functions": ["error", 3],

      "no-restricted-syntax": ["error", INLINE_REASON_SELECTOR, ...REPO_PATH_SELECTORS],
    },
  },
  {
    // The canonical implementation of the `instanceof Error` narrowing that
    // every other call site is pointed at — the one place it's allowed to
    // exist inline.
    files: [".Workflow/agent-workflows/shared/reason.ts"],
    rules: {
      "no-restricted-syntax": "off",
    },
  },
  {
    // The canonical builder/matcher generator these paths are supposed to
    // come from — see this file's own header for why it has to spell the
    // path shapes out literally.
    files: [".Workflow/agent-workflows/shared/gh-paths.ts"],
    rules: {
      "no-restricted-syntax": "off",
    },
  },
  {
    // spec #145, Lane 04: an acceptance test may not import anything outside its own directory.
    files: ["tests/acceptance/**/*.ts"],
    plugins: {
      "acceptance-boundary": { rules: { "no-outside-import": acceptanceImportBoundaryRule } },
    },
    rules: {
      "acceptance-boundary/no-outside-import": "error",

      // The `reason(err)` selector above points every call site at one canonical implementation,
      // in `.Workflow/agent-workflows/shared/reason.ts`. This directory is forbidden from
      // importing it — that is the rule immediately above, and it is the stronger of the two, so
      // the pair as written was unsatisfiable: an acceptance test that reports an unknown error
      // had to either import across the boundary or narrow inline, and both were errors. Lane 04
      // authored #240 into exactly that corner and landed a batch nothing could lint
      // ([ADR-0102](docs/adr/0102-a-lint-rule-that-points-at-an-import-the-boundary-forbids-do.md)).
      //
      // Every other selector still holds here, so this re-declares the rule without the one that
      // cannot rather than switching it off.
      "no-restricted-syntax": ["error", ...REPO_PATH_SELECTORS],
    },
  },
);
