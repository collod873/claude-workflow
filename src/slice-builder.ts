import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type AddressInfo } from "node:net";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { type AppKey, freshAppToken, takenAppKey } from "./app-token.ts";
import { capped, LIST_CAP, NO_EM_DASH, onDisk, TAIL_CAP, tailOf, TICKET_CAP } from "./brief.ts";
import { checkedBy, type Red, spentOn } from "./builder.ts";
import { FAST_CHECK } from "./checks.ts";
import { LEFT_CAP } from "./scheduler.ts";
import { SLICE_ID } from "./slicer.ts";
import { gh, git, gitRead, Stopped, unread } from "./post.ts";
import { commitlinted, committed, CONTRACT, hire, setupRefusal } from "./stage.ts";

const USAGE = "build-slice: usage: build-slice --spec <N> --slice <id> --brief <file> --onto <integration ref> [--resume <session>] [--told <text> | --out-of-time | --answer <its answer's JSON, to land again>]";

const OUTCOMES = ["built", "partial", "done", "stuck"] as const;

const ANSWER = {
  type: "object",
  properties: {
    outcome: { enum: OUTCOMES },
    reason: { type: "string", pattern: NO_EM_DASH },
    left: { type: "string", pattern: NO_EM_DASH, maxLength: LEFT_CAP },
  },
  required: ["outcome", "reason"],
  additionalProperties: false,
};

interface Answer {
  outcome: (typeof OUTCOMES)[number];
  reason: string;
  left?: string;
}

interface Ending {
  outcome: Answer["outcome"] | "stopped" | "outOfTime";
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
  outOfTime: boolean;
  answer?: Answer;
}

const DATABASE_WAIT_SECONDS = 60;
const WRITE_UP_MINUTES = 5;
const PAST_ONTO_UNREAD = "the commits past the integration branch could not be read";

export const CARRY_ON = "Your last run on this slice stopped before it answered. Carry on from where this branch stands, and answer.";

export const OUT_OF_TIME = "Your time on this slice is up. Build nothing more: commit what holds and answer `partial`, with `left` naming each `## Done when` sentence that does not hold yet, or `built` if every one holds.";

export function handedOn({ brief, onto, commitlint }: { brief: string; onto: string; commitlint: boolean }): string {
  return [
    capped(brief.trimEnd(), TICKET_CAP),
    "## Build it",
    "Make the slice's `## Done when` hold, building what its Why asks. Call the Skill tool with `tdd` first, then work through it to its end. Commit as you go; a message says why, and carries neither an em dash nor a word that closes an issue, like `Fixes #12`.",
    ...(commitlint ? ["Commitlint runs here: each message is `type: subject`, a conventional type, lower-case."] : []),
    "## Your answer",
    `- \`built\`: the machine commits what you did not, rebases onto \`${onto}\`, runs \`${FAST_CHECK}\` and hands back each red or conflict until this branch fast-forwards \`${onto}\` green.`,
    "- `partial`: too big for one build; commit what holds, with `left` naming each `## Done when` sentence not yet holding, for the slicer to cut again. Same check.",
    `- \`done\`: \`${onto}\` already does what it asks, as when another slice built it; nothing lands, no one is called.`,
    "- `stuck`: you cannot build it; `reason` says why. The slice goes out while the other slices build on, and the spec stops for its owner only once nothing else can move.",
    "`reason`: why, in one paragraph.",
    "",
  ].join("\n\n");
}

export const repaired = ({ verdict, failed }: Red) =>
  [`\`${FAST_CHECK}\` is red on this branch: \`${verdict}\`. Each red step's output, cut to its last lines:`, tailOf(failed, TAIL_CAP), "Make it pass, and answer again.", ""].join("\n\n");

export const conflicted = (onto: string, files: string) =>
  [`\`${onto}\` moved, and rebasing this branch onto it stopped on a conflict in:`, capped(files, LIST_CAP), `Run \`git rebase ${onto}\`, resolve each conflict keeping what both sides meant, and answer again.`, ""].join("\n\n");

export const unrebased = (onto: string, said: string) =>
  [`\`${onto}\` moved, and \`git rebase ${onto}\` failed on this branch:`, capped(said, LIST_CAP), `Bring this branch onto \`${onto}\`'s tip, and answer again.`, ""].join("\n\n");

export const mergesRefused = (onto: string, merges: string) =>
  [`This branch must fast-forward \`${onto}\` with plain commits, and these past it are merge commits:`, capped(merges, LIST_CAP), `Put their work in plain commits on \`${onto}\`'s tip, such as with \`git rebase ${onto}\`, and answer again.`, ""].join("\n\n");

