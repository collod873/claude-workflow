import { spawnSync } from "node:child_process";
import { createSign } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { isMap, isScalar, type Node, parse, parseDocument } from "yaml";
import { FAST_CHECK, FULL_CHECK } from "./fence.ts";
import { ENROLLED_CALLER, ENROLLED_REVIEW, MACHINE_REPO } from "./post.ts";
import { LABELS, MACHINE } from "./spelled.ts";

const ROOT = join(import.meta.dirname, "..");
const CALLER_TEXT = readFileSync(join(ROOT, ".github", "caller.yml"), "utf8");
const PRE_PUSH = ".husky/pre-push";
const WORKFLOWS = ".github/workflows";
const TICKETS = `${WORKFLOWS}/tickets.yml`;
export const HOME_REVIEW = "review";
const CALLER = `${WORKFLOWS}/${ENROLLED_CALLER}`;
const CHECK = FAST_CHECK;
const BRANCH = "enrol/caller";
const KEY = "CORE_APP_PRIVATE_KEY";
const JWT_LIFE = 540;
const APP = MACHINE.replace(/\[bot\]$/, "");
const NOT_FOUND = /\(HTTP 404\)/;
const FORBIDDEN = /\(HTTP 403\)/;
const HANDED = "ci: hand this repo's tickets to the machine";
const CALLER_SETTING = "the caller file, check-job rule and pre-push";
const SWAP_SETTING = `main requiring ${ENROLLED_REVIEW} in place of ${HOME_REVIEW}`;
const PAUSED_REVIEW = `its ${ENROLLED_CALLER} workflow is disabled, so main requires no ${ENROLLED_REVIEW} until it is enabled and bin/enrol runs again`;
const CALLER_ONLY = "--caller";
const LINE_LIMIT = 200;
const SHOWN = 4;
const MOST_SHOWN = 5;
const PC_RUNS_ON = /^ {4}runs-on: (.*)$/m.exec(readFileSync(join(ROOT, TICKETS), "utf8"))?.[1] ?? "";
const ON_MAIN = { ref_name: { include: ["~DEFAULT_BRANCH"], exclude: [] } };
const PC_SWITCH = /vars\.(\w+)/.exec(PC_RUNS_ON)?.[1] ?? "";
const THROUGH_PR: Rule[] = [
  { type: "pull_request", parameters: { required_approving_review_count: 0, dismiss_stale_reviews_on_push: false, require_code_owner_review: false, require_last_push_approval: false, required_review_thread_resolution: false } },
  { type: "non_fast_forward" },
  { type: "deletion" },
];

const made = () => LABELS.filter(({ kind }) => kind !== "try");

class Refused extends Error {}
class Waits extends Error {}

interface Setting {
  name: string;
  waits?: () => string | undefined;
  held: () => boolean;
  set: () => { waits: string; opened: boolean } | void;
}

interface Job {
  name?: string;
  if?: unknown;
  uses?: string;
  "runs-on"?: unknown;
  steps?: { run?: unknown }[];
  services?: Record<string, { ports?: unknown[] } | null>;
}

interface Flow {
  name?: string;
  on?: unknown;
  jobs?: Record<string, Job | null>;
}

interface RequiredCheck {
  context: string;
  integration_id?: number;
}

interface Rule {
  type: string;
  ruleset_id?: number;
  parameters?: { required_status_checks?: RequiredCheck[]; [setting: string]: unknown };
}

interface Ruleset {
  name: string;
  target: string;
  enforcement: string;
  conditions: unknown;
  rules: Rule[];
}

function gh(args: string[], input?: string): string {
  const ran = spawnSync("gh", args, { encoding: "utf8", input });
  if (ran.status !== 0) throw new Refused((ran.stderr || ran.stdout).trim().split("\n")[0] || `gh ${args.join(" ")} failed`);
  return ran.stdout;
}

const read = <T>(args: string[]): T => JSON.parse(gh(args)) as T;

function once<T>(make: () => T): () => T {
  let made: { value: T } | undefined;
  return () => (made ??= { value: make() }).value;
}

function found<T>(args: string[]): T | undefined {
  try {
    return read<T>(args);
  } catch (error) {
    if (error instanceof Refused && NOT_FOUND.test(error.message)) return undefined;
    throw error;
  }
}

const triggers = (on: unknown): string[] => (typeof on === "string" ? [on] : Array.isArray(on) ? on.map(String) : Object.keys(on ?? {}));

