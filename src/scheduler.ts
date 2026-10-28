import { spawn, spawnSync } from "node:child_process";
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type AppKey, freshAppToken, takenAppKey } from "./app-token.ts";
import { capped, LIST_CAP } from "./brief.ts";
import { askedIssue, commentEdited, commentOnTicket, gh, ghRead, git, gitRead, heldOn, labelsHeld, machineBin, mark, OWNER, readOrStop, STUCK, unread } from "./post.ts";
import type { Slice } from "./slicer.ts";
import { BUILDING, MACHINE, SPEC, SPEC_PREFIX } from "./spelled.ts";
import { exitFor, stopsOf } from "./stops.ts";
import { filedOutOfScope, quoted } from "./ticket-shape.ts";

const stoppedAt = stopsOf({
  notSpec: "Schedule refused: the issue is not labelled `spec`",
  unsliced: "Schedule: the slicer ended red or gave no slices, so nothing more is hired",
  unmoved: "Schedule: no slice can move and none is left to build, so the spec is marked `stuck`",
  unfinished: "Schedule: bin/finish ended red, so the spec did not land",
  unchecked: "Schedule: bin/finish ended red after the spec landed, before its done check finished, so a rerun goes straight to the done check",
  missedTwice: "Schedule: the done check missed after the spec's one fix pass, so the spec is marked `stuck`",
});
type Stop = ReturnType<typeof stoppedAt>;

export const MOST_BUILDERS = 3;
const MOST_TRIES = 2;
export const LEFT_CAP = 1024;

type SliceState = "cut" | "hired" | "merged" | "out";

interface Tracked extends Slice {
  state: SliceState;
  tries: number;
  fix: boolean;
  session?: string | undefined;
  left?: string | undefined;
  stopped?: string | undefined;
  outOfTime?: boolean;
}

export interface Progress {
  fixPass: boolean;
  landed?: string | undefined;
  slices: Tracked[];
}

interface Built {
  id: string;
  outcome: "built" | "partial" | "done" | "stuck" | "stopped" | "outOfTime";
  reason: string;
  left?: string | undefined;
  session?: string | undefined;
}

const PROGRESS_HEADING = "## Spec run";
const PROGRESS_OPEN = "<!-- progress: ";
const PROGRESS_CLOSE = " -->";
const PROGRESS = new RegExp(`${PROGRESS_OPEN}(.*)${PROGRESS_CLOSE}`, "s");

export const specBranch = (spec: string) => `${SPEC_PREFIX}${spec}`;
const sliceBranch = (spec: string, id: string) => `slice/${spec}-${id}`;

const bullets = (lines: string[]) => lines.map((line) => `- ${line.trim()}`).join("\n");

export function briefOf(slice: Slice, specBody: string): string {
  const decisions = slice.decisions.length === 0 ? [] : ["## Implementation and Testing Decisions", bullets(slice.decisions)];
  return [`# ${slice.title.trim()}`, "## Why", slice.why.trim(), ...decisions, "## Done when", bullets(slice.done), "## Out of Scope", filedOutOfScope(specBody), ""].join("\n\n");
}

export const resumedAfterStop = (spec: string, reason: string) =>
  `Your last run on this slice stopped: ${capped(reason.trim().replace(/\.$/, ""), LIST_CAP)}. Go on from where it stopped until the slice is built and fast-forwards \`${specBranch(spec)}\`.`;

const cell = (text: string) => text.replaceAll("|", "\\|").replaceAll(/\s*\n\s*/g, " ");

function progressComment(progress: Progress): string {
  const rows = progress.slices.map(({ id, title, state, tries, left, stopped }) => `| \`${id}\` | ${cell(title)} | ${state} | ${tries} | ${cell(left ?? stopped ?? "")} |`);
  const json = JSON.stringify(progress).replaceAll("--", "-\\u002d");
  return [PROGRESS_HEADING, "", "| Slice | Title | State | Tries | Left |", "|---|---|---|---|---|", ...rows, "", `Fix pass: ${progress.fixPass ? "spent" : "not spent"}.`, "", `${PROGRESS_OPEN}${json}${PROGRESS_CLOSE}`, ""].join("\n");
}

