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

/**
 * The inline `err instanceof Error ? err.message : String(err)` narrowing, pointed at the one
 * canonical implementation in `shared/reason.ts`. Named so the rule reads as a list of the things
 * it forbids, each with the reason it does.
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
 * Hand-written GitHub REST paths, in the two forms they can take — a template literal and a regex
 * literal — both pointed at `shared/gh-paths.ts`.
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

export default tseslint.config(
  {
    // `.claude/worktrees/` for the reason `vitest.config.ts` gives: an agent session puts a whole
    // second checkout under that path, and linting it from here finds a second `tsconfig.json`
    // — which typescript-eslint refuses outright ("multiple candidate TSConfigRootDirs").
    ignores: ["node_modules/**", "dist/**", "build/**", ".claude/worktrees/**"],
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
    // The three test shapes #360's audit found producing the sprawl, as lint errors rather than a
    // review note: 104 `readFileSync` sites asserting on tracked text, 21 local fake `gh`s beside a
    // shared one, and tests that drove tsc, eslint or the suite as a subprocess. A test that must
    // spawn a process — a hook, a CLI, whose contract *is* its exit code — says so in its name:
    // `*.proc.test.ts`, which is the one place `node:child_process` may be imported from a test.
    files: ["**/*.test.ts"],
    ignores: ["**/*.proc.test.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "node:child_process",
              message:
                "A test that drives a process is named *.proc.test.ts. Everything else imports its subject " +
                "and calls it (#360).",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["**/*.test.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        INLINE_REASON_SELECTOR,
        ...REPO_PATH_SELECTORS,
        {
          // `readFileSync(join(REPO_ROOT, …))`, `readFileSync(new URL("../x.md", import.meta.url))`,
          // and any literal naming a workflow, a doc, a prompt or a bin/ script.
          selector:
            "CallExpression[callee.name='readFileSync'] :matches(" +
            "Identifier[name='REPO_ROOT'], " +
            "MemberExpression[object.type='MetaProperty'][property.name='dirname'], " +
            "MemberExpression[object.type='MetaProperty'][property.name='url'], " +
            "Literal[value=/\\.github\\/|\\.md$|\\.ya?ml$|(^|\\/)bin\\//], " +
            "TemplateElement[value.raw=/\\.github\\/|\\.md|\\.ya?ml|(^|\\/)bin\\//])",
          message:
            "A test may not read tracked source, YAML or Markdown as text. Import the constant the " +
            "subject exports, or add the fact to LANE_WIRING (shared/lane-wiring.ts) (#360).",
        },
        {
          selector:
            ":matches(FunctionDeclaration, VariableDeclarator)[id.name=/^(fakeGh|createFakeGh|stubGh|makeGh)$/]",
          message:
            "One fake gh: import createFakeGh/createRecordingGh from shared/gh.fake.ts or stubGh from " +
            "shared/stub-gh.fixture.ts, and do not name the result fakeGh (#360).",
        },
      ],
    },
  },
  {
    // The size fence itself (#360): the one test that reads gate files as text, and it reads only
    // their length. Every other restricted shape above still applies to it.
    files: [".claude/gate-size.test.ts"],
    rules: {
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
);