const sourceOf = (text: string, path: string[]) => {
  const node = parseDocument(text).getIn(path, true) as Node | undefined;
  if (node?.range === undefined || node.range === null) throw new Error(`no ${path.join(".")} in this repo's Check`);
  return { value: String(node.toJSON()), text: text.slice(node.range[0], node.range[1]) };
};
const CHECK_TEXT = readFileSync(join(ROOT, WORKFLOWS, "check.yml"), "utf8");
const RULE = { name: sourceOf(CHECK_TEXT, ["jobs", CHECK, "name"]), if: sourceOf(CHECK_TEXT, ["jobs", CHECK, "if"]) };

const isCheck = (id: string, job: Job | null) => id === CHECK || job?.name === CHECK || job?.name === RULE.name.value;

function flowOf(text: string): Flow | undefined {
  try {
    return parse(text) as Flow;
  } catch {
    return undefined;
  }
}

const checkJobs = (flow: Flow | undefined) =>
  flow !== undefined && triggers(flow.on).some((on) => on === "pull_request" || on === "pull_request_target") ? Object.entries(flow.jobs ?? {}).flatMap(([id, job]) => (isCheck(id, job) ? [id] : [])) : [];

const checkRunner = (text: string) => checkJobs(flowOf(text)).length > 0;

function ruled(path: string, text: string): string {
  const ids = checkJobs(flowOf(text));
  if (ids.length > 1) throw new Refused(`${basename(path)} runs more than one \`${CHECK}\` job on pull requests: ${ids.join(", ")}`);
  const job = parseDocument(text).getIn(["jobs", ids[0] ?? CHECK], true);
  if (!isMap(job) || job.flow === true || job.items.length === 0) throw new Refused(`${basename(path)}'s ${CHECK} job is not a block mapping enrol can edit`);
  if (job.get("name") === RULE.name.value && job.get("if") === RULE.if.value) return text;
  const lineStart = (at: number) => text.lastIndexOf("\n", at - 1) + 1;
  const keyOf = (pair: (typeof job.items)[number]) => (isScalar(pair.key) ? pair.key : undefined);
  const first = keyOf(job.items[0]!)?.range?.[0];
  if (first === undefined) throw new Refused(`${basename(path)}'s ${CHECK} job is not a block mapping enrol can edit`);
  const at = lineStart(first);
  const indent = text.slice(at, first);
  const cuts = job.items.flatMap((pair) => {
    const key = keyOf(pair);
    const end = (pair.value as Node | null)?.range?.[1] ?? key?.range?.[1];
    if (key?.range == null || end === undefined || !["name", "if"].includes(String(key.value))) return [];
    return [[lineStart(key.range[0]), text[end - 1] === "\n" ? end : (text.indexOf("\n", end) + 1 || text.length)] as const];
  });
  let out = `${text.slice(0, at)}${indent}name: ${RULE.name.text}\n${indent}if: ${RULE.if.text}\n`;
  let from = at;
  for (const [start, end] of cuts) {
    out += text.slice(from, start);
    from = end;
  }
  return out + text.slice(from);
}

function pcGaps(path: string, text: string): string[] {
  const flow = flowOf(text);
  if (flow === undefined) return [];
  const file = basename(path);
  const runsCi = checkRunner(text);
  return Object.entries(flow.jobs ?? {}).flatMap(([id, job]) => {
    if (job === null || job.uses !== undefined) return [];
    const runsOn = typeof job["runs-on"] === "string" ? job["runs-on"] : (JSON.stringify(job["runs-on"]) ?? "nothing");
    const skipsSlots = runsCi && isCheck(id, job) && !(job.steps ?? []).some(({ run }) => new RegExp(`\\b${FULL_CHECK}\\b`).test(String(run ?? "")));
    const pinned = Object.entries(job.services ?? {}).flatMap(([service, held]) =>
      (held?.ports ?? []).map(String).flatMap((port) => (port.includes(":") ? [`- ${file}'s ${id} job pins host port ${port.split(":").at(-2)} for ${service}, which two PC runners cannot share`] : [])),
    );
    return [
      ...(runsOn === PC_RUNS_ON ? [] : [`- ${file}'s ${id} job runs on ${runsOn}, not ${PC_RUNS_ON}, so it stays on GitHub's runners`]),
      ...(skipsSlots ? [`- ${file}'s ${id} job runs its check without check, so it skips the PC's check slots`] : []),
      ...pinned,
    ];
  });
}

const url64 = (text: string) => Buffer.from(text).toString("base64url");

