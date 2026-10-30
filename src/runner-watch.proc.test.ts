import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { execute, scratch, script } from "./scenarios.ts";

const WATCH = join(import.meta.dirname, "..", "bin", "runner-watch");

type Repo = { name: string; private?: boolean; runners?: { status: string; labels: string[] }[]; variable?: string };

function watching(repos: Repo[], billing: object[] = [], runs: Record<string, object[]> = {}) {
  const root = scratch("runner-watch-");
  const at = (name: string) => join(root, name);
  const lines = ['case "$*" in', `  "api installation/repositories --paginate --jq .repositories[].full_name") printf '%s\\n' ${repos.map(({ name }) => `'${name}'`).join(" ")} ;;`];
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
    lines.push(`  "api repos/${repo}/actions/runs?created=2026-10-29&per_page=100") printf '%s' '${JSON.stringify({ workflow_runs: list.map((run, id) => ({ id, ...run })) })}' ;;`);
    list.forEach((run, id) => lines.push(`  "api repos/${repo}/actions/runs/${id}/jobs?per_page=100") printf '%s' '${JSON.stringify({ jobs: (run as { jobs: object[] }).jobs })}' ;;`));
  }
  lines.push(
    `  "api users/collod873/settings/billing/usage?year=2026&month=10&day=29") [[ $BILLING_TOKEN_SEEN == pat ]] && printf '%s' '${JSON.stringify({ usageItems: billing })}' ;;`,
    `  "issue create"*) printf '%s\\n' "$@" >"${at("issue")}" ;;`,
    "  *) printf 'unexpected gh %s\\n' \"$*\" >&2; exit 1 ;;",
    "esac",
  );
  script(at("bin/gh"), `BILLING_TOKEN_SEEN=\${GH_TOKEN:-}\n${lines.join("\n")}\n`);
  const env = { PATH: `${at("bin")}:${process.env.PATH ?? ""}`, GH_TOKEN: "app", BILLING_TOKEN: "pat", GH_REPO: "collod873/claude-workflow" };
  return {
    run: (...args: string[]) => execute(WATCH, root, env, args),
    variable: (repo: string) => (existsSync(at(`var-${repo.replace("/", "-")}`)) ? readFileSync(at(`var-${repo.replace("/", "-")}`), "utf8") : undefined),
    issue: () => (existsSync(at("issue")) ? readFileSync(at("issue"), "utf8") : undefined),
  };
}

const pc = (status: string) => ({ status, labels: ["self-hosted", "pc"] });

describe("bin/runner-watch keeps private repos off paid minutes without Collin watching (#1590)", () => {
  it("sends a repo whose PC runners are all offline to GitHub's runners, and back to pc once one returns, logging each flip with the time", () => {
    const watch = watching([{ name: "collod873/chess", runners: [pc("offline"), pc("offline")], variable: "pc" }]);

    const off = watch.run("flip");
    expect(off.stderr).toBe("");
    expect(off.stdout).toMatch(/^runner-watch: \d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ collod873\/chess pc -> github, its PC runners are offline\n$/);
    expect(watch.variable("collod873/chess")).toBe("ubuntu-latest");

    const unchanged = watching([{ name: "collod873/chess", runners: [pc("offline")], variable: "ubuntu-latest" }]);
    expect(unchanged.run("flip").stdout).toBe("");

    const back = watching([{ name: "collod873/chess", runners: [pc("offline"), pc("online")], variable: "ubuntu-latest" }]);
    expect(back.run("flip").stdout).toMatch(/ collod873\/chess github -> pc, its PC runners are back\n$/);
    expect(back.variable("collod873/chess")).toBe("pc");
  });

  it("leaves a repo switched to GitHub by hand, or with no PC runners, where it is", () => {
    const watch = watching([
      { name: "collod873/lodato-life", runners: [pc("online")] },
      { name: "collod873/design-kit", runners: [{ status: "offline", labels: ["self-hosted", "other"] }], variable: "pc" },
    ]);

    expect(watch.run("flip")).toEqual({ status: 0, stdout: "", stderr: "" });
    expect(watch.variable("collod873/lodato-life")).toBeUndefined();
    expect(watch.variable("collod873/design-kit")).toBe("pc");
  });

  it("files one issue to Collin naming each private repo, workflow and GitHub-hosted minutes of the day, counting each job's started minute", () => {
    const watch = watching(
      [{ name: "collod873/chess" }, { name: "collod873/claude-workflow", private: false }],
      [
        { product: "actions", unitType: "Minutes", quantity: 7, repositoryName: "collod873/chess" },
        { product: "actions", unitType: "Minutes", quantity: 40, repositoryName: "collod873/claude-workflow" },
        { product: "git_lfs", unitType: "GigabyteHours", quantity: 3, repositoryName: "collod873/chess" },
      ],
      {
        "collod873/chess": [
          { name: "CI", jobs: [{ labels: ["ubuntu-latest"], started_at: "2026-10-29T10:00:00Z", completed_at: "2026-10-29T10:04:10Z" }, { labels: ["pc"], started_at: "2026-10-29T10:00:00Z", completed_at: "2026-10-29T11:00:00Z" }] },
          { name: "Nightly", jobs: [{ labels: ["ubuntu-latest"], started_at: "2026-10-29T03:00:00Z", completed_at: "2026-10-29T03:02:00Z" }] },
        ],
      },
    );

    const ran = watch.run("minutes", "collod873", "2026-10-29");

    expect(ran.stderr).toBe("");
    const issue = watch.issue() ?? "";
    expect(issue).toContain("GitHub-hosted minutes on 2026-10-29");
    expect(issue).toContain("collod873");
    expect(issue).toContain("collod873/chess: 7 minutes");
    expect(issue).toContain("CI: 5 minutes");
    expect(issue).toContain("Nightly: 2 minutes");
    expect(issue).not.toContain("claude-workflow:");
  });

  it("files nothing on a day no private repo used GitHub-hosted minutes", () => {
    const watch = watching([{ name: "collod873/chess" }], [{ product: "actions", unitType: "Minutes", quantity: 0, repositoryName: "collod873/chess" }]);

    expect(watch.run("minutes", "collod873", "2026-10-29")).toEqual({ status: 0, stdout: "", stderr: "" });
    expect(watch.issue()).toBeUndefined();
  });
});
