import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type AddressInfo } from "node:net";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { type AppKey, freshAppToken, takenAppKey } from "./app-token.ts";
import { capped, LIST_CAP, NO_EM_DASH, onDisk, TICKET_CAP } from "./brief.ts";
import { buildIt, checkedBy, spentOn, stillRed } from "./builder.ts";
import { FAST_CHECK } from "./checks.ts";
import { SLICE_ID } from "./slicer.ts";
import { gh, git, gitRead, readOrStop, unread } from "./post.ts";
import { commitlinted, committed, CONTRACT, hire, linted, setupRefusal } from "./stage.ts";

const USAGE = "build-slice: usage: build-slice --spec <N> --slice <id> --brief <file> --onto <integration ref> [--resume <session>] [--told <text>]";

const ANSWER = {
  type: "object",
  properties: {
    outcome: { enum: ["built", "partial", "stuck"] },
    reason: { type: "string", pattern: NO_EM_DASH },
    left: { type: "string", pattern: NO_EM_DASH },
  },
  required: ["outcome", "reason"],
  additionalProperties: false,
};

interface Answer {
  outcome: "built" | "partial" | "stuck";
  reason: string;
  left?: string;
}

interface Ending {
  outcome: Answer["outcome"];
  left: string;
  reason: string;
  session: string;
}

interface Slicing {
  spec: string;
  slice: string;
  brief: string;
  onto: string;
  resume?: string;
  told?: string;
}

const DATABASE_WAIT_SECONDS = 60;
const PAST_ONTO_UNREAD = "the commits past the integration branch could not be read";

export const CARRY_ON = "Your last run on this slice stopped before it answered. Carry on from where this branch stands, and answer.";

export function handedOn({ spec, slice, brief, onto, commitlint }: { spec: string; slice: string; brief: string; onto: string; commitlint: boolean }): string {
  return [
    `# Slice \`${slice}\` of spec #${spec}`,
    capped(brief, TICKET_CAP),
    ...buildIt("slice"),
    ...linted(commitlint),
    "## Your answer",
    "Answer one outcome:",
    `- \`built\`: the machine commits whatever you left, rebases this branch onto \`${onto}\`, runs \`${FAST_CHECK}\` and hands back each red or conflict until this branch fast-forwards \`${onto}\` green.`,
    "- `partial`: the slice is too big for one build; commit what holds and give `left`, what it still needs, which the slicer cuts again. It goes through the same check.",
    "- `stuck`: you cannot build it; `reason` says why.",
    "`reason`: one paragraph for the owner.",
    "",
  ].join("\n\n");
}

export const repaired = (output: string) => stillRed(FAST_CHECK, output);

export const conflicted = (onto: string, files: string) =>
  [`\`${onto}\` moved, and rebasing this branch onto it stopped on a conflict in:`, capped(files, LIST_CAP), `Run \`git rebase ${onto}\`, resolve each conflict keeping what both sides meant, and answer again.`, ""].join("\n\n");

export const mergesRefused = (onto: string, merges: string) =>
  [`This branch must fast-forward \`${onto}\` with plain commits, and these past it are merge commits:`, capped(merges, LIST_CAP), `Put their work in plain commits on \`${onto}\`'s tip, such as with \`git rebase ${onto}\`, and answer again.`, ""].join("\n\n");

export const nothingBuilt = (onto: string) => `You answered \`built\`, and this branch has no commits past \`${onto}\`: build the slice, or answer \`stuck\` if \`${onto}\` already does what it asks.`;

const named = (...parts: string[]) =>
  parts
    .filter((part) => part !== "")
    .map((part) => part.replace(/[^A-Za-z0-9_.-]/g, "-"))
    .join("-");

function slicingOf(args: string[]): Slicing | undefined {
  const option = { type: "string" } as const;
  const parsed = (() => {
    try {
      return parseArgs({ args, strict: true, options: { spec: option, slice: option, brief: option, onto: option, resume: option, told: option } }).values;
    } catch {
      return undefined;
    }
  })();
  if (parsed === undefined) return undefined;
  const { spec, slice, brief, onto, resume, told } = parsed;
  if (spec === undefined || !/^\d+$/.test(spec) || slice === undefined || !SLICE_ID.test(slice) || brief === undefined || onto === undefined || onto === "") return undefined;
  return { spec, slice, brief: resolve(brief), onto, ...(resume === undefined ? {} : { resume }), ...(told === undefined ? {} : { told }) };
}