function appToken(clientId: string, key: string): string {
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${url64(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${url64(JSON.stringify({ iat: now - 60, exp: now + JWT_LIFE, iss: clientId }))}`;
  try {
    return `${unsigned}.${createSign("RSA-SHA256").update(unsigned).sign(key, "base64url")}`;
  } catch {
    throw new Refused(`the ${KEY} in the environment is not a private key the App can sign with`);
  }
}

function callerFor(ci: string): string {
  const caller = parseDocument(CALLER_TEXT);
  const named = caller.createNode([ci], { flow: true });
  caller.setIn(["on", "workflow_run", "workflows"], named);
  return caller.toString({ flowCollectionPadding: false, lineWidth: 0 });
}

function enrolling(repo: string): { settings: Setting[]; forPc: () => string[] } {
  const contents = (path: string, ref?: string) => found<{ content: string; sha: string }>(["api", `repos/${repo}/contents/${path}${ref === undefined ? "" : `?ref=${ref}`}`]);
  const textOf = (path: string, ref?: string) => {
    const file = contents(path, ref);
    return file === undefined ? undefined : { text: Buffer.from(file.content, "base64").toString("utf8"), sha: file.sha };
  };
  const held = once(() => read<{ id: number; allow_auto_merge: boolean; default_branch: string }>(["api", `repos/${repo}`]));
  const flows = once(() =>
    (found<{ path: string; type: string }[]>(["api", `repos/${repo}/contents/${WORKFLOWS}`]) ?? [])
      .filter(({ path, type }) => type === "file" && path !== CALLER && /\.ya?ml$/.test(path))
      .map(({ path }) => ({ path, text: textOf(path)?.text ?? "" })),
  );
  const ci = once(() => {
    const runners = flows().flatMap(({ path, text }) => (checkRunner(text) ? [{ path, text, name: (parse(text) as Flow).name ?? path }] : []));
    const [only, ...more] = runners;
    if (only === undefined) throw new Refused(`no workflow in ${WORKFLOWS} runs a \`${CHECK}\` job on pull requests, so there is no CI to name`);
    if (more.length > 0) throw new Refused(`more than one workflow runs a \`${CHECK}\` job on pull requests: ${runners.map(({ name }) => name).join(", ")}`);
    return only;
  });
  const clientId = once(() => read<{ client_id: string }>(["api", `apps/${APP}`]).client_id);
  const asApp = once(() => {
    const key = process.env[KEY] ?? "";
    if (key === "") throw new Refused(`no ${KEY} in the environment to read the App's access with`);
    return ["-H", `Authorization: Bearer ${appToken(clientId(), key)}`];
  });
  const owner = repo.split("/")[0] ?? repo;
  const installation = () => {
    const ours = found<{ id: number }>(["api", ...asApp(), `users/${owner}/installation`]);
    if (ours === undefined) throw new Refused(`the App is not installed on ${owner}'s account: install it from https://github.com/apps/${APP}`);
    return ours;
  };
  const names = (args: string[]) => read<{ name: string }[]>([...args, "-R", repo, "--json", "name"]).map(({ name }) => name.toLowerCase());
  const labels = once(() => names(["label", "list", "--limit", "1000"]));
  const variables = once(() => names(["variable", "list"]));
  const secretsOf = { actions: once(() => names(["secret", "list"])), dependabot: once(() => names(["secret", "list", "--app", "dependabot"])) };

  const secret = (name: string, app: keyof typeof secretsOf): Setting => ({
    name: app === "dependabot" ? `${name} for Dependabot` : name,
    held: () => secretsOf[app]().includes(name.toLowerCase()),
    set: () => {
      const value = process.env[name] ?? "";
      if (value === "") throw new Refused(`no ${name} in the environment to set it from`);
      gh(["secret", "set", name, "-R", repo, "--app", app], value);
    },
  });

  const caller = once(() => callerFor(ci().name));
  const pieces = once((): { path: string; text: string | undefined }[] => [
    { path: CALLER, text: caller() },
    { path: ci().path, text: ruled(ci().path, ci().text) },
    { path: PRE_PUSH, text: undefined },
  ]);
  const carries = (ref?: string) => pieces().every(({ path, text }) => textOf(path, ref)?.text === text);
  const rules = () => read<Rule[]>(["api", `repos/${repo}/rules/branches/${held().default_branch}`]);
  const requiring = (context: string) => rules().filter(({ type, parameters }) => type === "required_status_checks" && (parameters?.required_status_checks ?? []).some((required) => required.context === context));
  const requires = (context: string) => requiring(context).some(({ parameters }) => (parameters?.required_status_checks ?? []).some((required) => required.context === context && required.integration_id === undefined));
  const fromAnySource = ({ integration_id: _pinned, ...required }: RequiredCheck): RequiredCheck => required;
  const unpinned = (rule: Rule): Rule => (rule.parameters?.required_status_checks === undefined ? rule : { ...rule, parameters: { ...rule.parameters, required_status_checks: rule.parameters.required_status_checks.map(fromAnySource) } });
  const reshape = (context: string, reshaped: (held: Rule[]) => Rule[]): boolean => {
    const pinned = requiring(context)[0]?.ruleset_id;
    if (pinned === undefined) return false;
    const { name, target, enforcement, conditions, rules: held } = read<Ruleset>(["api", `repos/${repo}/rulesets/${pinned}`]);
    gh(["api", "-X", "PUT", `repos/${repo}/rulesets/${pinned}`, "--input", "-"], JSON.stringify({ name, target, enforcement, conditions, rules: reshaped(held) }));
    return true;
  };
  const unpin = (context: string) => reshape(context, (held) => held.map(unpinned));
  const paused = once(() => (found<{ state: string }>(["api", `repos/${repo}/actions/workflows/${ENROLLED_CALLER}`])?.state ?? "active") !== "active");
  const without = (context: string) => (rule: Rule): Rule[] => {
    const kept = rule.parameters?.required_status_checks?.filter((required) => required.context !== context);
    if (kept === undefined) return [rule];
    return kept.length === 0 ? [] : [{ ...rule, parameters: { ...rule.parameters, required_status_checks: kept } }];
  };
  const unrequire = (context: string) => {
    for (const id of new Set(requiring(context).map(({ ruleset_id }) => ruleset_id))) {
      if (id === undefined) continue;
      const { name, target, enforcement, conditions, rules: held } = read<Ruleset>(["api", `repos/${repo}/rulesets/${id}`]);
      const kept = held.flatMap(without(context));
      if (kept.length === 0) gh(["api", "-X", "DELETE", `repos/${repo}/rulesets/${id}`]);
      else gh(["api", "-X", "PUT", `repos/${repo}/rulesets/${id}`, "--input", "-"], JSON.stringify({ name, target, enforcement, conditions, rules: kept }));
    }
  };
  const swapped = (rule: Rule): Rule =>
    rule.parameters?.required_status_checks === undefined
      ? rule
      : { ...rule, parameters: { ...rule.parameters, required_status_checks: rule.parameters.required_status_checks.map((required) => (required.context === HOME_REVIEW ? { context: ENROLLED_REVIEW } : required)) } };
  const reviewsHome = () => {
    const review = flowOf(textOf(TICKETS)?.text ?? "")?.jobs?.review;
    return review != null && !String(review.if ?? "").includes(basename(MACHINE_REPO));
  };
  const write = (branch?: string) => {
    for (const { path, text } of pieces().filter((piece) => textOf(piece.path, branch)?.text !== piece.text)) {
      const sha = contents(path, branch)?.sha;
      const onBranch = branch === undefined ? [] : ["-f", `branch=${branch}`];
      if (text === undefined) gh(["api", "-X", "DELETE", `repos/${repo}/contents/${path}`, "-f", `message=${HANDED}`, ...onBranch, "-f", `sha=${sha}`]);
      else gh(["api", "-X", "PUT", `repos/${repo}/contents/${path}`, "-f", `message=${HANDED}`, ...onBranch, "-f", `content=${Buffer.from(text).toString("base64")}`, ...(sha === undefined ? [] : ["-f", `sha=${sha}`])]);
    }
  };
  const branchFromMain = () => {
    const main = read<{ object: { sha: string } }>(["api", `repos/${repo}/git/ref/heads/${held().default_branch}`]).object.sha;
    try {
      gh(["api", "-X", "POST", `repos/${repo}/git/refs`, "-f", `ref=refs/heads/${BRANCH}`, "-f", `sha=${main}`]);
    } catch (error) {
      if (!(error instanceof Refused && /already exists/i.test(error.message))) throw error;
      gh(["api", "-X", "PATCH", `repos/${repo}/git/refs/heads/${BRANCH}`, "-f", `sha=${main}`, "-F", "force=true"]);
    }
  };
  const openPr = () => read<{ url: string }[]>(["pr", "list", "-R", repo, "--head", BRANCH, "--json", "number,url"])[0];
  const throughPr = () => {
    const open = openPr();
    if (open !== undefined && carries(BRANCH)) return { waits: open.url, opened: false };
    if (!read<{ allow_auto_merge: boolean }>(["api", `repos/${repo}`]).allow_auto_merge) throw new Refused("auto-merge is off, so a PR for it would never merge on its own");
    branchFromMain();
    let url: string;
    try {
      write(BRANCH);
      url = open?.url ?? gh(["pr", "create", "-R", repo, "--head", BRANCH, "--base", held().default_branch, "--title", HANDED, "--body", `Brings \`${CALLER}\` to the caller text bin/enrol writes, naming this repo's CI, the \`${CHECK}\` job to the rule the machine's Check gives it, and takes out any \`${PRE_PUSH}\`, since land judges every landing. It merges on its own once \`${CHECK}\` passes.`]).trim();
      gh(["pr", "merge", BRANCH, "-R", repo, "--auto", "--squash", "--delete-branch"]);
    } catch (error) {
      try {
        if (openPr() === undefined) gh(["api", "-X", "DELETE", `repos/${repo}/git/refs/heads/${BRANCH}`]);
        else gh(["pr", "close", BRANCH, "-R", repo, "--delete-branch"]);
      } catch (cleanup) {
        if (!(error instanceof Refused && cleanup instanceof Refused)) throw cleanup;
        throw new Refused(`${error.message}, and cleaning up its PR and branch failed too: ${cleanup.message}`);
      }
      throw error;
    }
    return carries() ? undefined : { waits: url, opened: true };
  };

  const forPc = () => {
    try {
      const gaps = flows().flatMap(({ path, text }) => pcGaps(path, text).map((line) => line.slice(0, LINE_LIMIT)));
      const onPc = variables().includes(PC_SWITCH.toLowerCase());
      return [
        ...(gaps.length === 0 ? [] : [`enrol: ${repo} needs ${gaps.length} ${gaps.length === 1 ? "change" : "changes"} for PC runners:`, ...gaps]),
        ...(onPc ? [] : [`enrol: \`bin/runner ${repo} pc\` moves its jobs to this PC; run one fresh full check there and watch its peak memory before leaving it on`]),
      ];
    } catch (error) {
      if (!(error instanceof Refused)) throw error;
      return [`enrol: could not tell what ${repo} needs for PC runners: ${error.message}`.slice(0, LINE_LIMIT)];
    }
  };

  const settings: Setting[] = [
    {
      name: "the App's access",
      held: () => found(["api", ...asApp(), `repos/${repo}/installation`]) !== undefined,
      set: () => void gh(["api", "-X", "PUT", `user/installations/${installation().id}/repositories/${held().id}`]),
    },
    {
      name: "CORE_APP_CLIENT_ID",
      held: () => variables().includes("core_app_client_id"),
      set: () => void gh(["variable", "set", "CORE_APP_CLIENT_ID", "-R", repo, "--body", clientId()]),
    },
    secret(KEY, "actions"),
    secret(KEY, "dependabot"),
    secret("CLAUDE_CODE_OAUTH_TOKEN", "actions"),
    {
      name: "the machine's labels",
      held: () => made().every(({ name }) => labels().includes(name)),
      set: () => {
        for (const { name, colour, description } of made().filter((label) => !labels().includes(label.name))) gh(["label", "create", name, "-R", repo, "--color", colour, "--description", description]);
      },
    },
    {
      name: "auto-merge",
      held: () => held().allow_auto_merge,
      set: () => void gh(["api", "-X", "PATCH", `repos/${repo}`, "-F", "allow_auto_merge=true"]),
    },
    {
      name: `main taking changes only through a PR passing ${CHECK}`,
      held: () => {
        const ours = rules();
        return ours.some(({ type }) => type === "pull_request") && requires(CHECK);
      },
      set: () => {
        const missing = rules().some(({ type }) => type === "pull_request") ? [] : THROUGH_PR;
        if (reshape(CHECK, (held) => [...held.map(unpinned), ...missing])) return;
        ci();
        const ruleset = {
          name: "main lands only through a PR",
          target: "branch",
          enforcement: "active",
          conditions: ON_MAIN,
          rules: [...THROUGH_PR, { type: "required_status_checks", parameters: { strict_required_status_checks_policy: true, required_status_checks: [{ context: CHECK }] } }],
        };
        gh(["api", "-X", "POST", `repos/${repo}/rulesets`, "--input", "-"], JSON.stringify(ruleset));
      },
    },
    {
      name: CALLER_SETTING,
      held: () => carries(),
      set: () => (rules().some(({ type }) => type === "pull_request") ? throughPr() : write()),
    },
    {
      name: "main taking only a PR its review passed",
      waits: () => (paused() && requiring(ENROLLED_REVIEW).length === 0 ? PAUSED_REVIEW : undefined),
      held: () => !paused() && requires(ENROLLED_REVIEW),
      set: () => {
        if (paused()) {
          unrequire(ENROLLED_REVIEW);
          throw new Waits(PAUSED_REVIEW);
        }
        if (unpin(ENROLLED_REVIEW)) return;
        if (textOf(CALLER)?.text !== caller()) {
          const open = openPr();
          if (open === undefined) throw new Refused(`the caller file on main runs no ${ENROLLED_REVIEW}, so main would wait on a review that never runs`);
          return { waits: open.url, opened: false };
        }
        const ruleset = {
          name: "main lands only once its review passes",
          target: "branch",
          enforcement: "active",
          conditions: ON_MAIN,
          rules: [{ type: "required_status_checks", parameters: { strict_required_status_checks_policy: true, required_status_checks: [{ context: ENROLLED_REVIEW }] } }],
        };
        return void gh(["api", "-X", "POST", `repos/${repo}/rulesets`, "--input", "-"], JSON.stringify(ruleset));
      },
    },
    ...(repo === MACHINE_REPO
      ? [
          {
            name: SWAP_SETTING,
            waits: () => (requiring(HOME_REVIEW).length === 0 || reviewsHome() ? undefined : `swapping ${HOME_REVIEW} for ${ENROLLED_REVIEW} in main's required checks waits on ${basename(TICKETS)} running its review here`),
            held: () => requiring(HOME_REVIEW).length === 0,
            set: () => {
              try {
                reshape(HOME_REVIEW, (held) => held.map(swapped));
              } catch (error) {
                if (!(error instanceof Refused && FORBIDDEN.test(error.message))) throw error;
                throw new Waits(`swapping ${HOME_REVIEW} for ${ENROLLED_REVIEW} in main's required checks waits on the next bin/land here, which runs it on the owner's token`);
              }
            },
          },
        ]
      : []),
  ];
  return { settings, forPc };
}

