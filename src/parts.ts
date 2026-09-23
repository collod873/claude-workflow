export interface Part {
  name: string;
  file: string;
  stops: string;
  holds?: string[];
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
    holds: ["A port ships in the same ticket as its first caller"],
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
    holds: ["A test check passes only if it ran at least one test"],
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
    name: "bin/file-issue",
    file: "bin/file-issue",
    stops: "https://github.com/collod873/claude-workflow/issues/662",
    lines: 5,
    holds: [
      "A ticket has 1 to 3 criteria (a trial), each with one `check:`. At least one check runs tests. Every check is red at filing. `## Why` quotes the owner",
      "Checks test the behaviour meant, not a stand-in like a file or a text match",
    ],
  },
  {
    name: "bin/start",
    file: "bin/start",
    stops: "https://github.com/collod873/claude-workflow/issues/662",
    lines: 5,
    holds: [
      "A ticket has 1 to 3 criteria (a trial), each with one `check:`. At least one check runs tests. Every check is red at filing. `## Why` quotes the owner",
      "Checks test the behaviour meant, not a stand-in like a file or a text match",
      "A build starts only from fresh main, only when main is green, and not when the ticket's checks already pass there",
    ],
  },
  {
    name: "bin/brief",
    file: "bin/brief",
    stops: "https://github.com/collod873/claude-workflow/issues/539",
    holds: ["An agent is handed what it needs, so it does not explore"],
  },
  {
    name: "bin/save reads outside the brief",
    file: "bin/save",
    stops: "https://github.com/collod873/claude-workflow/issues/809",
    holds: ["An agent is handed what it needs, so it does not explore"],
  },
  {
    name: "bin/test-author",
    file: "bin/test-author",
    stops: "https://github.com/collod873/claude-workflow/issues/663",
    holds: [
      "Tests exist before the build starts. The builder never edits them; the fixer may fix a wrong one, giving its reason on the PR; no push lowers the test count",
    ],
  },
  {
    name: "bin/build",
    file: "bin/build",
    stops: "https://github.com/collod873/claude-workflow/issues/652",
    holds: [
      "Tests exist before the build starts. The builder never edits them; the fixer may fix a wrong one, giving its reason on the PR; no push lowers the test count",
    ],
  },
  {
    name: "bin/save",
    file: "bin/save",
    stops: "https://github.com/collod873/claude-workflow/issues/649",
    holds: ["Work is never thrown away: the branch is pushed before anything can refuse it"],
  },
  {
    name: "build.yml",
    file: ".github/workflows/build.yml",
    stops: "https://github.com/collod873/claude-workflow/issues/826",
    holds: ["Work is never thrown away: the branch is pushed before anything can refuse it"],
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
    holds: [
      "Done means the ticket's checks pass on the merge commit on main, run by something that did not build it",
      "A ticket goes from filing to merged in under an hour, and its longest wait is named; speed is reported, never a gate",
    ],
  },
  {
    name: "bin/review",
    file: "bin/review",
    stops: "https://github.com/collod873/claude-workflow/issues/661",
    holds: ["Every green build is read against `## Why` before it merges"],
  },
  {
    name: "bin/fix",
    file: "bin/fix",
    stops: "https://github.com/collod873/claude-workflow/issues/663",
    holds: ["The fixer gets one turn per ticket and never edits the owner's quoted words"],
  },
  {
    name: "src/hand-off.ts",
    file: "src/hand-off.ts",
    stops: "https://github.com/collod873/claude-workflow/issues/827",
    holds: ["The owner is never the one who fixes a stuck run"],
  },
  {
    name: "bin/machine-page",
    file: "bin/machine-page",
    stops: "https://github.com/collod873/claude-workflow/issues/710",
  },
  {
    name: "src/growth-limits.proc.test.ts",
    file: "src/growth-limits.proc.test.ts",
    stops: "https://github.com/collod873/claude-workflow/issues/399",
    holds: [
      "A part is added, or kept at its layer ruling, only for a failure that happened",
      "The whole machine fits on one generated screen; adding means fitting",
      "A part is fired by a real event, never a timer",
    ],
  },
  {
    name: "src/says-little.proc.test.ts",
    file: "src/says-little.proc.test.ts",
    stops: "https://github.com/collod873/claude-workflow/issues/680",
    holds: ["A message is one line of 200 characters, the rest in a log it names; a part that is not a hook may be registered for up to 5 such lines. Documents (tickets, specs, briefs, judgements) meet their own kind's limit"],
  },
  {
    name: "src/loaded-docs.proc.test.ts",
    file: "src/loaded-docs.proc.test.ts",
    stops: "https://github.com/collod873/claude-workflow/issues/663",
    holds: ["The docs every session loads never grow in total; adding a line means cutting one, except in a page the owner signs"],
  },
  {
    name: "src/rulesets.proc.test.ts",
    file: "src/rulesets.proc.test.ts",
    stops: "https://github.com/collod873/claude-workflow/issues/652",
    holds: ["Nobody pushes to main, the owner included. Everything lands through a PR whose required checks passed on an up-to-date branch"],
  },
  {
    name: "src/stops.proc.test.ts",
    file: "src/stops.proc.test.ts",
    stops: "https://github.com/collod873/claude-workflow/issues/663",
    holds: ["The owner is never the one who fixes a stuck run"],
  },
  {
    name: "src/em-dash.proc.test.ts",
    file: "src/em-dash.proc.test.ts",
    stops: "https://github.com/collod873/claude-workflow/issues/681",
    holds: ["Nothing the machine writes, and nothing this repo tracks, carries an em dash"],
  },
];
