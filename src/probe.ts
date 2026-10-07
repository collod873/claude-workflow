import { spawnSync } from "node:child_process";
import { closeSync, mkdtempSync, openSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { capped, onDisk } from "./brief.ts";
import { UNFENCED } from "./fence.ts";
import { ENROLLED_CALLER, gh, ghRead, readOrStop } from "./post.ts";
import { CONTRACT, hire, machineLogs, setupRefusal, treePathed } from "./stage.ts";
import { exitFor } from "./stops.ts";
import { quoted } from "./ticket-shape.ts";

export const PROBE_CAP = 8 * 1024;
const PROBES =["script", "claude"] as const;
export type Probe = (typeof PROBES)[number];

export const probeRunName = (by: Probe, text: string) => `Probe (${by}): ${text}`;
export const probeOutput = (key: string) => `probe-${key}.out`;

const FOUND_EVERY_SECONDS = Number(process.env.PROBE_FIND_SECONDS ?? "5");
const FOUND_TRIES = 24;
const WATCH_SECONDS = process.env.PROBE_WATCH_SECONDS ?? "15";
const CLOCK_SKEW_MS = 60_000;

export const asked = (text: string) => capped(text, PROBE_CAP);

function resultOf(stdout: string): string {
  let said = "";
  for (const line of stdout.split("\n")) {
    try {
      const event = JSON.parse(line) as { type?: unknown; result?: unknown };
      if (event.type === "result" && typeof event.result === "string") said = event.result;
    } catch {
      continue;
    }
  }
  return said;
}

function scripted(text: string, output: string): number {
  const written = openSync(output, "w");
  const ran = spawnSync("bash", ["-c", text], { env: treePathed(), stdio: ["ignore", written, written] });
  closeSync(written);
  return ran.status ?? 1;
}

function spoken(key: string, text: string, output: string): number | string {
  const spend = hire("probe", key, { name: "probe", gated: true, reach: UNFENCED });
  if (typeof spend === "string") return `the owner's hooks could not be read from ${spend}`;
  const spent = spend(asked(text));
  writeFileSync(output, spent.refusal ?? resultOf(spent.stdout));
  return spent.refusal ?? 0;
}

function probedHere(by: Probe, text: string): number {
  const key = process.env.GITHUB_RUN_ID ?? "here";
  const output = join(machineLogs(), probeOutput(key));
  const unready = setupRefusal(onDisk(join(process.cwd(), CONTRACT)) ?? "");
  if (unready !== undefined) {
    writeFileSync(output, unready);
    console.error(`probe: the tree's setup failed, so nothing was probed: ${quoted(unready)}`);
    return 1;
  }
  const ended = by === "script" ? scripted(text, output) : spoken(key, text, output);
  if (typeof ended === "string") {
    console.error(`probe: the ${by} probe stopped: ${ended}; its output is in ${output}`);
    return 1;
  }
  console.log(`probe: the ${by} probe ended ${ended}; its output is in ${output}`);
  return ended;
}

interface Listed {
  databaseId: number;
  createdAt: string;
  displayTitle: string;
  url: string;
}

function foundRun(repo: string, named: string, since: number): Listed | undefined {
  for (let tries = 0; tries < FOUND_TRIES; tries++) {
    const listed = JSON.parse(ghRead(["run", "list", "--repo", repo, "--workflow", ENROLLED_CALLER, "--event", "workflow_dispatch", "--limit", "20", "--json", "databaseId,createdAt,displayTitle,url"], `the runs of ${ENROLLED_CALLER} in ${repo} could not be read`)) as Listed[];
    const found = listed.filter((run) => run.displayTitle === named && Date.parse(run.createdAt) >= since).sort((one, other) => Date.parse(one.createdAt) - Date.parse(other.createdAt))[0];
    if (found !== undefined) return found;
    spawnSync("sleep", [String(FOUND_EVERY_SECONDS)]);
  }
  return undefined;
}

function probedIn(repo: string, by: Probe, text: string): number {
  const since = Date.now() - CLOCK_SKEW_MS;
  ghRead(["workflow", "run", ENROLLED_CALLER, "--repo", repo, "-f", "ticket=0", "-f", "reason=probe", "-f", `probe=${text}`, "-f", `probe_with=${by}`], `${repo} refused the dispatch of ${ENROLLED_CALLER}, so nothing was probed`);
  const run = foundRun(repo, probeRunName(by, text), since);
  if (run === undefined) {
    console.error(`probe: no run of ${ENROLLED_CALLER} in ${repo} named the probe after ${FOUND_TRIES} looks`);
    return 1;
  }
  gh(["run", "watch", String(run.databaseId), "--repo", repo, "--interval", WATCH_SECONDS]);
  const conclusion = ghRead(["run", "view", String(run.databaseId), "--repo", repo, "--json", "conclusion", "--jq", ".conclusion"], `run ${run.url} could not be read once it ended`);
  const into = mkdtempSync(join(tmpdir(), "probe-"));
  gh(["run", "download", String(run.databaseId), "--repo", repo, "--name", "machine-logs", "--dir", into]);
  const output = readdirSync(into).includes(probeOutput(String(run.databaseId))) ? join(into, probeOutput(String(run.databaseId))) : "nowhere, as the run kept no probe output";
  const said = `probe: ${run.url} ended ${conclusion}; its output is in ${output}`;
  if (conclusion === "success") console.log(said);
  else console.error(said);
  return conclusion === "success" ? 0 : 1;
}

if (import.meta.main) {
  const given = process.argv.slice(2);
  const [repo, by, text] = given[0] === "--in" ? given.slice(1) : [undefined, ...given];
  if (!PROBES.includes(by as Probe) || text === undefined) throw new Error("no probe in the arguments");
  const ended = readOrStop("probe", () => (repo === undefined ? probedHere(by as Probe, text) : probedIn(repo, by as Probe, text)));
  process.exit(typeof ended === "number" ? ended : exitFor(ended));
}