function enrol(repo: string, callerOnly: boolean): number {
  const set: string[] = [];
  const waiting: string[] = [];
  const refused: string[] = [];
  const told: string[] = [];
  const { settings, forPc } = enrolling(repo);
  for (const setting of settings.filter(({ name }) => !callerOnly || name === CALLER_SETTING || name === SWAP_SETTING)) {
    try {
      const waits = setting.waits?.();
      if (waits !== undefined) told.push(`enrol: ${repo}: ${waits}`);
      if (waits !== undefined || setting.held()) continue;
      const pending = setting.set();
      if (pending !== undefined) waiting.push(`- ${setting.name}: ${pending.waits} merges on its own once ${CHECK} passes`);
      if (pending?.opened !== false) set.push(setting.name);
    } catch (error) {
      if (error instanceof Waits) {
        told.push(`enrol: ${repo}: ${error.message}`);
        continue;
      }
      if (!(error instanceof Refused)) throw error;
      refused.push(`- ${setting.name}: ${error.message}`);
    }
  }
  if (refused.length > 0) {
    const shown = refused.length > MOST_SHOWN ? [...refused.slice(0, SHOWN), `- and ${refused.length - SHOWN} more`] : refused;
    console.error([`enrol: ${repo} is not enrolled, ${refused.length} could not be set and ${set.length} were:`, ...shown.map((line) => line.slice(0, LINE_LIMIT))].join("\n"));
    return 1;
  }
  if (waiting.length > 0) console.log([`enrol: ${repo} is enrolled once its PR merges, ${set.length} settings set:`, ...waiting].join("\n"));
  else console.log(set.length === 0 ? `enrol: ${repo} was already enrolled, nothing changed` : `enrol: ${repo} enrolled, ${set.length} settings set`);
  for (const line of told) console.log(line);
  if (!callerOnly) for (const line of forPc()) console.log(line);
  return 0;
}

if (import.meta.main) {
  const [repo, mode] = process.argv.slice(2);
  if (repo === undefined) throw new Error("no repo in the arguments");
  process.exit(enrol(repo, mode === CALLER_ONLY));
}
