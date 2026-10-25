import { pinnedTools } from "./tools.mjs";

const sharedTools = Object.keys(pinnedTools);

export const knipBase = Object.freeze({
  entry: [
    "src/app/**/*.{ts,tsx}",
    "bin/*",
    "bin/lib/*.mjs",
    "scripts/*.{mjs,ts}",
    ".claude/hooks/*.mjs",
    ".railway/*.ts",
    "src/features/*/index.ts",
    "src/features/*/permissions.catalog.ts",
    "kit/**/*.{ts,tsx,css,mjs}",
  ],
  project: [
    "src/**/*.{ts,tsx,css}",
    "scripts/**/*.{mjs,ts}",
    "bin/**/*.mjs",
    ".claude/hooks/**/*.mjs",
    ".railway/*.ts",
    "kit/**/*.{ts,tsx,css,mjs}",
  ],
  ignore: ["shared/**"],
  ignoreDependencies: [...new Set(sharedTools)],
  ignoreIssues: {
    "src/lib/tokens.ts": ["exports"],
    "src/server/db/schema/_shared.ts": ["exports"],
  },
});
