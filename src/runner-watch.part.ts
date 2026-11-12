import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BIN, execute, scratch, script } from "./scenarios.ts";
import { declarePart } from "./part-files.ts";

type WatchedRepo = { name: string; private?: boolean; runners?: { status: string; labels: string[] }[]; variable?: string };

export function watching(repos: WatchedRepo[], billing: object[] = [], runs: Record<string, ({ jobs: object[] } & Record<string, unknown>)[]> = {}, { scheduled = false, dispatched = [] as { created_at: string; display_title: string }[] } = {}) {
  const root = scratch("runner-watch-");
  const at = (name: string) => join(root, name);
  writeFileSync(at("dispatched.json"), JSON.stringify({ workflow_runs: dispatched }));
  const lines = ['case "$*" in', `  "api installation/repositories --paginate --jq .repositories[].full_name") printf '%s\\n' ${repos.map(({ name }) => `'${name}'`).join(" ")} ;;`, `  "api repos/collod873/claude-workflow/actions/workflows/runner-watch.yml/runs?event=workflow_dispatch&per_page=20") cat "${at("dispatched.json")}" ;;`];
  for (const repo of repos) {
    const file = at(`var-${repo.name.replace("/", "-")}`);
    if (repo.variable !== undefined) writeFileSync(file, repo.variable);
    writeFileSync(at(`runners-${repo.name.replace("/", "-")}`), JSON.stringify({ runners: (repo.runners ?? []).map((runner) => ({ ...runner, labels: runner.labels.map((name) => ({ name })) })) }));
    lines.push(
      `  "api repos/${repo.name}/actions/runners") cat "${at(`runners-${repo.name.replace("/", "-")}`)}" ;;`,
      `  "api repos/${repo.name} --jq .private") printf '%s\\n' ${repo.private ?? true} ;;`,
      `  "variable get CI_RUNNER -R ${repo.name}") [ -f "${file}" ] || { printf 'variable CI_RUNNER was not found\\n' >&2; exit 1; }; cat "${file}" ;;`,
      `  "variable set CI_RUNNER -R ${repo.name} --body "*) printf '%s' "\${@: -1}" >"${file}" ;;`,
    );
  }
  for (const [repo, list] of Object.entries(runs)) {
    const pages = at(`runs-${repo.replace("/", "-")}`);
    const listed = list.map(({ jobs: _jobs, ...run }, id) => ({ id, ...run }));
    writeFileSync(pages, JSON.stringify(Array.from({ length: Math.ceil(listed.length / 100) }, (_, page) => ({ workflow_runs: listed.slice(page * 100, page * 100 + 100) }))));
    lines.push(`  "api --paginate --slurp repos/${repo}/actions/runs?created=2026-10-29&per_page=100") cat "${pages}" ;;`);
    list.forEach((run, id) => lines.push(`  "api repos/${repo}/actions/runs/${id}/jobs?per_page=100") printf '%s' '${JSON.stringify({ jobs: run.jobs })}' ;;`));
  }
  lines.push(
    `  "api users/collod873/settings/billing/usage?year=2026&month=10&day=29") [[ $BILLING_TOKEN_SEEN == pat ]] && printf '%s' '${JSON.stringify({ usageItems: billing })}' ;;`,
    `  "issue create"*) printf '%s\\n' "$@" >"${at("issue")}" ;;`,
    "  *) printf 'unexpected gh %s\\n' \"$*\" >&2; exit 1 ;;",
    "esac",
  );
  script(at("bin/gh"), `BILLING_TOKEN_SEEN=\${GH_TOKEN:-}\n${lines.join("\n")}\n`);
  const env = { PATH: `${at("bin")}:${process.env.PATH ?? ""}`, GH_TOKEN: "app", BILLING_TOKEN: "pat", GH_REPO: "collod873/claude-workflow", GITHUB_EVENT_NAME: scheduled ? "schedule" : "" };
  return {
    refuse: (repo: string) => {
      const gh = readFileSync(at("bin/gh"), "utf8").replace(" ;;\n", ` '${repo}' ;;\n  "api repos/${repo}/actions/runners") printf 'HTTP 403\\n' >&2; exit 1 ;;\n`);
      writeFileSync(at("bin/gh"), gh);
    },
    fails: (call: string, said: string, times: number) => {
      const count = at(`fails-${String(times)}-${call.replace(/\W/g, "-")}`);
      const gh = readFileSync(at("bin/gh"), "utf8").replace('case "$*" in\n', `if [[ "$*" == '${call}' ]] && (( $(cat "${count}" 2>/dev/null || echo 0) < ${String(times)} )); then echo $(( $(cat "${count}" 2>/dev/null || echo 0) + 1 )) >"${count}"; printf '%s\\n' '${said}' >&2; exit 1; fi\ncase "$*" in\n`);
      writeFileSync(at("bin/gh"), gh);
    },
    run: (...args: string[]) => execute(join(BIN, "runner-watch"), root, env, args),
    variable: (repo: string) => (existsSync(at(`var-${repo.replace("/", "-")}`)) ? readFileSync(at(`var-${repo.replace("/", "-")}`), "utf8") : undefined),
    issue: () => (existsSync(at("issue")) ? readFileSync(at("issue"), "utf8") : undefined),
  };
}

declarePart({
  part: {
    name: "bin/runner-watch",
    file: "bin/runner-watch",
    stops: "https://github.com/collod873/claude-workflow/issues/1590",
    lines: 6,
  },
  scenarios: [
    { label: "flipping a repo whose PC runners went offline", run: () => watching([{ name: "collod873/chess", runners: [{ status: "offline", labels: ["pc"] }], variable: "pc" }]).run("flip") },
    { label: "with GitHub refusing the billing usage", run: () => watching([{ name: "collod873/chess" }]).run("minutes", "collod873", "2026-10-28") },
  ],
});

declarePart({
  part: { name: "runner watch workflow", file: ".github/workflows/runner-watch.yml", stops: "https://github.com/collod873/claude-workflow/issues/1590", clock: true },
  scenarios: [],
});
