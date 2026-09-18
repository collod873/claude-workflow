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
    name: "core/check-runner.ts",
    file: "core/check-runner.ts",
    stops: "https://github.com/collod873/claude-workflow/issues/657",
    holds: ["A test check passes only if it ran at least one test"],
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
    name: "core/bin/file-issue",
    file: "core/bin/file-issue",
    stops: "https://github.com/collod873/claude-workflow/issues/662",
    lines: 5,
    holds: [
      "A ticket has 1 to 3 criteria (a trial), each with one `check:`. At least one check runs tests. Every check is red at filing. `## Why` quotes the owner",
      "A grep or file check may sit beside a test check, never alone. A document ticket is graded against its question",
    ],
  },
  {
    name: "core/bin/start",
    file: "core/bin/start",
    stops: "https://github.com/collod873/claude-workflow/issues/662",
    lines: 5,
    holds: [
      "A ticket has 1 to 3 criteria (a trial), each with one `check:`. At least one check runs tests. Every check is red at filing. `## Why` quotes the owner",
      "A grep or file check may sit beside a test check, never alone. A document ticket is graded against its question",
      "A build starts only from fresh main, only when main is green, and not when the ticket's checks already pass there",
    ],
  },
  {
    name: "core/bin/brief",
    file: "core/bin/brief",
    stops: "https://github.com/collod873/claude-workflow/issues/539",
    holds: ["An agent is handed what it needs, so it does not explore"],
  },
  {
    name: "core/bin/test-author",
    file: "core/bin/test-author",
    stops: "https://github.com/collod873/claude-workflow/issues/663",
    holds: [
      "Tests exist before the build starts. The builder never edits them; fresh eyes may fix a wrong one, giving its reason on the PR; no push lowers the test count",
      "Tests exist before the build. The builder never edits them. The fixer may fix a wrong one, giving its reason on the PR. No push lowers the test count",
    ],
  },
  {
    name: "core/deny-list.test.ts",
    file: "core/deny-list.test.ts",
    stops: "https://github.com/collod873/claude-workflow/issues/663",
  },
  {
    name: "core/bin/app-token",
    file: "core/bin/app-token",
    stops: "https://github.com/collod873/claude-workflow/issues/652",
    holds: ["The machine acts as its GitHub App and never falls back to `GITHUB_TOKEN` where the App is needed"],
  },
  {
    name: "core/bin/machine-page",
    file: "core/bin/machine-page",
    stops: "https://github.com/collod873/claude-workflow/issues/710",
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
    name: "core/rulesets.proc.test.ts",
    file: "core/rulesets.proc.test.ts",
    stops: "https://github.com/collod873/claude-workflow/issues/652",
    holds: ["Nobody pushes to main, the owner included. Everything lands through a PR whose required checks passed on an up-to-date branch"],
  },
  {
    name: "core/stub-shape.test.ts",
    file: "core/stub-shape.test.ts",
    stops: "https://github.com/collod873/claude-workflow/issues/652",
    holds: ["A stub has one fixed shape: a trigger and a `uses:` at `@stable`"],
  },
  {
    name: "core/judged-sha.proc.test.ts",
    file: "core/judged-sha.proc.test.ts",
    stops: "https://github.com/collod873/claude-workflow/issues/652",
    holds: ["The checks that judge a PR come from the stable machine, never from the PR"],
  },
  {
    name: "core/em-dash.test.ts",
    file: "core/em-dash.test.ts",
    stops: "https://github.com/collod873/claude-workflow/issues/681",
    holds: ["Nothing the machine writes, and no doc a session loads, carries an em dash"],
  },
];
