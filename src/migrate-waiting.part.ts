import { join } from "node:path";
import { BIN, execute, ghArgv, plant, scratch, script } from "./scenarios.ts";
import { declareStage } from "./stages.ts";

export const HERE = "collod873/Lumaria";
export const MACHINE = "collod873/claude-workflow";
export const KIT = "collod873/design-kit";

interface Waiting {
  number: number;
  body: string;
  comments: string[];
  blockers?: { repo: string; number: number }[];
}

const linked = ({ repo, number }: { repo: string; number: number }) => ({ id: number * 100, number, state: "open", repository_url: `https://api.github.com/repos/${repo}` });

export function migrating({ waiting = [] as Waiting[], parented = [] as string[] } = {}) {
  const root = scratch("migrate-waiting-");
  const { setup, calls } = ghArgv(join(root, "gh-argv"));
  plant(root, "listed.json", JSON.stringify(waiting.map(({ number, body }) => ({ number, body }))));
  const cases = waiting.flatMap(({ number, comments, blockers = [] }) => {
    plant(root, `comments-${number}.json`, JSON.stringify([comments.map((body) => ({ body }))]));
    plant(root, `blockers-${number}.json`, JSON.stringify([blockers.map(linked)]));
    return [`  *"repos/${HERE}/issues/${number}/comments"*) cat "${join(root, `comments-${number}.json`)}" ;;`, `  *"repos/${HERE}/issues/${number}/dependencies/blocked_by") cat "${join(root, `blockers-${number}.json`)}" ;;`];
  });
  const parents = parented.map((at) => `  *"repos/${at.replace("#", "/issues/")}/parent") printf '%s' '${JSON.stringify(linked({ repo: HERE, number: 1 }))}' ;;`);
  script(
    join(root, "bin", "gh"),
    [
      setup,
      'case "$*" in',
      `  "issue list"*) cat "${join(root, "listed.json")}" ;;`,
      ...cases,
      ...parents,
      `  *"/parent") printf 'gh: Not Found (HTTP 404)\\n' >&2; exit 1 ;;`,
      '  *"--jq .id") printf \'4242\\n\' ;;',
      "esac",
      "",
    ].join("\n"),
  );
  const env = { PATH: `${join(root, "bin")}:${process.env.PATH}`, GH_RETRY_SECONDS: "0" };
  return { calls, migrate: () => execute(join(BIN, "migrate-waiting"), root, env, [HERE]) };
}

declareStage({
  part: { name: "bin/migrate-waiting", file: "bin/migrate-waiting", stops: "https://github.com/collod873/claude-workflow/issues/1606" },
  scenarios: [{ label: "converting a ticket parked in prose", run: () => migrating({ waiting: [{ number: 931, body: "## Why\n\nx\n", comments: ["The builder of #931 found it depends on #5, still open. y"] }] }).migrate() }],
});
