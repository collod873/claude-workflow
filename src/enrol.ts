import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse, parseDocument } from "yaml";
import { LABELS, MACHINE } from "./spelled.ts";

const CALLER_TEXT = readFileSync(join(import.meta.dirname, "..", ".github", "caller.yml"), "utf8");
const WORKFLOWS = ".github/workflows";
const CALLER = `${WORKFLOWS}/machine.yml`;
const CHECK = "check";
const APP = MACHINE.replace(/\[bot\]$/, "");
const NOT_FOUND = /\(HTTP 404\)/;
const LINE_LIMIT = 200;
const SHOWN = 4;
const MOST_SHOWN = 5;

const made = () => LABELS.filter(({ kind }) => kind !== "try");

class Refused extends Error {}

interface Setting {
  name: string;
  held: () => boolean;
  set: () => void;
}

interface Flow {
  name?: string;
  on?: unknown;
  jobs?: Record<string, { name?: string } | null>;
}

interface Rule {
  type: string;
  parameters?: { required_status_checks?: { context: string }[] };
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

function checkRunner(text: string): boolean {
  try {
    const flow = parse(text) as Flow;
    return triggers(flow.on).includes("pull_request") && Object.entries(flow.jobs ?? {}).some(([id, job]) => (job?.name ?? id) === CHECK);
  } catch {
    return false;
  }
}

function callerFor(ci: string): string {
  const caller = parseDocument(CALLER_TEXT);
  const named = caller.createNode([ci], { flow: true });
  caller.setIn(["on", "workflow_run", "workflows"], named);
  return caller.toString({ flowCollectionPadding: false });
}

function enrolling(repo: string): Setting[] {
  const contents = (path: string) => found<{ content: string; sha: string }>(["api", `repos/${repo}/contents/${path}`]);
  const textOf = (path: string) => {
    const file = contents(path);
    return file === undefined ? undefined : { text: Buffer.from(file.content, "base64").toString("utf8"), sha: file.sha };
  };
  const held = once(() => read<{ id: number; allow_auto_merge: boolean; default_branch: string }>(["api", `repos/${repo}`]));
  const ci = once(() => {
    const listed = (found<{ path: string; type: string }[]>(["api", `repos/${repo}/contents/${WORKFLOWS}`]) ?? []).filter(({ path, type }) => type === "file" && path !== CALLER && /\.ya?ml$/.test(path));
    const runners = listed.flatMap(({ path }) => {
      const text = textOf(path)?.text ?? "";
      return checkRunner(text) ? [(parse(text) as Flow).name ?? path] : [];
    });
    const [only, ...more] = runners;
    if (only === undefined) throw new Refused(`no workflow in ${WORKFLOWS} runs a \`${CHECK}\` job on pull requests, so there is no CI to name`);
    if (more.length > 0) throw new Refused(`more than one workflow runs a \`${CHECK}\` job on pull requests: ${runners.join(", ")}`);
    return only;
  });
  const installation = once(() => {
    const ours = read<{ installations: { id: number; app_slug: string; repository_selection: string }[] }>(["api", "user/installations"]).installations.find(({ app_slug }) => app_slug === APP);
    if (ours === undefined) throw new Refused(`the App is not installed on ${repo.split("/")[0] ?? repo}'s account: install it from https://github.com/apps/${APP}`);
    return ours;
  });
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

  const caller = once(() => callerFor(ci()));

  return [
    {
      name: "the caller file",
      held: () => textOf(CALLER)?.text === caller(),
      set: () => {
        const sha = contents(CALLER)?.sha;
        gh(["api", "-X", "PUT", `repos/${repo}/contents/${CALLER}`, "-f", "message=Hand this repo's tickets to the machine", "-f", `content=${Buffer.from(caller()).toString("base64")}`, ...(sha === undefined ? [] : ["-f", `sha=${sha}`])]);
      },
    },
    {
      name: "the App's access",
      held: () => installation().repository_selection === "all" || read<{ repositories: { full_name: string }[] }[]>(["api", "--paginate", "--slurp", `user/installations/${installation().id}/repositories?per_page=100`]).some((page) => page.repositories.some(({ full_name }) => full_name.toLowerCase() === repo.toLowerCase())),
      set: () => void gh(["api", "-X", "PUT", `user/installations/${installation().id}/repositories/${held().id}`]),
    },
    {
      name: "CORE_APP_CLIENT_ID",
      held: () => variables().includes("core_app_client_id"),
      set: () => void gh(["variable", "set", "CORE_APP_CLIENT_ID", "-R", repo, "--body", read<{ client_id: string }>(["api", `apps/${APP}`]).client_id]),
    },
    secret("CORE_APP_PRIVATE_KEY", "actions"),
    secret("CORE_APP_PRIVATE_KEY", "dependabot"),
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
        const rules = read<Rule[]>(["api", `repos/${repo}/rules/branches/${held().default_branch}`]);
        return rules.some(({ type }) => type === "pull_request") && rules.some(({ type, parameters }) => type === "required_status_checks" && (parameters?.required_status_checks ?? []).some(({ context }) => context === CHECK));
      },
      set: () => {
        ci();
        const ruleset = {
          name: "main lands only through a PR",
          target: "branch",
          enforcement: "active",
          conditions: { ref_name: { include: ["~DEFAULT_BRANCH"], exclude: [] } },
          rules: [
            { type: "pull_request", parameters: { required_approving_review_count: 0, dismiss_stale_reviews_on_push: false, require_code_owner_review: false, require_last_push_approval: false, required_review_thread_resolution: false } },
            { type: "non_fast_forward" },
            { type: "deletion" },
            { type: "required_status_checks", parameters: { strict_required_status_checks_policy: true, required_status_checks: [{ context: CHECK }] } },
          ],
        };
        gh(["api", "-X", "POST", `repos/${repo}/rulesets`, "--input", "-"], JSON.stringify(ruleset));
      },
    },
  ];
}

function enrol(repo: string): number {
  const set: string[] = [];
  const refused: string[] = [];
  for (const setting of enrolling(repo)) {
    try {
      if (setting.held()) continue;
      setting.set();
      set.push(setting.name);
    } catch (error) {
      if (!(error instanceof Refused)) throw error;
      refused.push(`- ${setting.name}: ${error.message}`);
    }
  }
  if (refused.length > 0) {
    const shown = refused.length > MOST_SHOWN ? [...refused.slice(0, SHOWN), `- and ${refused.length - SHOWN} more`] : refused;
    console.error([`enrol: ${repo} is not enrolled, ${refused.length} could not be set and ${set.length} were:`, ...shown.map((line) => line.slice(0, LINE_LIMIT))].join("\n"));
    return 1;
  }
  console.log(set.length === 0 ? `enrol: ${repo} was already enrolled, nothing changed` : `enrol: ${repo} enrolled, ${set.length} settings set`);
  return 0;
}

if (import.meta.main) {
  const [repo] = process.argv.slice(2);
  if (repo === undefined) throw new Error("no repo in the arguments");
  process.exit(enrol(repo));
}
