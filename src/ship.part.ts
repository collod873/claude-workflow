import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { onTestFinished } from "vitest";
import { BIN, clonedOn, execute, git, harnessEnv, plant, scratch, script, type Run } from "./scenarios.ts";
import { declarePart } from "./part-files.ts";

interface ShipRun {
  event: "push" | "pull_request" | "workflow_dispatch";
  conclusion: string | null;
}

export const FULL_CHECK_PASSED: ShipRun[] = [{ event: "workflow_dispatch", conclusion: "success" }];
export const RED_TEST_LINE = "FAIL src/features/accounting/ledger.integration.test.ts > posts a balanced entry";

const SHIP_GH = `#!/usr/bin/env node
const { appendFileSync, existsSync, readFileSync, writeFileSync } = require("node:fs");
const { execFileSync } = require("node:child_process");
const state = process.env.SHIP_GH_STATE;
const [command, subcommand] = process.argv.slice(2);
const read = (file, fallback) => (existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : fallback);
if (command === "issue") {
  appendFileSync(state + "/issue-calls", JSON.stringify(process.argv.slice(3)) + "\\n");
  if (subcommand === "list") process.stdout.write(readFileSync(state + "/open-issues", "utf8"));
  process.exit(0);
}
if (command === "workflow") {
  const head = execFileSync("git", ["ls-remote", "origin", "refs/heads/main"], { encoding: "utf8" }).split(/\\s/)[0];
  appendFileSync(state + "/dispatch-log", head + "\\n");
  const earlier = read(state + "/runs/" + head, []);
  const planned = read(state + "/plans/" + head, [{ conclusion: "failure" }]);
  const added = planned.map((plan, at) => ({ id: 9000 + earlier.length + at, event: "workflow_dispatch", conclusion: plan.conclusion }));
  writeFileSync(state + "/runs/" + head, JSON.stringify([...earlier, ...added]));
  process.exit(0);
}
if (process.argv.some((arg) => arg.includes("/actions/workflows/ship.yml/runs"))) {
  console.log(JSON.stringify({ workflow_runs: read(state + "/ship-dispatches", []) }));
  process.exit(0);
}
if (command === "run" && subcommand === "view") {
  console.log("PASS src/server/db/index.integration.test.ts\\n${RED_TEST_LINE}");
  process.exit(0);
}
const sha = process.argv.join(" ").match(/head_sha=([0-9a-f]+)/)[1];
const runs = read(state + "/runs/" + sha, []);
const event = process.argv.join(" ").match(/[?&]event=([a-z_]+)/)?.[1];
const listed = [{ id: 0, name: "Machine", event: "push", conclusion: "success" }, ...runs.map((ciRun) => ({ name: "CI", ...ciRun }))];
console.log(JSON.stringify({ workflow_runs: listed.filter((listedRun) => !event || listedRun.event === event) }));
`;

export function servingProduction(build: string | null = null) {
  const serving = { build, requested: [] as string[] };
  const server = createServer((request, response) => {
    serving.requested.push(request.url ?? "");
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ status: "ok", database: "ok", build: serving.build }));
  });
  onTestFinished(() => void server.close());
  return new Promise<typeof serving & { healthUrl: string }>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve(Object.assign(serving, { healthUrl: `http://127.0.0.1:${typeof address === "object" && address !== null ? address.port : 0}/api/health` }));
    });
  });
}

export function shipping() {
  const root = scratch("ship-");
  const { remote, session } = clonedOn(root, "main", ["base"]);
  const state = join(root, "gh-state");
  const waited = join(state, "waited");
  for (const dir of ["runs", "plans"]) mkdirSync(join(state, dir), { recursive: true });
  writeFileSync(join(state, "open-issues"), "");
  mkdirSync(join(root, "bin"));
  writeFileSync(join(root, "bin", "gh"), SHIP_GH, { mode: 0o755 });
  script(join(root, "bin", "deploy-wait"), `printf %s "$1" >${JSON.stringify(waited)}\n`);
  const shipEnv = (extra: Record<string, string>) => ({ PATH: `${join(root, "bin")}:${process.env.PATH}`, SHIP_GH_STATE: state, SHIP_DEPLOY_DEADLINE_SECONDS: "0", GITHUB_REPOSITORY_OWNER: "owner-login", GITHUB_RUN_ID: "", GITHUB_EVENT_NAME: "", ...extra });
  const recorded = (name: string) => (existsSync(join(state, name)) ? readFileSync(join(state, name), "utf8").trim().split("\n") : []);
  const land = (name: string, runs: ShipRun[] | null, file = name): string => {
    plant(session, file, name);
    git(session, "add", "-A");
    git(session, "commit", "--quiet", "-m", name);
    git(session, "push", "--quiet", "origin", "HEAD:refs/heads/main");
    const sha = git(session, "rev-parse", "HEAD");
    writeFileSync(join(state, "runs", sha), JSON.stringify((runs ?? []).map((ciRun, at) => ({ id: at + 1, ...ciRun }))));
    return sha;
  };
  const live = land("live", FULL_CHECK_PASSED);
  git(session, "push", "--quiet", "origin", "HEAD:refs/heads/release");
  return {
    live,
    land,
    fullCheckWillBe: (sha: string, ...conclusions: (string | null)[]) => writeFileSync(join(state, "plans", sha), JSON.stringify(conclusions.map((conclusion) => ({ conclusion })))),
    openIssue: (number: number) => writeFileSync(join(state, "open-issues"), `${number}\n`),
    shipDispatchedAt: (createdAt: string) => writeFileSync(join(state, "ship-dispatches"), JSON.stringify([{ created_at: createdAt, event: "workflow_dispatch" }])),
    run: (args: string[] = [], extra: Record<string, string> = {}) => execute(join(BIN, "ship"), session, shipEnv(extra), args),
    runAsync: (args: string[] = [], extra: Record<string, string> = {}) =>
      new Promise<Run>((resolve) => {
        const child = spawn(join(BIN, "ship"), args, { cwd: session, env: { ...harnessEnv, ...shipEnv(extra) } });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
        child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
        child.on("close", (status) => resolve({ status, stdout, stderr }));
      }),
    release: () => git(remote, "rev-parse", "release"),
    waitedOn: () => (existsSync(waited) ? readFileSync(waited, "utf8") : undefined),
    dispatched: () => recorded("dispatch-log").filter(Boolean),
    issues: () => recorded("issue-calls").filter(Boolean).map((line) => JSON.parse(line) as string[]),
  };
}

const shippingNext = (runs: ShipRun[] | null): Run => {
  const app = shipping();
  app.land("next", runs);
  return app.run();
};

declarePart({
  part: {
    name: "bin/ship",
    file: "bin/ship",
    stops: "https://github.com/collod873/Mezzanine/issues/2495",
    printsData: true,
  },
  scenarios: [
    { label: "shipping a commit that passed the full check", run: () => shippingNext(FULL_CHECK_PASSED) },
    { label: "holding a commit whose full check is red", run: () => shippingNext(null) },
    { label: "refusing a daily run with no health URL", run: () => shipping().run(["--daily"]) },
    { label: "showing its help", run: () => shipping().run(["--help"]) },
  ],
});
