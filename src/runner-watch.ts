import { spawnSync } from "node:child_process";
import { LABEL as PC, VARIABLE } from "./runner.ts";

const GITHUB_HOSTED = "ubuntu-latest";
const MINUTE = 60_000;

type Runner = { status: string; labels: { name: string }[] };
type Job = { labels: string[]; started_at: string | null; completed_at: string | null };
type UsageItem = { product: string; unitType: string; quantity: number; repositoryName: string };

function gh(args: string[], token?: string): string {
  const ran = spawnSync("gh", args, { encoding: "utf8", env: token === undefined ? process.env : { ...process.env, GH_TOKEN: token } });
  if (ran.status !== 0) throw new Error(`gh ${args.join(" ")}: ${(ran.stderr || ran.stdout).trim()}`);
  return ran.stdout;
}

function variableOf(repo: string): string | undefined {
  const ran = spawnSync("gh", ["variable", "get", VARIABLE, "-R", repo], { encoding: "utf8" });
  if (ran.status === 0) return ran.stdout.trim();
  if (/not found|HTTP 404/i.test(ran.stderr)) return undefined;
  throw new Error(`gh variable get ${VARIABLE} -R ${repo}: ${ran.stderr.trim()}`);
}

function flip(): void {
  const repos = gh(["api", "installation/repositories", "--paginate", "--jq", ".repositories[].full_name"]).split("\n").filter(Boolean);
  const failed: string[] = [];
  for (const repo of repos) {
    try {
      flipRepo(repo);
    } catch (error) {
      failed.push(error instanceof Error ? error.message.split("\n")[0] : String(error));
    }
  }
  if (failed.length > 0) throw new Error(`${failed.length} of ${repos.length} repos unchecked, first: ${failed[0]}`);
}

function flipRepo(repo: string): void {
  const pcRunners = (JSON.parse(gh(["api", `repos/${repo}/actions/runners`])) as { runners: Runner[] }).runners.filter(({ labels }) => labels.some(({ name }) => name === PC));
  if (pcRunners.length === 0) return;
  const online = pcRunners.some(({ status }) => status === "online");
  const current = variableOf(repo);
  const to = !online && current === PC ? GITHUB_HOSTED : online && current === GITHUB_HOSTED ? PC : undefined;
  if (to === undefined) return;
  gh(["variable", "set", VARIABLE, "-R", repo, "--body", to]);
  const flipped = to === PC ? "github -> pc, its PC runners are back" : "pc -> github, its PC runners are offline";
  console.log(`runner-watch: ${new Date().toISOString().replace(/\.\d+Z$/, "Z")} ${repo} ${flipped}`);
}

function hostedMinutesByWorkflow(repo: string, day: string): Map<string, number> {
  const runs = (JSON.parse(gh(["api", `repos/${repo}/actions/runs?created=${day}&per_page=100`])) as { workflow_runs: { id: number; name: string }[] }).workflow_runs;
  const minutes = new Map<string, number>();
  for (const { id, name } of runs) {
    const jobs = (JSON.parse(gh(["api", `repos/${repo}/actions/runs/${id}/jobs?per_page=100`])) as { jobs: Job[] }).jobs;
    for (const job of jobs) {
      if (job.labels.includes(PC) || job.started_at === null || job.completed_at === null) continue;
      const spent = Math.ceil((Date.parse(job.completed_at) - Date.parse(job.started_at)) / MINUTE);
      minutes.set(name, (minutes.get(name) ?? 0) + spent);
    }
  }
  return minutes;
}

function minutes(owner: string, day: string): void {
  const [year, month, date] = day.split("-").map(Number);
  const usage = (JSON.parse(gh(["api", `users/${owner}/settings/billing/usage?year=${year}&month=${month}&day=${date}`], process.env.BILLING_TOKEN)) as { usageItems: UsageItem[] }).usageItems;
  const byRepo = new Map<string, number>();
  for (const { product, unitType, quantity, repositoryName } of usage) {
    if (product.toLowerCase() !== "actions" || unitType.toLowerCase() !== "minutes" || quantity <= 0) continue;
    const repo = repositoryName.includes("/") ? repositoryName : `${owner}/${repositoryName}`;
    byRepo.set(repo, (byRepo.get(repo) ?? 0) + quantity);
  }
  const sections = [...byRepo]
    .filter(([repo]) => gh(["api", `repos/${repo}`, "--jq", ".private"]).trim() === "true")
    .map(([repo, total]) => [`- ${repo}: ${total} minutes`, ...[...hostedMinutesByWorkflow(repo, day)].map(([workflow, spent]) => `  - ${workflow}: ${spent} minutes`)].join("\n"));
  if (sections.length === 0) return;
  const body = [`Private repos ran on GitHub-hosted runners on ${day}, which spends paid minutes. Each line is the billed total, then each workflow's GitHub-hosted job minutes.`, "", ...sections, ""].join("\n");
  gh(["issue", "create", "--title", `GitHub-hosted minutes on ${day}`, "--assignee", owner, "--body", body]);
}

if (import.meta.main) {
  const [mode, owner, day] = process.argv.slice(2);
  const asked = mode === "flip" ? flip : mode === "minutes" && owner !== undefined && day !== undefined && /^\d{4}-\d\d-\d\d$/.test(day) ? () => minutes(owner, day) : undefined;
  if (asked === undefined) {
    console.error("runner-watch: usage: runner-watch flip | runner-watch minutes <owner> <yyyy-mm-dd>");
    process.exit(2);
  }
  try {
    asked();
  } catch (error) {
    console.error(`runner-watch: ${(error instanceof Error ? error.message : String(error)).split("\n")[0]}`);
    process.exit(1);
  }
}
