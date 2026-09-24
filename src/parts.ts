export interface Part {
  name: string;
  file: string;
  stops: string;
  lines?: number;
}

export const parts: Part[] = [
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
    name: "src/check-runner.ts",
    file: "src/check-runner.ts",
    stops: "https://github.com/collod873/claude-workflow/issues/657",
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
    name: "bin/start",
    file: "bin/start",
    stops: "https://github.com/collod873/claude-workflow/issues/662",
    lines: 5,
  },
  {
    name: "bin/brief",
    file: "bin/brief",
    stops: "https://github.com/collod873/claude-workflow/issues/539",
  },
  {
    name: "bin/save reads outside the brief",
    file: "bin/save",
    stops: "https://github.com/collod873/claude-workflow/issues/809",
  },
  {
    name: "bin/test-author",
    file: "bin/test-author",
    stops: "https://github.com/collod873/claude-workflow/issues/663",
  },
  {
    name: "bin/build",
    file: "bin/build",
    stops: "https://github.com/collod873/claude-workflow/issues/652",
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
    name: "bin/close",
    file: "bin/close",
    stops: "https://github.com/collod873/claude-workflow/issues/808",
  },
  {
    name: "bin/review",
    file: "bin/review",
    stops: "https://github.com/collod873/claude-workflow/issues/661",
  },
  {
    name: "bin/fix",
    file: "bin/fix",
    stops: "https://github.com/collod873/claude-workflow/issues/663",
  },
  {
    name: "src/hand-off.ts",
    file: "src/hand-off.ts",
    stops: "https://github.com/collod873/claude-workflow/issues/827",
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
    name: "src/stops.proc.test.ts",
    file: "src/stops.proc.test.ts",
    stops: "https://github.com/collod873/claude-workflow/issues/663",
  },
  {
    name: "src/em-dash.proc.test.ts",
    file: "src/em-dash.proc.test.ts",
    stops: "https://github.com/collod873/claude-workflow/issues/681",
  },
];
