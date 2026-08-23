// @ts-check
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

export default tseslint.config(
  {
    ignores: ["node_modules/**", "dist/**", "build/**"],
  },
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts"],
    plugins: { sonarjs },
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

      "no-restricted-syntax": [
        "error",
        {
          selector:
            "ConditionalExpression[test.type='BinaryExpression'][test.operator='instanceof'][test.right.name='Error']",
          message:
            "Use reason(err) from .Workflow/agent-workflows/shared/reason.ts instead of " +
            "inline `err instanceof Error ? err.message : String(err)` narrowing.",
        },
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
      ],
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
);