const sessionFile = ({ spec, slice }: Slicing) => join(homedir(), ".claude", "slice-builder", named(process.env.GITHUB_REPOSITORY ?? ""), spec, slice);

function keepSession(file: string, session: string | undefined): void {
  if (session === undefined) return;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${session}\n`);
}

function savedSession(file: string): string | undefined {
  const saved = onDisk(file)?.trim();
  return saved === "" ? undefined : saved;
}

const leaving: (() => void)[] = [];
const onLeaving = (clean: () => void) => leaving.unshift(clean);

function needsDatabase(contract: string): boolean {
  const { steps } = JSON.parse(contract || "{}") as { steps?: Record<string, { needs?: string[] }> };
  return Object.values(steps ?? {}).some((step) => step.needs?.includes("DATABASE_URL") === true);
}

const docker = (args: string[]) => spawnSync("docker", args, { encoding: "utf8" });
const firstLine = ({ stdout, stderr }: { stdout: string; stderr: string }) => `${stderr}${stdout}`.trim().split("\n")[0] ?? "";

const RUNNER_LABEL = "machine.runner";
const RUN_LABEL = "machine.run";

function staleDatabases(container: string, runner: string, run: string): string[] {
  const listed = docker(["ps", "--all", "--filter", `label=${RUNNER_LABEL}=${runner}`, "--format", `{{.ID}}\t{{.Names}}\t{{.Label "${RUN_LABEL}"}}`]).stdout.trim();
  return listed === ""
    ? []
    : listed
        .split("\n")
        .map((line) => line.split("\t"))
        .filter(([, name, from]) => name === container || from !== run)
        .map(([id = ""]) => id);
}

function ownDatabase(container: string): string | undefined {
  const runner = process.env.RUNNER_NAME ?? "";
  const run = `${process.env.GITHUB_RUN_ID ?? ""}-${process.env.GITHUB_RUN_ATTEMPT ?? ""}`;
  const stale = staleDatabases(container, runner, run);
  if (stale.length > 0) docker(["rm", "--force", ...stale]);
  onLeaving(() => docker(["rm", "--force", container]));
  const started = docker(["run", "--quiet", "--detach", "--name", container, "--label", `${RUNNER_LABEL}=${runner}`, "--label", `${RUN_LABEL}=${run}`, "--publish", "127.0.0.1::5432", "--env", "POSTGRES_PASSWORD=postgres", "postgres:16"]);
  if (started.status !== 0) return `its Postgres would not start: ${firstLine(started)}`;
  for (let waited = 0; docker(["exec", container, "pg_isready", "--quiet", "--host", "127.0.0.1"]).status !== 0; waited++) {
    if (waited >= DATABASE_WAIT_SECONDS) return `its Postgres took no connections within ${DATABASE_WAIT_SECONDS} seconds`;
    spawnSync("sleep", ["1"]);
  }
  const port = docker(["port", container, "5432/tcp"]).stdout.split("\n")[0]?.split(":").at(-1) ?? "";
  if (!/^\d+$/.test(port)) return "its Postgres published no port";
  process.env.DATABASE_URL = `postgres://postgres:postgres@localhost:${port}/postgres`;
  return undefined;
}

function isolated({ spec, slice }: Slicing, port: number): string | undefined {
  const own = mkdtempSync(join(process.env.RUNNER_TEMP || tmpdir(), `${named("slice", spec, slice)}-`));
  onLeaving(() => rmSync(own, { recursive: true, force: true }));
  process.env.TMPDIR = own;
  process.env.PORT = String(port);
  if (!needsDatabase(onDisk(CONTRACT) ?? "")) return undefined;
  return ownDatabase(named("database", process.env.GITHUB_REPOSITORY ?? "", process.env.RUNNER_NAME ?? "", spec, slice));
}

const fastForwards = (onto: string) => git(["merge-base", "--is-ancestor", onto, "HEAD"]).status === 0;

function rebasedOnto(onto: string): string | undefined {
  if (git(["rebase", "--quiet", onto]).status === 0) return undefined;
  const files = git(["diff", "--name-only", "--diff-filter=U"]).stdout.trim();
  git(["rebase", "--abort"]);
  return conflicted(onto, files);
}

