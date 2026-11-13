import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { BIN, execute, scratch, script } from "./scenarios.ts";
import { declarePart } from "./part-files.ts";

export const PC_REPO = "collod873/Lumaria";
export const PC_HOST = hostname().toLowerCase();
export const PC_RUNNER_COUNT = 4;

const runnerId = (name: string) => [...name].reduce((sum, char) => sum + char.charCodeAt(0), 0);
export const pcRunner = (name: string, status = "online", busy = false, labels = ["pc"]) => ({ id: runnerId(name), name, status, busy, labels: ["self-hosted", ...labels].map((label) => ({ name: label })) });

export function switching({ isPrivate = true, runners = [] as object[], variable = "", startsOnline = true, slowToStart = [] as string[], stoppedByHand = [] as string[], manyJobs = [] as string[], userExists = true } = {}) {
  const root = scratch("runner-");
  const at = (name: string) => join(root, name);
  writeFileSync(at("runners.json"), JSON.stringify({ runners }));
  if (variable !== "") writeFileSync(at("variable-CI_RUNNER"), variable);
  script(
    at("bin/gh"),
    [
      `printf '%s\\n' "$*" >>"${at("gh-calls")}"`,
      'case "$*" in',
      `  "api repos/${PC_REPO}/actions/runners") cat "${at("runners.json")}" ;;`,
      `  "api -X POST repos/${PC_REPO}/actions/runners/"*/labels*) id=\${4#repos/${PC_REPO}/actions/runners/}; jq -c --argjson id "\${id%/labels}" --arg label "\${@: -1}" '.runners |= map(if .id == $id then .labels += [{name: ($label | ltrimstr("labels[]="))}] else . end)' "${at("runners.json")}" >"${at("runners.next")}" && mv "${at("runners.next")}" "${at("runners.json")}" ;;`,
      `  "api repos/${PC_REPO}") printf '{"full_name":"%s","private":${isPrivate}}\\n' "${PC_REPO}" ;;`,
      `  "api repos/collod873/Old-Name") printf '{"full_name":"%s","private":${isPrivate}}\\n' "${PC_REPO}" ;;`,
      `  "variable get"*) [ -f "${at("variable-")}$3" ] || { printf 'variable %s was not found\\n' "$3" >&2; exit 1; }; cat "${at("variable-")}$3" ;;`,
      `  "variable set"*) printf '%s' "\${@: -1}" >"${at("variable-")}$3" ;;`,
      `  "variable delete"*) rm "${at("variable-")}$3" ;;`,
      '  *cli/cli/releases/latest*) printf "v2.96.0\\n" ;;',
      '  *releases/latest*) printf "v2.330.0\\n" ;;',
      '  *registration-token*) printf "TOKEN\\n" ;;',
      '  *remove-token*) printf "GONE\\n" ;;',
      "esac",
      "",
    ].join("\n"),
  );
  mkdirSync(at("placed"));
  script(
    at("bin/sudo"),
    [
      `printf '%s\\n' "$*" >>"${at("sudo-calls")}"`,
      "if [[ $* =~ cat\\ \\>([^ ]+)\\.next ]]; then",
      `  kept="${at("placed")}/\${BASH_REMATCH[1]//\\//_}"`,
      '  cat >"$kept.next"',
      '  cmp -s "$kept.next" "$kept" || echo changed',
      "elif [[ $* =~ mv\\ ([^ ]+)\\.next ]]; then",
      `  kept="${at("placed")}/\${BASH_REMATCH[1]//\\//_}"`,
      '  mv "$kept.next" "$kept"',
      "fi",
      `[[ $* == *"${at("proc")}/"* ]] && exec "$@"`,
      "started='runners/[^/ ]+/([^ /]+) && .*svc\\.sh start'",
      `if ${startsOnline} && [[ $* =~ $started ]] && [[ " ${slowToStart.join(" ")} " != *" \${BASH_REMATCH[1]} "* ]]; then`,
      `  jq -c --arg name "\${BASH_REMATCH[1]}" '.runners |= (map(select(.name != $name)) + [{id: ($name | explode | add), name: $name, status: "online", busy: false, labels: [{name: "self-hosted"}, {name: (if ($name | endswith("-reconcile")) then "pc-reconcile" elif ($name | endswith("-repair")) then "pc-repair" else "pc" end)}]}])' "${at("runners.json")}" >"${at("runners.next")}"`,
      `  mv "${at("runners.next")}" "${at("runners.json")}"`,
      "fi",
      "",
    ].join("\n"),
  );
  script(at("bin/id"), `exit ${userExists ? 0 : 1}\n`);
  for (const [pid, environ] of [["1", "ACTIONS_RUNNER_INPUT_ONCE=true"], ["2", "LANG=C.UTF-8"]]) {
    mkdirSync(at(`proc/${pid}`), { recursive: true });
    writeFileSync(at(`proc/${pid}/environ`), `HOME=/home/ghrunner\0${environ}\0`);
  }
  const manyJobsUnits = manyJobs.map((name) => `actions.runner.${PC_REPO.replace("/", "-")}.${name}.service`).join(" ");
  script(at("bin/systemctl"), `if [[ $1 == show ]]; then [[ " ${manyJobsUnits} " == *" \${@: -1} "* ]] && echo 2 || echo 1; exit 0; fi\nfor name in ${stoppedByHand.join(" ")}; do [[ \${@: -1} == *".$name.service" ]] && exit 3; done\nexit 0\n`);
  script(at("bin/curl"), "printf '%s\\n' '[{\"version\":\"v25.1.0\",\"lts\":false},{\"version\":\"v24.11.0\",\"lts\":\"Krypton\"}]'\n");
  script(at("bin/sleep"), "");
  const lines = (name: string) => (existsSync(at(name)) ? readFileSync(at(name), "utf8").trim().split("\n") : []);
  return {
    run: (...args: string[]) => execute(join(BIN, "runner"), root, { PATH: `${at("bin")}:${process.env.PATH}`, RUNNER_WAIT_SECONDS: "0", RUNNER_PROC: at("proc") }, [PC_REPO, ...args]),
    runAs: (repo: string, ...args: string[]) => execute(join(BIN, "runner"), root, { PATH: `${at("bin")}:${process.env.PATH}`, RUNNER_WAIT_SECONDS: "0", RUNNER_PROC: at("proc") }, [repo, ...args]),
    variable: () => (existsSync(at("variable-CI_RUNNER")) ? readFileSync(at("variable-CI_RUNNER"), "utf8") : undefined),
    runners: () => (JSON.parse(readFileSync(at("runners.json"), "utf8")) as { runners: { name: string; status: string; labels: { name: string }[] }[] }).runners,
    sudo: () => lines("sudo-calls"),
    gh: () => lines("gh-calls"),
    jobStarted: (name: string) => writeFileSync(at("runners.json"), JSON.stringify({ runners: (JSON.parse(readFileSync(at("runners.json"), "utf8")) as { runners: { name: string }[] }).runners.map((runner) => ({ ...runner, busy: runner.name === name })) })),
    jobsEnded: () => writeFileSync(at("runners.json"), JSON.stringify({ runners: (JSON.parse(readFileSync(at("runners.json"), "utf8")) as { runners: object[] }).runners.map((runner) => ({ ...runner, busy: false })) })),
    placed: (path: string) => readFileSync(join(at("placed"), path.replaceAll("/", "_")), "utf8"),
  };
}

declarePart({
  part: {
    name: "bin/runner",
    file: "bin/runner",
    stops: "https://github.com/collod873/claude-workflow/issues/1257",
  },
  scenarios: [
    { label: "installing a repo's PC runners and sending its jobs there", run: () => switching().run("pc") },
    { label: "refusing a public repo", run: () => switching({ isPrivate: false }).run("pc") },
  ],
});
