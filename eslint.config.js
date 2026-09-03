import tseslint from "typescript-eslint";
import sonarjs from "eslint-plugin-sonarjs";

const repoPathSelectorMessage =
  "Hand-written GitHub REST paths under repos/{owner}/{repo}/... must be built through " +
  "or matched against .Workflow/agent-workflows/shared/gh-paths.ts, not inlined or hand-rolled.";

const INLINE_REASON_SELECTOR = {
  selector:
    "ConditionalExpression[test.type='BinaryExpression'][test.operator='instanceof'][test.right.name='Error']",
  message:
    "Use reason(err) — or errorMessage(err) when you are matching on the failure rather " +
    "than reporting it — from .Workflow/agent-workflows/shared/reason.ts instead of " +
    "inline `err instanceof Error ? err.message : String(err)` narrowing.",
};

const REPO_PATH_SELECTORS = [
  {
    selector: "TemplateElement[value.raw=/repos\\/\\{owner\\}\\/\\{repo\\}/]",
    message: repoPathSelectorMessage,
  },
  {
    selector:
      "Literal[regex.pattern=/repos\\\\\\/\\\\?\\{?owner\\\\?\\}?\\\\\\/\\\\?\\{?repo\\\\?\\}?/]",
    message: repoPathSelectorMessage,
  },
];

export default tseslint.config(
  {
    ignores: ["node_modules/**", "dist/**", "build/**", ".claude/worktrees/**"],
  },
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts"],
    plugins: { sonarjs },
    languageOptions: {
      parserOptions: {
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": "off",
      "sonarjs/no-identical-functions": ["error", 3],

      "no-restricted-syntax": ["error", INLINE_REASON_SELECTOR, ...REPO_PATH_SELECTORS],
    },
  },
  {
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
    files: [".claude/gate-size.test.ts"],
    rules: {
      "no-restricted-syntax": ["error", INLINE_REASON_SELECTOR, ...REPO_PATH_SELECTORS],
    },
  },
  {
    files: [".Workflow/agent-workflows/shared/reason.ts"],
    rules: {
      "no-restricted-syntax": "off",
    },
  },
  {
    files: [".Workflow/agent-workflows/shared/gh-paths.ts"],
    rules: {
      "no-restricted-syntax": "off",
    },
  },
);
