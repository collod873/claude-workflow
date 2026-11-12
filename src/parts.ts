import { partFiles } from "./part-files.ts";

export interface Part {
  name: string;
  file: string;
  stops: string;
  lines?: number;
  printsData?: true;
  clock?: true;
}

const FIXED: Part[] = [
  {
    name: "typecheck step",
    file: ".claude/contract.json",
    stops: "https://github.com/collod873/claude-workflow/actions/runs/33346638810",
  },
  {
    name: "lint step",
    file: ".claude/contract.json",
    stops: "https://github.com/collod873/claude-workflow/issues/360",
  },
  {
    name: "unused step",
    file: "knip.config.ts",
    stops: "https://github.com/collod873/claude-workflow/issues/183",
  },
  {
    name: "clones rule",
    file: ".github/workflows/check.yml",
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

export const parts: Part[] = [...FIXED, ...(await partFiles()).map((partFile) => partFile.part)];