interface Found {
  url?: string | undefined;
  progress: Progress;
}

export function progressOn(spec: string): Found {
  const line = `the comments on #${spec} could not be read, so no progress was read`;
  const listed = ghRead(["api", "--paginate", `repos/{owner}/{repo}/issues/${spec}/comments`, "--jq", ".[] | {url: .html_url, author: .user.login, body}"], line);
  try {
    const written = listed
      .split("\n")
      .filter((said) => said.trim() !== "")
      .map((said) => JSON.parse(said) as { url: string; author: string; body: string })
      .filter(({ author, body }) => author === MACHINE && body.startsWith(PROGRESS_HEADING))
      .at(-1);
    const json = PROGRESS.exec(written?.body ?? "")?.[1];
    if (json === undefined) return { url: written?.url, progress: { fixPass: false, slices: [] } };
    const saved = JSON.parse(json) as Progress;
    return { url: written?.url, progress: { ...saved, slices: saved.slices.map((slice) => ({ ...slice, decisions: slice.decisions ?? [], leftOf: slice.leftOf ?? [] })) } };
  } catch {
    return unread(line);
  }
}

function posted(spec: string, found: Found): void {
  const text = progressComment(found.progress);
  const written = found.url === undefined ? commentOnTicket(spec, text, gh) : commentEdited(found.url, text, gh);
  const [refusal] = written.refusals;
  if (refusal !== undefined) unread(`the progress comment on #${spec} would not post: ${quoted(refusal)}`);
  found.url ??= written.said;
}

export function landedOn(spec: string, found: Found, pr: string): void {
  found.progress.landed = pr;
  posted(spec, found);
}

function pushed(spec: string): void {
  gitRead(["push", "--quiet", "--force", "origin", specBranch(spec)], `${specBranch(spec)} would not push`);
}

function fetchedMain(): void {
  gitRead(["fetch", "--quiet", "origin", "main"], "origin/main could not be fetched");
}

function cleaned(): void {
  gitRead(["reset", "--quiet", "--hard"], "the integration branch's checkout could not be reset");
}

function branchedOff(spec: string, base: string): void {
  cleaned();
  gitRead(["checkout", "--quiet", "-B", specBranch(spec), base], `${specBranch(spec)} could not be checked out at ${base}`);
}

function readied(spec: string): void {
  fetchedMain();
  const kept = git(["fetch", "--quiet", "origin", `+refs/heads/${specBranch(spec)}:refs/remotes/origin/${specBranch(spec)}`]).status === 0;
  branchedOff(spec, kept ? `origin/${specBranch(spec)}` : "origin/main");
  if (!kept) pushed(spec);
}

function rebasedOntoMain(spec: string): void {
  fetchedMain();
  cleaned();
  if (git(["rebase", "--quiet", "origin/main"]).status !== 0) {
    git(["rebase", "--abort"]);
    console.error(`schedule: #${spec}'s ${specBranch(spec)} does not rebase cleanly onto origin/main, so it builds on without main's newest`);
    return;
  }
  pushed(spec);
}

