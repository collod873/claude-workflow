import { stages } from "./stages.ts";

export interface Part {
  name: string;
  file: string;
  stops: string;
  lines?: number;
}

const FIXED: Part[] = [
  {
    name: "bin/check",
    file: "bin/check",
    stops: "https://github.com/collod873/claude-workflow/issues/652",
  },
  {
    name: "bin/check typecheck",
    file: "tsconfig.json",
    stops: "https://github.com/collod873/claude-workflow/actions/runs/33346638810",
  },
  {
    name: "bin/check lint",
    file: "eslint.config.js",
    stops: "https://github.com/collod873/claude-workflow/issues/360",
  },
  {
    name: "bin/check unused",
    file: "knip.config.ts",
    stops: "https://github.com/collod873/claude-workflow/issues/183",
  },
  {
    name: "bin/check clones",
    file: "bin/check",
    stops: "https://github.com/collod873/claude-workflow/actions/runs/34630928220",
  },
  {
    name: "bin/check test",
    file: "vitest.config.ts",
    stops: "https://github.com/collod873/claude-workflow/actions/runs/33346638810",
  },
  {
    name: "bin/check links",
    file: "src/part-links.ts",
    stops: "https://github.com/collod873/claude-workflow/issues/682",
  },
  {
    name: "bin/check prompts",
    file: "src/prompt-bytes.ts",
    stops: "https://github.com/collod873/claude-workflow/issues/663",
  },
  {
    name: "bin/check written twice",
    file: "src/written-twice.ts",
    stops: "https://github.com/collod873/claude-workflow/issues/912",
  },
  {
    name: "src/prose.proc.test.ts",
    file: "src/prose.proc.test.ts",
    stops: "https://github.com/collod873/claude-workflow/issues/335",
  },
  {
    name: "bin/land",
    file: "bin/land",
    stops: "https://github.com/collod873/claude-workflow/issues/652",
  },
  {
    name: "bin/session",
    file: "bin/session",
    stops: "https://github.com/collod873/claude-workflow/issues/869",
    lines: 3,
  },
  {
    name: "bin/file-issue",
    file: "bin/file-issue",
    stops: "https://github.com/collod873/claude-workflow/issues/662",
    lines: 5,
  },
  {
    name: "bin/save",
    file: "bin/save",
    stops: "https://github.com/collod873/claude-workflow/issues/649",
  },
  {
    name: "build.yml",
    file: ".github/workflows/build.yml",
    stops: "https://github.com/collod873/claude-workflow/issues/826",
  },
  {
    name: "bin/mark",
    file: "bin/mark",
    stops: "https://github.com/collod873/claude-workflow/issues/835",
  },
  {
    name: "bin/spelled",
    file: "bin/spelled",
    stops: "https://github.com/collod873/claude-workflow/issues/1100",
  },
  {
    name: "bin/close-note",
    file: "bin/close-note",
    stops: "https://github.com/collod873/claude-workflow/issues/879",
  },
  {
    name: "fix.yml",
    file: ".github/workflows/fix.yml",
    stops: "https://github.com/collod873/claude-workflow/actions/runs/36086791587",
  },
  {
    name: "src/growth-limits.proc.test.ts",
    file: "src/growth-limits.proc.test.ts",
    stops: "https://github.com/collod873/claude-workflow/issues/399",
  },
  {
    name: "src/says-little.proc.test.ts",
    file: "src/says-little.proc.test.ts",
    stops: "https://github.com/collod873/claude-workflow/issues/680",
  },
  {
    name: "src/loaded-docs.proc.test.ts",
    file: "src/loaded-docs.proc.test.ts",
    stops: "https://github.com/collod873/claude-workflow/issues/663",
  },
  {
    name: "src/rulesets.proc.test.ts",
    file: "src/rulesets.proc.test.ts",
    stops: "https://github.com/collod873/claude-workflow/issues/652",
  },
  {
    name: "src/em-dash.proc.test.ts",
    file: "src/em-dash.proc.test.ts",
    stops: "https://github.com/collod873/claude-workflow/issues/681",
  },
];

export const parts: Part[] = [...FIXED, ...(await stages()).map((stage) => stage.part)];
