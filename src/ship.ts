import { spawnSync } from "node:child_process";

const MIGRATIONS = "src/server/db/migrations/*.sql";
const HOLD = "refs/tags/release-hold";
const HEALTH = process.env.SHIP_HEALTH_URL ?? "";
const SERVICE = process.env.SHIP_SERVICE ?? "web";
const DEPLOY_DEADLINE_SECONDS = Number(process.env.SHIP_DEPLOY_DEADLINE_SECONDS ?? 1800);
const POLL_SECONDS = 15;
const CI_WORKFLOW = "ci.yml";
const CHECK_DEADLINE_SECONDS = Number(process.env.SHIP_CHECK_DEADLINE_SECONDS ?? 3600);
const FAILING_LINES = 30;
const SHIP_WORKFLOW = "ship.yml";
const DISPATCH_COVERS_HOURS = 20;

const USAGE = `ship: put main's newest green commit on production by moving the release branch Railway deploys.

  ship                 ship main's newest commit once the full check, integration suite included, has
                       passed on it (only a hand-started CI run counts, never a pull-request or push run; one is started when none has), then wait for its deploy; a red
                       holds the ship, production stays put and a bug is filed
  ship --to <commit>   ship that commit; one older than production is a rollback, and the migrations
                       it leaves behind stay applied, so they are named
  ship --daily         the scheduled run: stays put after a rollback until someone ships forward by
                       hand, then waits up to 30 minutes for production's /api/health to report the
                       release commit, even when nothing new shipped; when it never does, it fails
                       and opens an issue (or comments on the open one) for the repo owner

Merging to main deploys nothing. Production moves only here, and once a day from the app's
.github/workflows/ship.yml, which passes SHIP_HEALTH_URL. The PC's ship-clock dispatches that
workflow at its cron time; GitHub's own schedule fires hours late, so its run ships nothing when a
dispatched Ship ran in the last ${DISPATCH_COVERS_HOURS} hours. Run it from any checkout of the app.`;

interface CiRun {
  id: number;
  name: string;
  event: string;
  conclusion: string | null;
}

interface FullCheck {
  passed: boolean;
  cancelled?: boolean;
  runId?: number;
}

function die(message: string): never {
  console.error(message);
  process.exit(1);
}

function parsedArgs(): { to: string | undefined; daily: boolean } {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log(USAGE);
    process.exit(0);
  }
  let to: string | undefined;
  let daily = false;
  for (let at = 0; at < args.length; at += 1) {
    const arg = args[at];
    if (arg === "--daily") daily = true;
    else if (arg === "--to") {
      to = args[at + 1];
      if (to === undefined || to.startsWith("-")) die("✗ --to needs a value");
      at += 1;
    } else {
      console.error(USAGE);
      process.exit(2);
    }
  }
  return { to, daily };
}

const { to: named, daily } = parsedArgs();

function run(command: string, args: string[], stdio: "pipe" | "inherit" = "pipe") {
  return spawnSync(command, args, { encoding: "utf8", stdio });
}

function git(...args: string[]): string {
  const done = run("git", args);
  if (done.status !== 0) die(`✗ ship: git ${args.join(" ")} failed.\n${done.stderr.trim()}`);
  return done.stdout.trim();
}

function isAncestor(older: string, newer: string): boolean {
  return run("git", ["merge-base", "--is-ancestor", older, newer]).status === 0;
}

function ghApi(path: string, sha: string): unknown {
  const done = run("gh", ["api", path]);
  if (done.status !== 0) die(`✗ ship: could not read CI or the check status for ${sha.slice(0, 7)}.\n${done.stderr.trim()}`);
  return JSON.parse(done.stdout);
}

function ciRuns(sha: string): CiRun[] {
  const { workflow_runs: runs } = ghApi(`repos/{owner}/{repo}/actions/runs?head_sha=${sha}&event=workflow_dispatch&per_page=20`, sha) as { workflow_runs: CiRun[] };
  return runs.filter((workflowRun) => workflowRun.name === "CI" && workflowRun.event === "workflow_dispatch");
}

function pause(seconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}

function runUrl(): string {
  return process.env.GITHUB_RUN_ID ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : "a hand run of ship --daily";
}

function remoteMainHead(): string {
  return git("ls-remote", "origin", "refs/heads/main").split(/\s/)[0] ?? "";
}

function reportUnfinishedCheck(sha: string, live: string): never {
  const title = `Ship held: the full check did not finish on ${sha.slice(0, 7)}`;
  const body = [
    owner(),
    `The full check on ${sha.slice(0, 7)} did not finish in ${CHECK_DEADLINE_SECONDS / 60} minutes, so production stays on ${live.slice(0, 7)}.`,
    `Full checks take turns on the runner, so it may be waiting behind another app's, and CI cancels a dispatch when another starts on the same ref. Run ship once the queue has cleared. Found by ${runUrl()}.`,
  ]
    .filter(Boolean)
    .join("\n\n");
  return die(`✗ ship: ${title}. Filed: ${fileOrComment(title, body)}`);
}