function underGit(name: string): string {
  const dir = join(gitRead(["rev-parse", "--path-format=absolute", "--git-common-dir"], `the ${name} directory could not be named by git`), name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function keyed(file: string, app: AppKey | undefined): NodeJS.ProcessEnv {
  if (app === undefined) return process.env;
  writeFileSync(file, JSON.stringify(app), { mode: 0o600 });
  return { ...process.env, APP_KEY_FILE: file };
}

function lastLine(file: string, from: number): string {
  return (
    readFileSync(file)
      .subarray(from)
      .toString("utf8")
      .split("\n")
      .filter((line) => line.trim() !== "")
      .at(-1) ?? ""
  );
}

function parsed(line: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(line);
    return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

const text = (value: unknown) => (typeof value === "string" && value.trim() !== "" ? value : undefined);

function cutBySlicer(spec: string, logs: string): Slice[] | undefined {
  const log = join(logs, `slice-${spec}.out`);
  const from = existsSync(log) ? statSync(log).size : 0;
  const out = openSync(log, "a");
  const ran = spawnSync(machineBin("slice"), [spec], { stdio: ["ignore", out, "inherit"] });
  closeSync(out);
  const slices = parsed(lastLine(log, from))?.slices;
  return ran.status === 0 && Array.isArray(slices) ? (slices as Slice[]) : undefined;
}

function builtOf(id: string, status: number | null, signal: string | null, line: string): Built {
  const said = parsed(line);
  const outcome = said?.outcome;
  const ending = status === null ? `was killed by ${String(signal)}` : `ended ${String(status)}`;
  const reason = text(said?.reason) ?? `bin/build-slice ${ending} with ${said === undefined ? "no outcome" : `outcome ${JSON.stringify(outcome)}`}`;
  const session = text(said?.session);
  if (status === 0 && (outcome === "built" || outcome === "partial" || outcome === "done")) return { id, outcome, reason, left: text(said?.left), session };
  return { id, outcome: outcome === "stuck" || outcome === "outOfTime" ? outcome : "stopped", reason, session };
}

interface Hiring {
  resume?: string | undefined;
  told?: string;
  outOfTime?: boolean;
  answer?: { outcome: string; reason: string; left?: string };
}

function building(spec: string, tracked: Tracked, dir: string, brief: string, log: string, env: NodeJS.ProcessEnv, how: Hiring): Promise<Built> {
  const args = [
    ...["--spec", spec, "--slice", tracked.id, "--brief", brief, "--onto", specBranch(spec)],
    ...(how.resume === undefined ? [] : ["--resume", how.resume]),
    ...(how.told === undefined ? [] : ["--told", how.told]),
    ...(how.outOfTime === true ? ["--out-of-time"] : []),
    ...(how.answer === undefined ? [] : ["--answer", JSON.stringify(how.answer)]),
  ];
  const from = existsSync(log) ? statSync(log).size : 0;
  const out = openSync(log, "a");
  return new Promise((resolve) => {
    const child = spawn(machineBin("build-slice"), args, { cwd: dir, env, stdio: ["ignore", out, "inherit"] });
    closeSync(out);
    child.on("error", (error) => resolve({ id: tracked.id, outcome: "stopped", reason: `bin/build-slice did not start: ${error.message}` }));
    child.on("exit", (status, signal) => resolve(builtOf(tracked.id, status, signal, lastLine(log, from))));
  });
}

export function worktree(spec: string, branch: string, dir: string): string {
  if (existsSync(dir)) return dir;
  removed(branch, dir);
  gitRead(["worktree", "add", "--quiet", "-b", branch, dir, specBranch(spec)], `a worktree for ${branch} could not be made`);
  return dir;
}

export function removed(branch: string, dir: string): void {
  git(["worktree", "remove", "--force", dir]);
  rmSync(dir, { recursive: true, force: true });
  git(["worktree", "prune"]);
  git(["branch", "--quiet", "-D", branch]);
}

export function fastForwarded(spec: string, branch: string): boolean {
  const ancestor = git(["merge-base", "--is-ancestor", specBranch(spec), branch]);
  if (ancestor.status === 1) return false;
  if (ancestor.status !== 0) unread(`${branch} could not be read against ${specBranch(spec)}`);
  cleaned();
  gitRead(["merge", "--quiet", "--ff-only", branch], `${specBranch(spec)} would not fast-forward to ${branch}`);
  pushed(spec);
  return true;
}

const frontier = (progress: Progress): Tracked[] =>
  progress.slices.filter((tracked) => tracked.state === "cut" && tracked.blockedBy.every((id) => progress.slices.find((other) => other.id === id)?.state === "merged"));

interface Finished {
  status: number | null;
  landed?: string | undefined;
  missed: string;
}

function finished(spec: string, root: string, logs: string, app: AppKey | undefined): Finished {
  fetchedMain();
  cleaned();
  const log = join(logs, `finish-${spec}.out`);
  const from = existsSync(log) ? statSync(log).size : 0;
  const out = openSync(log, "a");
  const ran = spawnSync(machineBin("finish"), [spec], { stdio: ["ignore", out, "inherit"], env: keyed(join(root, "finish-app-key.json"), app) });
  closeSync(out);
  const said = readFileSync(log).subarray(from).toString("utf8");
  const given = (key: string) => new RegExp(`^${key}=(.*)$`, "m").exec(said)?.[1]?.trim();
  return { status: ran.status, landed: given("landed") || undefined, missed: given("missed") ?? "" };
}

function calledOwner(spec: string, stop: Stop, why: string): Stop {
  mark(spec, STUCK);
  commentOnTicket(spec, `@${OWNER} the spec run of #${spec} stopped and needs you: ${why}`, gh);
  return stoppedAt(stop, `schedule: #${spec} marked ${STUCK}, ${why}`);
}

function retried(spec: string, { session, outOfTime, stopped }: Tracked): Hiring {
  if (session === undefined) return {};
  return outOfTime === true ? { resume: session, outOfTime } : { resume: session, told: resumedAfterStop(spec, stopped ?? "") };
}

const unmovedWhy = (progress: Progress) => {
  const out = progress.slices.filter(({ state }) => state === "out").map(({ id, stopped }) => `\`${id}\` is out: ${quoted(stopped ?? "")}`);
  const blocked = progress.slices.filter(({ state }) => state === "cut").map(({ id }) => `\`${id}\``);
  return `no slice can move. ${out.join("; ") || "No slice is out"}. ${blocked.length === 0 ? "Nothing waits on them." : `Waiting on them: ${blocked.join(", ")}.`}`;
};

async function scheduled(spec: string, app: AppKey | undefined): Promise<Stop | undefined> {
  const said = `schedule: #${spec}`;
  const asked = askedIssue(ghRead(["issue", "view", spec, "--json", "title,body,labels"], `#${spec} could not be read, so nothing was hired`)) ?? unread(`#${spec} could not be read, so nothing was hired`);
  if (!asked.labels.has(SPEC)) return stoppedAt("notSpec", `${said} is not a spec, so nothing was hired`);
  const heldAtStart = heldOn(asked.labels);
  if (heldAtStart !== undefined) {
    console.log(`${said} is marked ${heldAtStart}, so nothing was hired`);
    return undefined;
  }
  const found = progressOn(spec);
  const { progress } = found;
  for (const tracked of progress.slices.filter(({ state }) => state === "hired")) {
    tracked.state = "cut";
    tracked.session = undefined;
  }
  for (const tracked of progress.slices.filter(({ state }) => state === "out")) tracked.state = "cut";
  readied(spec);
  posted(spec, found);
  const root = join(mkdtempSync(join(tmpdir(), "spec-worktrees-")), spec);
  mkdirSync(root, { recursive: true });
  const logs = underGit("machine-logs");
  const running = new Map<string, Promise<Built & { tried: boolean }>>();
  const fresh = (what: string) => {
    if (app !== undefined) freshAppToken(app, gh, `so the spec run of #${spec} does not act after ${what}`);
  };
  const hire = (tracked: Tracked, how: Hiring) => {
    const dir = worktree(spec, sliceBranch(spec, tracked.id), join(root, tracked.id));
    const brief = join(root, `${tracked.id}.md`);
    writeFileSync(brief, briefOf(tracked, asked.body));
    tracked.state = "hired";
    const tried = how.answer === undefined;
    running.set(
      tracked.id,
      building(spec, tracked, dir, brief, join(logs, `build-slice-${spec}-${tracked.id}.out`), keyed(join(root, `${tracked.id}-app-key.json`), app), how).then((built) => ({ ...built, tried })),
    );
  };
  const stoodDown = (after: string) => {
    const held = heldOn(labelsHeld(spec, gh));
    if (held !== undefined) console.log(`${said} is marked ${held}, so ${after}`);
    return held !== undefined;
  };
  const landedUnchecked = progress.landed !== undefined;
  let plan = !landedUnchecked;
  let cutNothing = landedUnchecked;
  let slicerStopped = false;
  let markedBuilding = false;
  for (;;) {
    const held = heldOn(labelsHeld(spec, gh));
    if (held === undefined && plan && !slicerStopped) {
      rebasedOntoMain(spec);
      const cut = cutBySlicer(spec, logs);
      fresh("its slicer");
      markedBuilding = false;
      plan = false;
      if (cut === undefined) slicerStopped = true;
      else {
        progress.slices.push(...cut.map((slice): Tracked => ({ ...slice, state: "cut", tries: 0, fix: progress.fixPass })));
        cutNothing = cut.length === 0;
      }
      posted(spec, found);
    }
    if (held === undefined && !slicerStopped) {
      const hiring = frontier(progress).slice(0, MOST_BUILDERS - running.size);
      for (const tracked of hiring) hire(tracked, retried(spec, tracked));
      if (running.size > 0 && !markedBuilding) {
        mark(spec, BUILDING);
        markedBuilding = true;
      }
      if (hiring.length > 0) posted(spec, found);
    }
    if (running.size === 0) {
      if (held !== undefined) {
        console.log(`${said} is marked ${held}, so its builders finished and merged and nothing more was hired`);
        return undefined;
      }
      if (slicerStopped) {
        if (stoodDown("its slicer stood down and nothing more was hired")) return undefined;
        return stoppedAt("unsliced", `${said} ended red, its slicer ended red or gave no slices, so nothing more was hired`);
      }
      if (!cutNothing || progress.slices.some(({ state }) => state !== "merged")) return calledOwner(spec, "unmoved", unmovedWhy(progress));
      const ended = finished(spec, root, logs, app);
      fresh("bin/finish");
      if (ended.status !== 0) {
        const unchecked = ended.landed === undefined ? undefined : `the spec landed as #${ended.landed}, with its done check unfinished`;
        if (stoodDown(unchecked === undefined ? "bin/finish stood down and the spec did not land" : `it stood down after ${unchecked}`)) return undefined;
        if (unchecked !== undefined) return stoppedAt("unchecked", `${said} ended red, bin/finish ${spec} ended ${String(ended.status)} after ${unchecked}, so a rerun goes straight to the done check`);
        return stoppedAt("unfinished", `${said} ended red, bin/finish ${spec} ended ${String(ended.status)}`);
      }
      progress.landed = undefined;
      if (ended.missed === "") {
        console.log(`${said} landed as #${ended.landed ?? "?"}, and its done check found every sentence held or put to the owner`);
        return undefined;
      }
      if (progress.fixPass) return calledOwner(spec, "missedTwice", `the done check missed sentence ${ended.missed} after its one fix pass`);
      progress.fixPass = true;
      plan = true;
      posted(spec, found);
      continue;
    }
    const built = await Promise.race(running.values());
    running.delete(built.id);
    fresh(`the builder of ${built.id}`);
    const tracked = progress.slices.find(({ id }) => id === built.id);
    if (tracked === undefined) continue;
    if (built.tried) tracked.tries += 1;
    tracked.session = built.session ?? tracked.session;
    if (built.outcome === "stopped" || built.outcome === "outOfTime" || built.outcome === "stuck") {
      tracked.stopped = built.reason;
      tracked.outOfTime = built.outcome === "outOfTime";
      tracked.state = built.outcome !== "stuck" && tracked.tries < MOST_TRIES ? "cut" : "out";
      if (tracked.state === "out") removed(sliceBranch(spec, tracked.id), join(root, tracked.id));
    } else if (built.outcome === "done") {
      tracked.state = "merged";
      removed(sliceBranch(spec, tracked.id), join(root, tracked.id));
      plan = true;
    } else if (fastForwarded(spec, sliceBranch(spec, tracked.id))) {
      tracked.state = "merged";
      tracked.left = built.outcome === "partial" ? capped(built.left ?? "", LEFT_CAP) : undefined;
      removed(sliceBranch(spec, tracked.id), join(root, tracked.id));
      plan = true;
    } else {
      hire(tracked, { resume: tracked.session, answer: { outcome: built.outcome, reason: built.reason, ...(built.left === undefined ? {} : { left: built.left }) } });
    }
    posted(spec, found);
  }
}

if (import.meta.main) {
  const [spec] = process.argv.slice(2);
  if (spec === undefined) throw new Error("no spec number in the arguments");
  const app = takenAppKey();
  delete process.env.APP_KEY_FILE;
  const ended = await scheduled(spec, app).catch((error: unknown) =>
    readOrStop("schedule", () => {
      throw error;
    }),
  );
  process.exit(exitFor(ended));
}
