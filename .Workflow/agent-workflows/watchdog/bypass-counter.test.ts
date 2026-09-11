import { expect, test } from "vitest";
import { runBypassCounter, type BypassCounterOutcome } from "./bypass-counter";

const HOUR = 60 * 60 * 1000;
const CARRIER_MARKER = "<!-- bypass-counter:4 -->";

function failedRunsOnMain(): string {
  const now = Date.now();
  return JSON.stringify(
    Array.from({ length: 48 }, (_, index) => ({
      id: 5000 + index,
      conclusion: "failure",
      html_url: `https://github.com/collod873/claude-workflow/actions/runs/${5000 + index}`,
      head_branch: "main",
      created_at: new Date(now - index * 6 * HOUR).toISOString(),
    })),
  );
}

const FAILED_JOB = JSON.stringify({
  jobs: [{ steps: [{ name: "gauntlet", conclusion: "failure" }] }],
});

const AGED_OUT_CARRIER = JSON.stringify([
  { number: 131, body: CARRIER_MARKER, state: "CLOSED", stateReason: "NOT_PLANNED" },
]);

const NEWEST_WINDOW = JSON.stringify(
  Array.from({ length: 5 }, (_, index) => ({
    number: 401 + index,
    body: "a recent issue that carries no counter marker",
    state: "OPEN",
    stateReason: null,
  })),
);

function countBypasses(calls: string[][]): BypassCounterOutcome {
  return runBypassCounter({
    gh: (argv: string[]): string => {
      calls.push(argv);
      if (argv[0] === "api" && argv.includes("--jq")) return failedRunsOnMain();
      if (argv[0] === "api") return FAILED_JOB;
      if (argv[0] === "issue" && argv[1] === "list") {
        const byMarker =
          argv.some((arg) => arg.startsWith("--search")) && argv.join(" ").includes("bypass-counter");
        return byMarker ? AGED_OUT_CARRIER : NEWEST_WINDOW;
      }
      if (argv[0] === "issue" && argv[1] === "create") {
        return "https://github.com/collod873/claude-workflow/issues/414\n";
      }
      throw new Error(`unexpected gh call: ${argv.join(" ")}`);
    },
    assignee: "collod873",
    verifyWorkflow: "verify-caller.yml",
    log: () => undefined,
  });
}

test.fails(
  "#461.1: a not planned carrier absent from the newest 200 issues still returns declined-for-good",
  () => {
    const outcome = countBypasses([]);

    expect(outcome.code).toBe("declined-for-good");
    expect(outcome.wrote).toBeUndefined();
    expect(outcome.issue).toBeUndefined();
  },
);

test.fails(
  "#461.2: the gh issue list call carries a --search on the carrier marker and no --limit 200 remains",
  () => {
    const calls: string[][] = [];
    countBypasses(calls);

    const lists = calls.filter((argv) => argv[0] === "issue" && argv[1] === "list");
    expect(lists.length).toBeGreaterThan(0);

    const searches = lists.filter((argv) => argv.some((arg) => arg.startsWith("--search")));
    expect(searches.length).toBeGreaterThan(0);
    expect(searches.every((argv) => argv.join(" ").includes("bypass-counter"))).toBe(true);
    expect(lists.every((argv) => !argv.join(" ").includes("--limit 200"))).toBe(true);
  },
);
