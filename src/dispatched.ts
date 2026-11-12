import { gh } from "./post.ts";

const RUNS_READ = 20;

export const DISPATCH_COVERS_MINUTES = 20;

export const onGitHubSchedule = () => process.env.GITHUB_EVENT_NAME === "schedule";

export function dispatchedSince(repo: string, workflow: string, withinMinutes: number, title?: string): string | undefined {
  const ran = gh(["api", `repos/${repo}/actions/workflows/${workflow}/runs?event=workflow_dispatch&per_page=${RUNS_READ}`]);
  if (ran.status !== 0) throw new Error(`the dispatched runs of ${workflow} in ${repo} could not be read: ${ran.stderr.trim()}`);
  const runs = (JSON.parse(ran.stdout) as { workflow_runs: { created_at: string; display_title?: string }[] }).workflow_runs;
  const newest = runs.find(({ display_title }) => title === undefined || display_title === title)?.created_at;
  return newest !== undefined && Date.now() - Date.parse(newest) < withinMinutes * 60_000 ? newest : undefined;
}
