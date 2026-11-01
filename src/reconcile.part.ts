import { join } from "node:path";
import { BIN, execute, ghArgv, plant, scratch, script } from "./scenarios.ts";
import { declareStage } from "./stages.ts";

export const HERE = "collod873/Lumaria";
export const ELSEWHERE = "collod873/design-kit";

interface Ticket {
  number: number;
  labels: string[];
  blockers: { repo: string; number: number; state: string }[];
  timeline?: object[];
}

export type Issues = Record<string, { user: { login: string }; body: string }>;

const linked = ({ repo, number, state }: Ticket["blockers"][number]) => ({ id: number * 100, number, state, repository_url: `https://api.github.com/repos/${repo}` });

interface Dependent extends Ticket {
  repo: string;
}

export function linking({ tickets = [] as Ticket[], waiting = [] as Ticket[], closing = undefined as { number: number; blocking: Dependent[] } | undefined, alreadyLinked = false, parentless = false, refused = false, liveTitles = [] as string[], issues = {} } = {}) {
  const root = scratch("reconcile-");
  const { setup, calls } = ghArgv(join(root, "gh-argv"));
  const listed = (issues: Ticket[]) => JSON.stringify(issues.map(({ number, labels }) => ({ number, labels: labels.map((name) => ({ name })) })));
  plant(root, "listed.json", listed(tickets));
  plant(root, "waiting.json", listed(waiting));
  plant(root, "blocking.json", JSON.stringify([(closing?.blocking ?? []).map(({ repo, number, labels }) => ({ ...linked({ repo, number, state: "open" }), labels: labels.map((name) => ({ name })) }))]));
  plant(root, "live", liveTitles.join("\n"));
  const cases = [...tickets, ...waiting, ...(closing?.blocking ?? [])].flatMap(({ number, labels, blockers, timeline = [] }) => {
    plant(root, `blockers-${number}.json`, JSON.stringify([blockers.map(linked)]));
    plant(root, `timeline-${number}.json`, JSON.stringify([timeline]));
    plant(root, `labels-${number}`, labels.join("\n"));
    return [`  *"issues/${number}/timeline"*) cat "${join(root, `timeline-${number}.json`)}" ;;`, `  *"issues/${number}/dependencies/blocked_by"*) cat "${join(root, `blockers-${number}.json`)}" ;;`, `  "issue view ${number} "*) cat "${join(root, `labels-${number}`)}" ;;`];
  });
  const opened = Object.entries(issues).map(([path, issue], at) => {
    plant(root, `issue-${at}.json`, JSON.stringify(issue));
    return `  *"repos/${path}") cat "${join(root, `issue-${at}.json`)}" ;;`;
  });
  script(
    join(root, "bin", "gh"),
    [
      setup,
      'case "$*" in',
      ...(refused ? ['  *"--method POST"*) printf \'gh: Forbidden (HTTP 403)\\n\' >&2; exit 1 ;;', '  *"issue edit"*) printf \'gh: Forbidden (HTTP 403)\\n\' >&2; exit 1 ;;'] : []),
      `  "run list"*"--status queued"*) cat "${join(root, "live")}" ;;`,
      `  "issue list"*"--label waiting "*) cat "${join(root, "waiting.json")}" ;;`,
      ...(closing === undefined ? [] : [`  *"issues/${closing.number}/dependencies/blocking"*) cat "${join(root, "blocking.json")}" ;;`]),
      ...(alreadyLinked ? ['  *"--method POST"*"blocked_by"*) printf \'gh: An error occurred while adding the blocking issue to the issue. Validation failed: Target issue has already been taken (HTTP 422)\\n\' >&2; exit 1 ;;'] : []),
      `  "issue list"*) cat "${join(root, "listed.json")}" ;;`,
      ...cases,
      ...opened,
      `  *"/parent") ${parentless ? "printf 'gh: Not Found (HTTP 404)\\n' >&2; exit 1" : `printf '%s' '${JSON.stringify(linked({ repo: ELSEWHERE, number: 12, state: "open" }))}'`} ;;`,
      '  *"--jq .id") printf \'4242\\n\' ;;',
      "esac",
      "",
    ].join("\n"),
  );
  const env = { PATH: `${join(root, "bin")}:${process.env.PATH}`, GH_RETRY_SECONDS: "0" };
  return {
    calls,
    reconcile: (...args: string[]) => execute(join(BIN, "reconcile"), root, env, ["--repo", HERE, ...args]),
    links: (...args: string[]) => execute(join(BIN, "issue-links"), root, env, args),
  };
}

declareStage({
  part: { name: "bin/reconcile", file: "bin/reconcile", stops: "https://github.com/collod873/claude-workflow/issues/1606" },
  scenarios: [
    { label: "waking a ticket whose blockers closed", run: () => linking({ tickets: [{ number: 931, labels: ["ticket", "waiting"], blockers: [{ repo: ELSEWHERE, number: 7, state: "closed" }] }] }).reconcile() },
    { label: "restarting a stale build", run: () => linking({ tickets: [{ number: 931, labels: ["ticket", "building"], blockers: [], timeline: [{ event: "labeled", label: { name: "building" }, created_at: "2026-01-01T00:00:00Z" }] }] }).reconcile() },
    { label: "with the label edit refused", run: () => linking({ refused: true, tickets: [{ number: 931, labels: ["ticket"], blockers: [{ repo: ELSEWHERE, number: 7, state: "open" }] }] }).reconcile() },
  ],
});

declareStage({
  part: { name: "bin/issue-links", file: "bin/issue-links", stops: "https://github.com/collod873/claude-workflow/issues/1606" },
  scenarios: [
    { label: "adding a blocker in another repo", run: () => linking().links("add-blocker", HERE, "931", ELSEWHERE, "7") },
    { label: "with the link refused", run: () => linking({ refused: true }).links("add-parent", HERE, "931", ELSEWHERE, "12") },
  ],
});
