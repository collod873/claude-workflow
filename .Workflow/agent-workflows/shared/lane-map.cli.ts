import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { buildLaneMap, LANE_MAP_RELATIVE_PATH, type LaneMap, renderLaneMap, tallyRuns, type RunTally } from "./lane-map";
import { MACHINE_REPOSITORY } from "./lane-wiring";
import { errorMessage } from "./reason";

const DEFAULT_WINDOW_DAYS = 14;

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function option(args: string[], name: string): string | undefined {
  const inline = args.find((arg) => arg.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function fetchRuns(repository: string, since: string): { name: string; conclusion: string | null }[] {
  const raw = execFileSync(
    "gh",
    ["api", "--paginate", `repos/${repository}/actions/runs?created=>=${since}&per_page=100`, "--jq", ".workflow_runs[] | {name, conclusion}"],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  return raw
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as { name: string; conclusion: string | null });
}

function main(): void {
  const args = process.argv.slice(2);
  const root = resolve(option(args, "--root") ?? process.env.TARGET_WORKSPACE ?? ".");
  const repository = option(args, "--repo") ?? MACHINE_REPOSITORY;
  const until = isoDate(new Date());
  const since = option(args, "--since") ?? isoDate(new Date(Date.now() - DEFAULT_WINDOW_DAYS * 86_400_000));
  const withRuns = !args.includes("--no-runs");

  let runs = new Map<string, RunTally>();
  let window: LaneMap["window"];
  const skeleton = buildLaneMap(root);
  if (withRuns) {
    try {
      runs = tallyRuns(fetchRuns(repository, since), skeleton.nodes);
      window = { since, until, repository };
    } catch (error) {
      console.error(`lane-map: run counts unavailable, drawing the wiring alone (${errorMessage(error)})`);
    }
  }

  const page = renderLaneMap(buildLaneMap(root, runs, window));
  const out = join(root, LANE_MAP_RELATIVE_PATH);
  writeFileSync(out, page);
  console.log(`wrote ${LANE_MAP_RELATIVE_PATH}${window ? ` with runs ${window.since}..${window.until}` : ""}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