async function fullCheckOf(sha: string, live: string): Promise<FullCheck> {
  if (ciRuns(sha).some((ciRun) => ciRun.conclusion === "success")) return { passed: true };
  const mainHead = remoteMainHead();
  if (mainHead !== sha) {
    die(
      `✗ ship: ${sha.slice(0, 7)} is not main's head (${mainHead.slice(0, 7)}), and a full check can only be started on main's head, so none can cover it. Run ship again to ship main's head, or wait for a full check to pass on ${sha.slice(0, 7)}. Production stays put.`,
    );
  }
  const already = new Set(ciRuns(sha).map((ciRun) => ciRun.id));
  const started = run("gh", ["workflow", "run", CI_WORKFLOW, "--ref", "main"]);
  if (started.status !== 0) die(`✗ ship: could not start the full check for ${sha.slice(0, 7)}.\n${started.stderr.trim()}`);
  const deadline = Date.now() + CHECK_DEADLINE_SECONDS * 1000;
  for (;;) {
    const finished = ciRuns(sha).find((ciRun) => !already.has(ciRun.id) && ciRun.conclusion);
    if (finished) return { passed: finished.conclusion === "success", cancelled: finished.conclusion === "cancelled", runId: finished.id };
    if (Date.now() >= deadline) {
      if (daily) reportUnfinishedCheck(sha, live);
      die(`✗ ship: the full check for ${sha.slice(0, 7)} did not finish in ${CHECK_DEADLINE_SECONDS / 60} minutes, so production stays put.`);
    }
    await pause(POLL_SECONDS);
  }
}

function fileOrComment(title: string, body: string): string {
  const open = run("gh", ["issue", "list", "--state", "open", "--search", `"${title}" in:title`, "--json", "number", "--jq", ".[].number"]);
  if (open.status !== 0) die(`✗ ship: ${title}, and listing issues failed.\n${open.stderr.trim()}`);
  const existing = open.stdout.trim().split("\n")[0];
  const filed = existing ? run("gh", ["issue", "comment", existing, "--body", body]) : run("gh", ["issue", "create", "--title", title, "--body", body]);
  if (filed.status !== 0) die(`✗ ship: ${title}, and filing it failed.\n${filed.stderr.trim()}`);
  return filed.stdout.trim() || `#${existing}`;
}

function owner(): string {
  const login = process.env.GITHUB_REPOSITORY_OWNER;
  return login ? `@${login}` : "";
}

function failingTests(runId: number | undefined): string {
  const log = runId ? run("gh", ["run", "view", String(runId), "--log-failed"]).stdout : "";
  return log
    .split("\n")
    .filter((line) => /\bFAIL\b|✗|×/.test(line))
    .slice(0, FAILING_LINES)
    .join("\n");
}

function holdForRedCheck(sha: string, live: string, runId: number | undefined): never {
  const title = `Ship held: the full check is red on ${sha.slice(0, 7)}`;
  const body = [
    owner(),
    `The full check, integration suite included, is red on ${sha.slice(0, 7)}, so production stays on ${live.slice(0, 7)}, the last build that passed it.`,
    `Failing:\n${failingTests(runId) || "(its log names none)"}`,
    `Merges since ${live.slice(0, 7)}:\n${namesBetween(live, sha)}`,
    "Once a fix is on main, run ship.",
  ]
    .filter(Boolean)
    .join("\n\n");
  return die(`✗ ship: ${title}. Filed: ${fileOrComment(title, body)}`);
}

function namesBetween(older: string, newer: string): string {
  return git("log", "--first-parent", "--format=  %h %s", `${older}..${newer}`);
}

function migrationsBetween(older: string, newer: string): string {
  return git("diff", "--name-only", "--diff-filter=A", older, newer, "--", MIGRATIONS);
}

function chooseForward(): string {
  return git("rev-parse", "origin/main");
}

function chooseNamed(name: string): string {
  const found = run("git", ["rev-parse", "--verify", "--quiet", `${name}^{commit}`]);
  if (found.status !== 0) die(`✗ ship: ${name} names no commit.`);
  const sha = found.stdout.trim();
  if (!isAncestor(sha, "origin/main")) die(`✗ ship: ${name} is not on main.`);
  return sha;
}