export const nothingBuilt = (outcome: string, onto: string) => `You answered \`${outcome}\`, and this branch has no commits past \`${onto}\`: build the slice, or answer \`done\` if \`${onto}\` already does what it asks.`;

export const builtNotDone = (onto: string) => `You answered \`done\`, and this branch has commits past \`${onto}\`: answer \`built\` to land them, or drop them with \`git reset --hard ${onto}\` and answer \`done\` again.`;

export const LEFT_UNNAMED = "You answered `partial` with no `left`: name each `## Done when` sentence that does not hold yet, and answer again.";

const NO_OUTCOME = "You gave no outcome. Answer one.";

const named = (...parts: string[]) =>
  parts
    .filter((part) => part !== "")
    .map((part) => part.replace(/[^A-Za-z0-9_.-]/g, "-"))
    .join("-");

function slicingOf(args: string[]): Slicing | undefined {
  const option = { type: "string" } as const;
  const parsed = (() => {
    try {
      return parseArgs({ args, strict: true, options: { spec: option, slice: option, brief: option, onto: option, resume: option, told: option, answer: option, "out-of-time": { type: "boolean" } } }).values;
    } catch {
      return undefined;
    }
  })();
  if (parsed === undefined) return undefined;
  const { spec, slice, brief, onto, resume, told, answer, "out-of-time": outOfTime = false } = parsed;
  if (spec === undefined || !/^\d+$/.test(spec) || slice === undefined || !SLICE_ID.test(slice) || brief === undefined || onto === undefined || onto === "") return undefined;
  const given = answer === undefined ? undefined : answerIn(answer);
  const resumedHow = [answer !== undefined, told !== undefined, outOfTime].filter((given) => given).length;
  if (resumedHow > 1 || (answer !== undefined && given === undefined)) return undefined;
  return { spec, slice, brief: resolve(brief), onto, outOfTime, ...(resume === undefined ? {} : { resume }), ...(told === undefined ? {} : { told }), ...(given === undefined ? {} : { answer: given }) };
}

function answerIn(json: string): Answer | undefined {
  try {
    const { outcome, reason, left } = JSON.parse(json) as Partial<Record<keyof Answer, unknown>>;
    if ((outcome !== "built" && outcome !== "partial") || typeof reason !== "string" || (left !== undefined && typeof left !== "string")) return undefined;
    return { outcome, reason, ...(left === undefined ? {} : { left }) };
  } catch {
    return undefined;
  }
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
  const own = mkdtempSync(join(tmpdir(), "slice-"));
  onLeaving(() => rmSync(own, { recursive: true, force: true }));
  process.env.TMPDIR = own;
  process.env.PORT = String(port);
  if (!needsDatabase(onDisk(CONTRACT) ?? "")) return undefined;
  return ownDatabase(named("database", process.env.GITHUB_REPOSITORY ?? "", process.env.RUNNER_NAME ?? "", spec, slice));
}

export const fastForwards = (onto: string) => git(["merge-base", "--is-ancestor", onto, "HEAD"]).status === 0;

export function rebaseStopped(onto: string): { files: string; said: string } | undefined {
  const rebased = git(["rebase", "--quiet", onto]);
  if (rebased.status === 0) return undefined;
  const files = git(["diff", "--name-only", "--diff-filter=U"]).stdout.trim();
  git(["rebase", "--abort"]);
  return { files, said: firstLine(rebased) };
}

function rebasedOnto(onto: string): string | undefined {
  const stopped = rebaseStopped(onto);
  if (stopped === undefined) return undefined;
  return stopped.files === "" ? unrebased(onto, stopped.said) : conflicted(onto, stopped.files);
}

export function sliceTrailed(onto: string, slices: string[]): void {
  const named = slices.map((slice) => `\`Slice: ${slice}\``).join(", ");
  const trailers = gitRead(["log", "--format=%x01%(trailers:key=Slice,valueonly,separator=%x2C)", `${onto}..HEAD`], `the commits past ${onto} could not be read, so none was given its ${named} trailer`);
  const commits = trailers.split("\x01").slice(1);
  if (commits.every((values) => slices.every((slice) => values.trim().split(",").includes(slice)))) return;
  const added = slices.map((slice) => `--trailer 'Slice: ${slice}'`).join(" ");
  gitRead(["-c", "trailer.ifexists=addIfDifferent", "rebase", "--quiet", "--exec", `git commit --quiet --amend --no-edit --no-verify --allow-empty ${added}`, onto], `the ${named} trailer could not be added to every commit past ${onto}`);
}

