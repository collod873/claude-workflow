import { stages } from "./stages.ts";

export interface Part {
  name: string;
  file: string;
  stops: string;
  lines?: number;
  printsData?: true;
}

const FIXED: Part[] = [
  {
    name: "typecheck step",
    file: "tsconfig.json",
    stops: "https://github.com/collod873/claude-workflow/actions/runs/33346638810",
  },
  {
    name: "lint step",
    file: "eslint.config.js",
    stops: "https://github.com/collod873/claude-workflow/issues/360",
  },
  {
    name: "unused step",
    file: "knip.config.ts",
    stops: "https://github.com/collod873/claude-workflow/issues/183",
  },
  {
    name: "clones step",
    file: ".claude/contract.json",
    stops: "https://github.com/collod873/claude-workflow/actions/runs/34630928220",
  },
  {
    name: "test step",
    file: "vitest.config.ts",
    stops: "https://github.com/collod873/claude-workflow/actions/runs/33346638810",
  },
  {
    name: "links step",
    file: "src/part-links.ts",
    stops: "https://github.com/collod873/claude-workflow/issues/682",
  },
  {
    name: "prompts step",
    file: "src/prompt-bytes.ts",
    stops: "https://github.com/collod873/claude-workflow/issues/663",
  },
  {
    name: "written-twice step",
    file: "src/written-twice.ts",
    stops: "https://github.com/collod873/claude-workflow/issues/912",
  },
  {
    name: "buckets step",
    file: "src/buckets.ts",
    stops: "https://github.com/collod873/claude-workflow/pull/1489",
  },
  {
    name: "bin/land",
    file: "bin/land",
    stops: "https://github.com/collod873/claude-workflow/issues/652",
  },
  {
    name: "bin/session-extras",
    file: "bin/session-extras",
    stops: "https://github.com/collod873/claude-workflow/issues/869",
    lines: 3,
  },
  {
    name: "bin/file-issue",
    file: "bin/file-issue",
    stops: "https://github.com/collod873/claude-workflow/issues/662",
    lines: 6,
    printsData: true,
  },
  {
    name: "bin/enrol",
    file: "bin/enrol",
    stops: "https://github.com/collod873/claude-workflow/issues/1150",
    lines: 6,
  },
  {
    name: "bin/runner",
    file: "bin/runner",
    stops: "https://github.com/collod873/claude-workflow/issues/1257",
  },
  {
    name: "bin/mark",
    file: "bin/mark",
    stops: "https://github.com/collod873/claude-workflow/issues/835",
  },
  {
    name: "bin/github",
    file: "bin/github",
    stops: "https://github.com/collod873/claude-workflow/issues/1206",
    lines: 4,
  },
  {
    name: "bin/spelled",
    file: "bin/spelled",
    stops: "https://github.com/collod873/claude-workflow/issues/1100",
    lines: 2,
    printsData: true,
  },
  {
    name: "tickets.yml",
    file: ".github/workflows/tickets.yml",
    stops: "https://github.com/collod873/claude-workflow/issues/387",
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
    name: "rulesets step",
    file: "src/rulesets.ts",
    stops: "https://github.com/collod873/claude-workflow/issues/652",
  },
];

export const parts: Part[] = [...FIXED, ...(await stages()).map((stage) => stage.part)];
