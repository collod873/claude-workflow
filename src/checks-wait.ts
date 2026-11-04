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
const PUSHED = "pushed";
const UNMERGED = "unmerged";
const MERGED_AT = `if length == 0 then "${PUSHED}" else ([.[] | select(.merged_at != null and .base.ref == .base.repo.default_branch) | .merged_at] | min // "${UNMERGED}") end`;

function landedAt({ afterRepo, sha }: ChecksWait): string | undefined {
  const unread = `${afterRepo}@${sha} could not be read`;
  const merged = ghRead(["api", `repos/${afterRepo}/commits/${sha}/pulls`, "--jq", MERGED_AT], unread);
  if (merged === UNMERGED) return undefined;
  return merged === PUSHED ? ghRead(["api", `repos/${afterRepo}/commits/${sha}`, "--jq", ".commit.committer.date"], unread) : merged;
}

export function checkedRuns(wait: ChecksWait): number[] {
  const since = landedAt(wait);
  if (since === undefined) return [];
  const unread = `the full checks ${wait.repo} ran after ${wait.afterRepo}@${wait.sha} could not be read`;
  const lastBefore = Number(ghRead(["api", `repos/${wait.repo}/actions/runs?created=<${since}&per_page=1`, "--jq", ".workflow_runs[0].id // 0"], unread));
  const ledgered = ghRead(["api", "--paginate", `repos/${wait.repo}/actions/artifacts?name=${LEDGER_ARTIFACT}&per_page=100`, "--jq", ".artifacts[].workflow_run.id"], unread).split("\n").filter((id) => id !== "").map(Number);
  return [...new Set(ledgered)].filter((run) => run > lastBefore).sort((one, other) => one - other);
}
