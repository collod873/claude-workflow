import { ghRead } from "./post.ts";

export interface ChecksWait {
  repo: string;
  count: number;
  afterRepo: string;
  sha: string;
}

const REPO = "[\\w.-]+\\/[\\w.-]+";
const WAIT = `(\\d+) full checks of (${REPO}) after (${REPO})@([0-9a-f]{7,40})`;
const WAITS_ON = "Waits on";
const WAITED_ON = "Waited on";
const WAITS = new RegExp(`^${WAITS_ON} ${WAIT}\\.$`, "m");
const WAITED = new RegExp(`^${WAITED_ON} ${WAIT}: .*$`, "m");
const ANY_WAIT = new RegExp(`\\n*^(?:${WAITS_ON}|${WAITED_ON}) ${WAIT}(?:\\.|: .*)$`, "gm");
const CI_WORKFLOW = "ci.yml";
const LEDGER_ARTIFACT = "check-logs";

export const checksNamed = ({ repo, count, afterRepo, sha }: ChecksWait) => `${count} full checks of ${repo} after ${afterRepo}@${sha}`;

export const waitsLine = (wait: ChecksWait) => `${WAITS_ON} ${checksNamed(wait)}.`;

export const waitedLine = (wait: ChecksWait, runs: number[]) =>
  `${WAITED_ON} ${checksNamed(wait)}: runs ${runs.join(", ")}. Each run's \`${LEDGER_ARTIFACT}\` artifact holds its check's ledger rows: \`gh run download <run> --repo ${wait.repo} --name ${LEDGER_ARTIFACT}\`.`;

export function checksWaitOf(body: string): ChecksWait | undefined {
  const [, count, repo, afterRepo, sha] = WAITS.exec(body) ?? [];
  return repo === undefined || afterRepo === undefined || sha === undefined ? undefined : { repo, count: Number(count), afterRepo, sha };
}

export const waitedOf = (body: string): boolean => WAITED.test(body);

const withoutWait = (body: string): string => body.replace(ANY_WAIT, "").trimEnd();

export const withWait = (body: string, wait: ChecksWait): string => `${withoutWait(body)}\n\n${waitsLine(wait)}\n`;

const ids = (path: string, jq: string, line: string): Set<number> =>
  new Set(
    ghRead(["api", "--paginate", path, "--jq", jq], line)
      .split("\n")
      .filter((id) => id !== "")
      .map(Number),
  );

function landedAt({ afterRepo, sha }: ChecksWait): string {
  return ghRead(["api", `repos/${afterRepo}/commits/${sha}`, "--jq", ".commit.committer.date"], `${afterRepo}@${sha} could not be read`);
}

export function checkedRuns(wait: ChecksWait): number[] {
  const since = landedAt(wait);
  const unread = `the full checks ${wait.repo} ran after ${wait.afterRepo}@${wait.sha} could not be read`;
  const started = ids(`repos/${wait.repo}/actions/workflows/${CI_WORKFLOW}/runs?created=>=${since}&per_page=100`, ".workflow_runs[].id", unread);
  const ledgered = ids(`repos/${wait.repo}/actions/artifacts?name=${LEDGER_ARTIFACT}&per_page=100`, ".artifacts[].workflow_run.id", unread);
  return [...started].filter((run) => ledgered.has(run)).sort((one, other) => one - other);
}
