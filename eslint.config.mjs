import { typescript } from "./lint/typescript/index.mjs";

export default [
  ...typescript({ root: import.meta.dirname }),
  {
    name: "workflow/builder-borrows-only-the-handoff",
    files: ["src/builder.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "./reviewer.ts",
              allowImportNames: ["reviewedAndLanded"],
              message: "The builder hands its green build to the reviewer and borrows nothing else from it, so a change to one leaves the other alone (#1121, ADR-0012).",
            },
          ],
        },
      ],
    },
  },
];
