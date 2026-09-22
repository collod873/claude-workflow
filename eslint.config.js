import tseslint from "typescript-eslint";
import sonarjs from "eslint-plugin-sonarjs";

export default tseslint.config(
  { ignores: [".claude/**", "docs/**"] },
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts"],
    plugins: { sonarjs },
    rules: {
      "@typescript-eslint/no-unused-vars": "off",
      "sonarjs/no-identical-functions": ["error", 3],
      quotes: ["error", "double", { avoidEscape: true }],
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
              message: "A test that drives a process is named *.proc.test.ts. Everything else imports its subject and calls it (#360).",
            },
          ],
        },
      ],
    },
  },
);