async function productionBuild(): Promise<string> {
  try {
    const health = await fetch(HEALTH, { signal: AbortSignal.timeout(10_000) });
    const { build } = (await health.json()) as { build?: string | null };
    return build ?? `no build (HTTP ${health.status})`;
  } catch (unreachable) {
    return `unreachable (${(unreachable as Error).message})`;
  }
}

async function awaitProduction(expected: string): Promise<string | null> {
  const deadline = Date.now() + DEPLOY_DEADLINE_SECONDS * 1000;
  for (;;) {
    const serving = await productionBuild();
    if (serving === expected) return null;
    if (Date.now() >= deadline) return serving;
    await pause(POLL_SECONDS);
  }
}

function reportFailedDeploy(expected: string, serving: string): never {
  const title = `Production deploy of ${expected.slice(0, 7)} failed`;
  const body = [
    owner(),
    `Release is ${expected.slice(0, 7)}, but after ${DEPLOY_DEADLINE_SECONDS / 60} minutes ${HEALTH} still reports ${serving}, so production is on an older build or down.`,
    `Railway's deploy log for ${SERVICE} says why; once the fix is on main, run ship. Found by ${runUrl()}.`,
  ]
    .filter(Boolean)
    .join("\n\n");
  return die(`✗ ship: ${title}: production reports ${serving}. Filed: ${fileOrComment(title, body)}`);
}

async function moveRelease(): Promise<{ release: string; moved: boolean }> {
  git("fetch", "--quiet", "origin", "+refs/heads/main:refs/remotes/origin/main", "+refs/heads/release:refs/remotes/origin/release");
  const live = git("rev-parse", "origin/release");
  const held = git("ls-remote", "origin", HOLD) !== "";
  if (daily && held) {
    console.log("Production was rolled back, so the daily run leaves it there. Run ship to go forward.");
    return { release: live, moved: false };
  }
  const target = named ? chooseNamed(named) : chooseForward();

  if (target === live) {
    console.log(`Nothing to ship: production already runs ${live.slice(0, 7)}.`);
    return { release: live, moved: false };
  }
  const rollback = isAncestor(target, live);
  if (!rollback) {
    const fullCheck = await fullCheckOf(target, live);
    if (fullCheck.cancelled) die(`✗ ship: the full check for ${target.slice(0, 7)} was cancelled before it finished (another CI run took its place), so it proved nothing. Run ship again; production stays put.`);
    if (!fullCheck.passed) holdForRedCheck(target, live, fullCheck.runId);
  }

  if (rollback) {
    const stranded = migrationsBetween(target, live);
    console.log(`Rolling production back to ${target.slice(0, 7)}, leaving:\n${namesBetween(target, live)}`);
    if (stranded) console.log(`These migrations stay applied, so the old code runs against them:\n${stranded}`);
    git("push", "--quiet", `--force-with-lease=release:${live}`, "origin", `${target}:refs/heads/release`);
    git("push", "--quiet", "--force", "origin", `${live}:${HOLD}`);
  } else {
    const applying = migrationsBetween(live, target);
    console.log(`Shipping ${target.slice(0, 7)}:\n${namesBetween(live, target)}`);
    if (applying) console.log(`Migrations that run on this deploy:\n${applying}`);
    git("push", "--quiet", "origin", `${target}:refs/heads/release`);
    if (held) git("push", "--quiet", "origin", `:${HOLD}`);
  }
  return { release: target, moved: true };
}

function dispatchedShipCovers(): string | undefined {
  const done = run("gh", ["api", `repos/{owner}/{repo}/actions/workflows/${SHIP_WORKFLOW}/runs?event=workflow_dispatch&per_page=1`]);
  if (done.status !== 0) die(`✗ ship: could not read this app's dispatched Ship runs.\n${done.stderr.trim()}`);
  const newest = (JSON.parse(done.stdout) as { workflow_runs: { created_at: string }[] }).workflow_runs[0]?.created_at;
  return newest !== undefined && Date.now() - Date.parse(newest) < DISPATCH_COVERS_HOURS * 3_600_000 ? newest : undefined;
}

if (daily && process.env.GITHUB_EVENT_NAME === "schedule") {
  const covered = dispatchedShipCovers();
  if (covered !== undefined) {
    console.log(`A dispatched Ship already ran at ${covered}, so GitHub's late schedule run ships nothing.`);
    process.exit(0);
  }
}
if (daily && HEALTH === "") die("✗ ship: --daily needs SHIP_HEALTH_URL, the app's /api/health URL, and none is set.");
const { release, moved } = await moveRelease();
if (daily) {
  const serving = await awaitProduction(release);
  if (serving) reportFailedDeploy(release, serving);
  console.log(`Production runs ${release.slice(0, 7)}.`);
} else if (moved) {
  const waited = run("deploy-wait", [release], "inherit");
  process.exit(waited.status ?? 1);
}
