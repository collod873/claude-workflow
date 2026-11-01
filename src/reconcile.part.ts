import { join } from "node:path";
import { BIN, execute, ghArgv, plant, scratch, script } from "./scenarios.ts";
import { declareStage } from "./stages.ts";

export const HERE = "collod873/Lumaria";
export const ELSEWHERE = "collod873/design-kit";

interface Ticket {
  number: number;
  labels: string[];
  blockers: { repo: string; number: number; state: string }[];
}

const linked = ({ repo, number, state }: Ticket["blockers"][number]) => ({ id: number * 100, number, state, repository_url: `https://api.github.com/repos/${repo}` });

export function linking({ tickets = [] as Ticket[], parentless = false, refused = false } = {}) {
  const root = scratch("reconcile-");
  const { setup, calls } = ghArgv(join(root, "gh-argv"));
  plant(root, "listed.json", JSON.stringify(tickets.map(({ number, labels }) => ({ number, labels: labels.map((name) => ({ name })) }))));
  const cases = tickets.flatMap(({ number, labels, blockers }) => {
    plant(root, `blockers-${number}.json`, JSON.stringify([blockers.map(linked)]));
    plant(root, `labels-${number}`, labels.join("\n"));
    return [`  *"issues/${number}/dependencies/blocked_by"*) cat "${join(root, `blockers-${number}.json`)}" ;;`, `  "issue view ${number} "*) cat "${join(root, `labels-${number}`)}" ;;`];
  });
  script(
    join(root, "bin", "gh"),
    [
      setup,
      'case "$*" in',
      ...(refused ? ['  *"--method POST"*) printf \'gh: Forbidden (HTTP 403)\\n\' >&2; exit 1 ;;', '  *"issue edit"*) printf \'gh: Forbidden (HTTP 403)\\n\' >&2; exit 1 ;;'] : []),
      `  "issue list"*) cat "${join(root, "listed.json")}" ;;`,
      ...cases,
      `  *"/parent") ${parentless ? "printf 'gh: Not Found (HTTP 404)\\n' >&2; exit 1" : `printf '%s' '${JSON.stringify(linked({ repo: ELSEWHERE, number: 12, state: "open" }))}'`} ;;`,
      '  *"--jq .id") printf \'4242\\n\' ;;',
      "esac",
      "",
    ].join("\n"),
  );
  const env = { PATH: `${join(root, "bin")}:${process.env.PATH}`, GH_RETRY_SECONDS: "0" };
  return {
    calls,
    reconcile: () => execute(join(BIN, "reconcile"), root, env, ["--repo", HERE]),
    links: (...args: string[]) => execute(join(BIN, "issue-links"), root, env, args),
  };
}

declareStage({
  part: { name: "bin/reconcile", file: "bin/reconcile", stops: "https://github.com/collod873/claude-workflow/issues/1606" },
  scenarios: [
    { label: "waking a ticket whose blockers closed", run: () => linking({ tickets: [{ number: 931, labels: ["ticket", "waiting"], blockers: [{ repo: ELSEWHERE, number: 7, state: "closed" }] }] }).reconcile() },
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
