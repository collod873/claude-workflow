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
    printsData: true,
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
    name: "src/rulesets.proc.test.ts",
    file: "src/rulesets.proc.test.ts",
    stops: "https://github.com/collod873/claude-workflow/issues/652",
  },
];

export const parts: Part[] = [...FIXED, ...(await stages()).map((stage) => stage.part)];