const pastOnto = (onto: string) => gitRead(["rev-list", "--count", `${onto}..HEAD`], PAST_ONTO_UNREAD);

function landable(slicing: Slicing, outcome: "built" | "partial", left: string): string | undefined {
  const { onto } = slicing;
  if (outcome === "partial" && left === "") return LEFT_UNNAMED;
  const merges = gitRead(["log", "--merges", "--format=%h %s", `${onto}..HEAD`], PAST_ONTO_UNREAD);
  if (merges !== "") return mergesRefused(onto, merges);
  for (;;) {
    const conflict = fastForwards(onto) ? undefined : rebasedOnto(onto);
    if (conflict !== undefined) return conflict;
    if (pastOnto(onto) === "0") return nothingBuilt(outcome, onto);
    sliceTrailed(slicing.onto, [slicing.slice]);
    const red = checkedBy(FAST_CHECK);
    if (red !== undefined) return repaired(red);
    if (fastForwards(onto)) return undefined;
  }
}

const ended = (outcome: Ending["outcome"], reason: string, session: string | undefined, left = ""): Ending => ({ outcome, left, reason, session: session ?? "" });

function built(slicing: Slicing, app: AppKey | undefined): Ending {
  const { spec, slice, onto } = slicing;
  const file = sessionFile(slicing);
  const spend = hire("build-slice", named(spec, slice), { name: "slice builder", model: "opus", answers: ANSWER, writeUp: { minutes: WRITE_UP_MINUTES, told: OUT_OF_TIME } });
  const brief = onDisk(slicing.brief) ?? unread(`the brief ${slicing.brief} could not be read, so no builder was hired`);
  const opening = handedOn({ ...slicing, brief, commitlint: commitlinted() });
  let session = slicing.resume ?? savedSession(file);
  let input = slicing.told ?? (slicing.outOfTime ? OUT_OF_TIME : session === undefined ? opening : CARRY_ON);
  let left = "";
  for (let answer = slicing.answer; ; answer = undefined) {
    if (answer === undefined) {
      const spent = spentOn(`build-slice: #${spec} ${slice}`, spend, input, session, opening);
      session = spent.session ?? session;
      keepSession(file, session);
      if (app !== undefined) freshAppToken(app, gh, `so slice ${slice} of #${spec} stops`);
      if (spent.refusal !== undefined) return ended(spent.timedOut === true ? "outOfTime" : "stopped", spent.refusal, session);
      answer = spent.answer as Answer | undefined;
    }
    if (answer === undefined) {
      input = NO_OUTCOME;
      continue;
    }
    if (answer.outcome === "stuck") return ended("stuck", answer.reason, session);
    const leftNow = answer.left?.trim() ?? "";
    if (leftNow !== "") left = leftNow;
    committed(`Build slice ${slice} of #${spec}`, "feat");
    const outcome = answer.outcome === "built" && left !== "" ? "partial" : answer.outcome;
    const red = outcome === "done" ? (pastOnto(onto) === "0" ? undefined : builtNotDone(onto)) : landable(slicing, outcome, left);
    if (red === undefined) {
      rmSync(file, { force: true });
      return ended(outcome, answer.reason, session, outcome === "partial" ? left : "");
    }
    input = red;
  }
}

function builtIn(slicing: Slicing, app: AppKey | undefined, port: number): Ending {
  process.chdir(gitRead(["rev-parse", "--show-toplevel"], "the slice's worktree could not be found, so no builder was hired"));
  gitRead(["rev-parse", "--verify", "--quiet", `${slicing.onto}^{commit}`], `${slicing.onto} names no commit, so no builder was hired`);
  const unisolated = isolated(slicing, port);
  if (unisolated !== undefined) return ended("stopped", unisolated, undefined);
  const unready = setupRefusal(onDisk(CONTRACT) ?? "");
  if (unready !== undefined) return ended("stopped", `its tree's setup failed: ${unready}`, undefined);
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
  const ending = (() => {
    try {
      return builtIn(slicing, app, port);
    } catch (error) {
      if (!(error instanceof Stopped)) throw error;
      console.error(`build-slice: ${error.message}`);
      return ended("stopped", error.message, savedSession(sessionFile(slicing)));
    }
  })();
  console.log(JSON.stringify(ending));
  process.exit(ending.outcome === "built" || ending.outcome === "partial" || ending.outcome === "done" ? 0 : 1);
}
