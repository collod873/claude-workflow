import { execFile, spawnSync } from "node:child_process";
import { promisify } from "node:util";
import { DISPATCH_COVERS_MINUTES, dispatchedSince, onGitHubSchedule } from "./dispatched.ts";
import { MACHINE_REPO } from "./post.ts";
import { LABEL as PC, RECONCILE_LABEL, VARIABLE } from "./runner.ts";

const GITHUB_HOSTED = "ubuntu-latest";
const MINUTE = 60_000;
const OUTPUT_LIMIT = 512 * 1024 * 1024;
const JOB_LISTS_AT_ONCE = 16;

type Runner = { status: string; labels: { name: string }[] };
type Job = { labels: string[]; started_at: string | null; completed_at: string | null };
type UsageItem = { product: string; unitType: string; quantity: number; repositoryName: string };

function gh(args: string[], token?: string): string {
  const ran = spawnSync("gh", args, { encoding: "utf8", maxBuffer: OUTPUT_LIMIT, env: token === undefined ? process.env : { ...process.env, GH_TOKEN: token } });
  if (ran.status !== 0) throw new Error(`gh ${args.join(" ")}: ${ran.error?.message ?? (ran.stderr || ran.stdout).trim()}`);
  return ran.stdout;
}

async function ghAtOnce(args: string[]): Promise<string> {
  try {
    return (await promisify(execFile)("gh", args, { encoding: "utf8", maxBuffer: OUTPUT_LIMIT })).stdout;
  } catch (error) {
    throw new Error(`gh ${args.join(" ")}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
}

function variableOf(repo: string): string | undefined {
  const ran = spawnSync("gh", ["variable", "get", VARIABLE, "-R", repo], { encoding: "utf8" });
  if (ran.status === 0) return ran.stdout.trim();
  if (/not found|HTTP 404/i.test(ran.stderr)) return undefined;
  throw new Error(`gh variable get ${VARIABLE} -R ${repo}: ${ran.stderr.trim()}`);
}

function machineClockCovers(): string | undefined {
  try {
    return dispatchedSince(MACHINE_REPO, "runner-watch.yml", DISPATCH_COVERS_MINUTES);
  } catch (error) {
    console.error(`runner-watch: ${error instanceof Error ? error.message : String(error)}, so this scheduled pass flips anyway`);
    return undefined;
  }
}

function flip(): void {
  const covered = onGitHubSchedule() ? machineClockCovers() : undefined;
  if (covered !== undefined) {
    console.log(`runner-watch: the machine clock's dispatched runner watch already ran at ${covered}, so GitHub's late schedule run flips nothing`);
    return;
  }
  const repos = gh(["api", "installation/repositories", "--paginate", "--jq", ".repositories[].full_name"]).split("\n").filter(Boolean);
  const failed: string[] = [];
  for (const repo of repos) {
    try {
      flipRepo(repo);
    } catch (error) {
      failed.push(error instanceof Error ? (error.message.split("\n")[0] ?? "") : String(error));
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

async function hostedMinutesByWorkflow(repo: string, day: string): Promise<Map<string, number>> {
  const pages = JSON.parse(gh(["api", "--paginate", "--slurp", `repos/${repo}/actions/runs?created=${day}&per_page=100`])) as { workflow_runs: { id: number; name: string }[] }[];
  const runs = pages.flatMap(({ workflow_runs }) => workflow_runs);
  const jobLists: Job[][] = [];
  for (let start = 0; start < runs.length; start += JOB_LISTS_AT_ONCE) {
    const batch = runs.slice(start, start + JOB_LISTS_AT_ONCE).map(async ({ id }) => (JSON.parse(await ghAtOnce(["api", `repos/${repo}/actions/runs/${id}/jobs?per_page=100`])) as { jobs: Job[] }).jobs);
    jobLists.push(...(await Promise.all(batch)));
  }
  const minutes = new Map<string, number>();
  for (const [index, { name }] of runs.entries()) {
    for (const job of jobLists[index] ?? []) {
      if (job.labels.includes(PC) || job.labels.includes(RECONCILE_LABEL) || job.started_at === null || job.completed_at === null) continue;
      const spent = Math.ceil((Date.parse(job.completed_at) - Date.parse(job.started_at)) / MINUTE);
      minutes.set(name, (minutes.get(name) ?? 0) + spent);
    }
  }
  return minutes;
}

async function minutes(owner: string, day: string): Promise<void> {
  const [year, month, date] = day.split("-").map(Number);
  const usage = (JSON.parse(gh(["api", `users/${owner}/settings/billing/usage?year=${year}&month=${month}&day=${date}`], process.env.BILLING_TOKEN)) as { usageItems: UsageItem[] }).usageItems;
  const byRepo = new Map<string, number>();
  for (const { product, unitType, quantity, repositoryName } of usage) {
    if (product.toLowerCase() !== "actions" || unitType.toLowerCase() !== "minutes" || quantity <= 0) continue;
    const repo = repositoryName.includes("/") ? repositoryName : `${owner}/${repositoryName}`;
    byRepo.set(repo, (byRepo.get(repo) ?? 0) + quantity);
  }
  const sections: string[] = [];
  for (const [repo, total] of byRepo) {
    if (gh(["api", `repos/${repo}`, "--jq", ".private"]).trim() !== "true") continue;
    sections.push([`- ${repo}: ${total} minutes`, ...[...(await hostedMinutesByWorkflow(repo, day))].map(([workflow, spent]) => `  - ${workflow}: ${spent} minutes`)].join("\n"));
  }
  if (sections.length === 0) return;
  const body = [`Private repos ran on GitHub-hosted runners on ${day}, which spends paid minutes. Each line is the billed total, then each workflow's GitHub-hosted job minutes.`, "", ...sections, ""].join("\n");
  gh(["issue", "create", "--title", `GitHub-hosted minutes on ${day}`, "--assignee", owner, "--body", body]);
}

if (import.meta.main) {
  const [mode, owner, day] = process.argv.slice(2);
  const asked = mode === "flip" ? () => Promise.resolve(flip()) : mode === "minutes" && owner !== undefined && day !== undefined && /^\d{4}-\d\d-\d\d$/.test(day) ? () => minutes(owner, day) : undefined;
  if (asked === undefined) {
    console.error("runner-watch: usage: runner-watch flip | runner-watch minutes <owner> <yyyy-mm-dd>");
    process.exit(2);
  }
  try {
    await asked();
  } catch (error) {
    console.error(`runner-watch: ${(error instanceof Error ? error.message : String(error)).split("\n")[0]}`);
    process.exit(1);
  }
}