function trailed({ onto, slice }: Slicing): void {
  const trailers = gitRead(["log", "--format=%x01%(trailers:key=Slice,valueonly,separator=%x2C)", `${onto}..HEAD`], PAST_ONTO_UNREAD);
  const commits = trailers.split("\x01").slice(1);
  if (commits.every((values) => values.trim().split(",").includes(slice))) return;
  gitRead(["-c", "trailer.ifexists=addIfDifferent", "rebase", "--quiet", "--exec", `git commit --quiet --amend --no-edit --no-verify --allow-empty --trailer 'Slice: ${slice}'`, onto], `the \`Slice: ${slice}\` trailer could not be added to every commit past ${onto}`);
}

function landable(slicing: Slicing, built: boolean): string | undefined {
  const { onto } = slicing;
  const merges = gitRead(["log", "--merges", "--format=%h %s", `${onto}..HEAD`], PAST_ONTO_UNREAD);
  if (merges !== "") return mergesRefused(onto, merges);
  for (;;) {
    const conflict = fastForwards(onto) ? undefined : rebasedOnto(onto);
    if (conflict !== undefined) return conflict;
    if (built && gitRead(["rev-list", "--count", `${onto}..HEAD`], PAST_ONTO_UNREAD) === "0") return nothingBuilt(onto);
    trailed(slicing);
    const red = checkedBy(FAST_CHECK);
    if (red !== undefined) return repaired(red);
    if (fastForwards(onto)) return undefined;
  }
}

const stuck = (reason: string, session: string | undefined): Ending => ({ outcome: "stuck", left: "", reason, session: session ?? "" });

function built(slicing: Slicing, app: AppKey | undefined): Ending {
  const { spec, slice } = slicing;
  const file = sessionFile(slicing);
  const spend = hire("build-slice", named(spec, slice), { name: "slice builder", model: "opus", answers: ANSWER });
  const brief = onDisk(slicing.brief) ?? unread(`the brief ${slicing.brief} could not be read, so no builder was hired`);
  const opening = handedOn({ ...slicing, brief, commitlint: commitlinted() });
  let session = slicing.resume ?? savedSession(file);
  let input = slicing.told ?? (session === undefined ? opening : CARRY_ON);
  for (;;) {
    const spent = spentOn(`build-slice: #${spec} ${slice}`, spend, input, session, opening);
    session = spent.session ?? session;
    keepSession(file, session);
    if (app !== undefined) freshAppToken(app, gh, `so slice ${slice} of #${spec} stops`);
    if (spent.refusal !== undefined) return stuck(spent.refusal, session);
    const answer = spent.answer as Answer | undefined;
    if (answer?.outcome === "stuck") return stuck(answer.reason, session);
    if (answer === undefined) {
      input = "You gave no outcome. Answer one.";
    } else {
      committed(`Build slice ${slice} of #${spec}`, "feat");
      const red = landable(slicing, answer.outcome === "built");
      if (red === undefined) {
        rmSync(file, { force: true });
        return { outcome: answer.outcome, left: answer.left ?? "", reason: answer.reason, session: session ?? "" };
      }
      input = red;
    }
  }
}

function builtIn(slicing: Slicing, app: AppKey | undefined, port: number): Ending {
  process.chdir(gitRead(["rev-parse", "--show-toplevel"], "the slice's worktree could not be found, so no builder was hired"));
  gitRead(["rev-parse", "--verify", "--quiet", `${slicing.onto}^{commit}`], `${slicing.onto} names no commit, so no builder was hired`);
  const unisolated = isolated(slicing, port);
  if (unisolated !== undefined) return stuck(unisolated, undefined);
  const unready = setupRefusal(onDisk(CONTRACT) ?? "");
  if (unready !== undefined) return stuck(`its tree's setup failed: ${unready}`, undefined);
  return built(slicing, app);
}

const freePort = () =>
  new Promise<number>((resolved, refused) => {
    const server = createServer();
    server.once("error", refused);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      server.close(() => resolved(port));
    });
  });

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.includes("--help")) {
    console.log(USAGE);
    process.exit(0);
  }
  const slicing = slicingOf(args);
  if (slicing === undefined) {
    console.error(USAGE);
    process.exit(2);
  }
  process.on("exit", () => {
    for (const clean of leaving) clean();
  });
  const app = takenAppKey();
  const port = await freePort();
  const ended = readOrStop("build-slice", () => builtIn(slicing, app, port));
  const ending = typeof ended === "string" ? stuck(`it stopped at ${ended}, as the line above says`, savedSession(sessionFile(slicing))) : ended;
  console.log(JSON.stringify(ending));
  process.exit(ending.outcome === "stuck" ? 1 : 0);
}
