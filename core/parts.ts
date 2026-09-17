export interface Part {
  name: string;
  file: string;
  stops: string;
  holds?: string[];
  lines?: number;
}

export const parts: Part[] = [
  {
    name: "core/check",
    file: "core/check",
    stops: "https://github.com/collod873/claude-workflow/issues/652",
  },
  {
    name: "core/check typecheck",
    file: "core/tsconfig.json",
    stops: "https://github.com/collod873/claude-workflow/actions/runs/33346638810",
  },
  {
    name: "core/check lint",
    file: "core/eslint.config.js",
    stops: "https://github.com/collod873/claude-workflow/issues/360",
  },
  {
    name: "core/check unused",
    file: "core/knip.config.ts",
    stops: "https://github.com/collod873/claude-workflow/issues/183",
  },
  {
    name: "core/check clones",
    file: "core/check",
    stops: "https://github.com/collod873/claude-workflow/actions/runs/34630928220",
  },
  {
    name: "core/check test",
    file: "core/vitest.config.ts",
    stops: "https://github.com/collod873/claude-workflow/actions/runs/33346638810",
  },
  {
    name: "core/check links",
    file: "core/part-links.ts",
    stops: "https://github.com/collod873/claude-workflow/issues/682",
  },
  {
    name: "core/old-machine-boundary.test.ts",
    file: "core/old-machine-boundary.test.ts",
    stops: "https://github.com/collod873/claude-workflow/pull/634",
  },
  {
    name: "core/prose.test.ts",
    file: "core/prose.test.ts",
    stops: "https://github.com/collod873/claude-workflow/issues/335",
  },
  {
    name: "core/bin/land",
    file: "core/bin/land",
    stops: "https://github.com/collod873/claude-workflow/issues/652",
  },
  {
    name: "core/growth-limits.proc.test.ts",
    file: "core/growth-limits.proc.test.ts",
    stops: "https://github.com/collod873/claude-workflow/issues/399",
    holds: [
      "Every rule on this page names an enforcer that exists",
      "The whole machine fits on one generated screen; adding means fitting",
      "A part is fired by a real event, never a timer",
    ],
  },
  {
    name: "core/says-little.proc.test.ts",
    file: "core/says-little.proc.test.ts",
    stops: "https://github.com/collod873/claude-workflow/issues/680",
    holds: ["A message is one line of 200 characters, the rest in a log it names; a part that is not a hook may be registered for up to 5 such lines. Documents (tickets, specs, briefs, judgements) meet their own kind's limit"],
  },
  {
    name: "core/loaded-docs.proc.test.ts",
    file: "core/loaded-docs.proc.test.ts",
    stops: "https://github.com/collod873/claude-workflow/issues/663",
    holds: ["The docs every session loads never grow in total; adding a line means cutting one, except in a page the owner signs"],
  },
  {
    name: "core/em-dash.test.ts",
    file: "core/em-dash.test.ts",
    stops: "https://github.com/collod873/claude-workflow/issues/681",
    holds: ["Nothing the machine writes, and no doc a session loads, carries an em dash"],
  },
];
