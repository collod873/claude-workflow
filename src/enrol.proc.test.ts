import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
const ENROLLED_REVIEW = "tickets / review";
import { MACHINE } from "./spelled.ts";
import { bare, checkJobRule, ci, CI_ON_EVERY_PR, DEPLOY, ENROLLED as REPO, enrolling, home, HOME, key, PC_RUNS_ON } from "./scenarios.ts";

const CALLER = readFileSync(join(import.meta.dirname, "..", ".github", "caller.yml"), "utf8");
const OFFER = `enrol: \`bin/runner ${REPO} pc\` moves its jobs to this PC; run one fresh full check there and watch its peak memory before leaving it on\n`;

describe("bin/enrol leaves a repo with everything Lumaria was given by hand (#1152)", () => {
  it("writes the caller file, reaches it with the App, sets every secret, label and auto-merge, and holds main for check alone, since the reviewer lands what it reviews (ADR-0012)", () => {
    const { run, held } = enrolling(bare());

    const result = run();

    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    const after = held();
    expect(after.reached).toContain(REPO);
    expect(after.variables).toEqual(["CORE_APP_CLIENT_ID"]);
    expect(after.secrets.sort()).toEqual(["CLAUDE_CODE_OAUTH_TOKEN", "CORE_APP_PRIVATE_KEY"]);
    expect(after.dependabot).toEqual(["CORE_APP_PRIVATE_KEY"]);
    expect(after.labels).toEqual(expect.arrayContaining(["bug", "ticket", "spec", "note", "research", "building", "checking", "waiting", "stuck"]));
    expect(after.labels).not.toContain("try-");
    expect(after.allow_auto_merge).toBe(true);
    expect(after.rules.map(({ type }) => type)).toEqual(expect.arrayContaining(["pull_request", "required_status_checks"]));
    expect(JSON.stringify(after.rules)).toContain('"context":"check"');
    expect(JSON.stringify(after.rules)).not.toContain(ENROLLED_REVIEW);
    expect(result.stdout).toBe(`enrol: ${REPO} enrolled, 9 settings set\n${OFFER}`);
  });

  it("writes .github/caller.yml as it stands, since it hears no CI run (#1447)", () => {
    const { run, held } = enrolling(bare());

    run();

    expect(held().files[".github/workflows/machine.yml"]).toBe(CALLER);
  });

  it("commits the caller file and titles its PR as a conventional commit, which a commitlinted repo like Lumaria checks (#1251)", () => {
    for (const held of [bare(), bare({ rules: [{ type: "pull_request" }] })]) {
      const { run, held: after } = enrolling(held);

      run();

      const said = after().writes.flatMap((args) => args.flatMap((arg, at) => (args[at - 1] === "--title" ? [arg] : args[at - 1] === "-f" && arg.startsWith("message=") ? [arg.slice("message=".length)] : [])));
      expect(said.length).toBeGreaterThan(0);
      for (const message of said) expect(message).toMatch(/^ci: [a-z]/);
    }
  });

  it("sets each secret from the value in its own environment variable", () => {
    const { run, held } = enrolling(bare());

    run();

    expect(held().writes.filter((args) => args[0] === "secret").map((args) => `${args[2]} ${args.includes("dependabot") ? "dependabot " : ""}${args.at(-1)}`).sort()).toEqual([
      "CLAUDE_CODE_OAUTH_TOKEN value sk-token",
      `CORE_APP_PRIVATE_KEY dependabot value ${key()}`,
      `CORE_APP_PRIVATE_KEY value ${key()}`,
    ]);
  });

  it("changes nothing on a repo it already enrolled, and says so", () => {
    const { run, held } = enrolling(bare());
    run();
    const before = held().writes.length;

    const again = run();

    expect(again).toEqual({ status: 0, stdout: `enrol: ${REPO} was already enrolled, nothing changed\n${OFFER}`, stderr: "" });
    expect(held().writes).toHaveLength(before);
  });

  it("refuses and names what it could not set, setting the rest", () => {
    const { run, held } = enrolling(bare({ refused: { "allow_auto_merge=true": "gh: Must have admin rights to Repository. (HTTP 403)" } }), { CORE_APP_PRIVATE_KEY: key() });

    const result = run();

    expect(result.status).toBe(1);
    expect(result.stderr.trimEnd().split("\n")).toEqual([
      `enrol: ${REPO} is not enrolled, 3 could not be set and 6 were:`,
      "- CLAUDE_CODE_OAUTH_TOKEN: no CLAUDE_CODE_OAUTH_TOKEN in the environment to set it from",
      "- auto-merge: gh: Must have admin rights to Repository. (HTTP 403)",
      "- the caller file, check-job rule and pre-push: auto-merge is off, so a PR for it would never merge on its own",
    ]);
    expect(held().labels).toContain("ticket");
    expect(held().dependabot).toEqual(["CORE_APP_PRIVATE_KEY"]);
  });

  it("shows four of its refusals and counts the rest when GitHub refuses every call", () => {
    const { run } = enrolling(bare({ refused: { "": "gh: Bad credentials (HTTP 401)" } }));

    const result = run();

    expect(result.status).toBe(1);
    const [headline, ...shown] = result.stderr.trimEnd().split("\n");
    expect(headline).toBe(`enrol: ${REPO} is not enrolled, 11 could not be set and 0 were:`);
    expect(shown).toHaveLength(5);
    for (const line of shown.slice(0, 4)) expect(line).toMatch(/^- .+: gh: Bad credentials \(HTTP 401\)$/);
    expect(shown[4]).toBe("- and 7 more");
  });

  it("refuses the caller file when no one workflow runs a check job on pull requests, naming them", () => {
    const { run, held } = enrolling(bare({ files: { ".github/workflows/deploy.yml": DEPLOY } }));

    const result = run();

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("- the caller file, check-job rule and pre-push: no workflow in .github/workflows runs a `check` job on pull requests, so there is no CI to name");
    expect(held().files[".github/workflows/machine.yml"]).toBeUndefined();
    expect(held().rules).toEqual([]);
  });

  it("leaves the App's access alone where it reaches every repo", () => {
    const { run, writes } = enrolling(bare({ selection: "all" }));

    expect(run().status).toBe(0);
    expect(writes().filter((call) => call.includes("installations"))).toEqual([]);
  });

  it("refuses anything but one owner/name", () => {
    const { run, writes } = enrolling(bare());

    expect(run("Next")).toEqual({ status: 2, stdout: "", stderr: "enrol: usage: enrol <owner/repo> [--caller]\n" });
    expect(run(REPO, "--labels")).toEqual({ status: 2, stdout: "", stderr: "enrol: usage: enrol <owner/repo> [--caller]\n" });
    expect(writes()).toEqual([]);
  });
});

const STALE = CALLER.replace("labeled, unlabeled, closed]", "labeled, unlabeled]");
const HELD_FOR_CHECK = [{ type: "pull_request" }, { type: "required_status_checks", parameters: { required_status_checks: [{ context: "check" }] } }];

describe("bin/enrol keeps an enrolled repo current with the owner's own login (#1155)", () => {
  it("unpins check from GitHub Actions in the ruleset main already has, so the status a pre-push posts satisfies it, drops the retired review from it, and adds no second ruleset (#1344, ADR-0012)", () => {
    const pinned = [
      { type: "pull_request", ruleset_id: 7 },
      { type: "required_status_checks", ruleset_id: 7, parameters: { strict_required_status_checks_policy: true, required_status_checks: [{ context: "check", integration_id: 15368 }, { context: ENROLLED_REVIEW, integration_id: 15368 }] } },
    ];
    const { run, held } = enrolling(bare({ rules: pinned, allow_auto_merge: true, files: { ".github/workflows/ci.yml": ci().replace("name: Gate", "name: CI"), ".github/workflows/machine.yml": CALLER } }));

    const result = run();

    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    const after = held();
    expect(JSON.stringify(after.rules)).not.toContain("integration_id");
    expect(JSON.stringify(after.rules)).not.toContain(ENROLLED_REVIEW);
    expect(after.rules.filter(({ type }) => type === "required_status_checks")).toHaveLength(1);
    expect(new Set(after.writes.filter((args) => args.includes("ruleset")).map((args) => args.slice(0, 4).join(" ")))).toEqual(new Set([`api -X PUT repos/${REPO}/rulesets/7`]));
  });

  it("adds the PR-only rules to the ruleset main already holds for check, so the caller file then goes through a PR and not a refused write to main (workout-tracker, 2026-10-20)", () => {
    const checkOnly = [{ type: "required_status_checks", ruleset_id: 7, parameters: { strict_required_status_checks_policy: true, required_status_checks: [{ context: "check", integration_id: 15368 }] } }];
    const { run, held } = enrolling(bare({ rules: checkOnly, allow_auto_merge: true, files: { ".github/workflows/ci.yml": ci().replace("name: Gate", "name: CI"), ".github/workflows/machine.yml": STALE } }));

    run();

    const after = held();
    expect(after.rules.filter(({ ruleset_id }) => ruleset_id === 7).map(({ type }) => type).sort()).toEqual(["deletion", "non_fast_forward", "pull_request", "required_status_checks"]);
    expect(JSON.stringify(after.rules)).not.toContain("integration_id");
    expect(after.files[".github/workflows/machine.yml"]).toBe(CALLER);
    expect(after.writes.find((args) => args[0] === "pr" && args[1] === "merge")).toEqual(expect.arrayContaining(["--auto"]));
  });

  it("brings a stale caller file up to date through a PR that merges on its own once check passes, where main takes changes only through a PR", () => {
    const { run, held } = enrolling(bare({ rules: HELD_FOR_CHECK, allow_auto_merge: true, files: { ".github/workflows/ci.yml": ci().replace("name: Gate", "name: CI"), ".github/workflows/machine.yml": STALE } }));

    const result = run();

    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(held().files[".github/workflows/machine.yml"]).toBe(CALLER);
    const merged = held().writes.find((args) => args[0] === "pr" && args[1] === "merge") ?? [];
    expect(merged).toEqual(expect.arrayContaining(["--auto"]));
  });

  it("brings only the caller file current under --caller, as the machine's own token can from a push to its main, leaving the owner's secrets, labels and rules alone (#1297)", () => {
    const { run, held } = enrolling(bare({ rules: HELD_FOR_CHECK, allow_auto_merge: true, files: { ".github/workflows/ci.yml": ci().replace("name: Gate", "name: CI"), ".github/workflows/machine.yml": STALE } }), {});

    const result = run(REPO, "--caller");

    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(held().files[".github/workflows/machine.yml"]).toBe(CALLER);
    expect(held().variables).toEqual([]);
    expect(held().secrets).toEqual([]);
    expect(held().labels).not.toContain("ticket");
    expect(JSON.stringify(held().rules)).not.toContain(ENROLLED_REVIEW);
    expect(result.stdout).toBe(`enrol: ${REPO} enrolled, 1 settings set\n`);
  });

  it("takes off the queued, resolving and landing labels under --caller, since nothing marks them since one run builds, reviews and lands a ticket (ADR-0012, #1447)", () => {
    const { run, held } = enrolling(bare({ rules: HELD_FOR_CHECK, allow_auto_merge: true, labels: ["bug", "queued", "resolving", "landing", "stuck"], files: { ".github/workflows/ci.yml": ci().replace("name: Gate", "name: CI"), ".github/workflows/machine.yml": CALLER } }), {});

    const result = run(REPO, "--caller");

    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(held().labels).toEqual(["bug", "stuck"]);
    expect(run(REPO, "--caller").stdout).toBe(`enrol: ${REPO} was already enrolled, nothing changed\n`);
  });

  it("opens the PR afresh from main when a branch is left from an earlier enrolment", () => {
    const { run, held } = enrolling(bare({ rules: HELD_FOR_CHECK, allow_auto_merge: true, branches: { "enrol/caller": { "old.txt": "old" } } }));

    expect(run().status).toBe(0);
    expect(held().files[".github/workflows/machine.yml"]).toBeDefined();
    expect(held().files["old.txt"]).toBeUndefined();
  });

  it("refuses the App's access, naming the key, when no CORE_APP_PRIVATE_KEY is in the environment to read it with", () => {
    const { run } = enrolling(bare(), { CLAUDE_CODE_OAUTH_TOKEN: "sk-token" });

    expect(run().stderr).toContain("- the App's access: no CORE_APP_PRIVATE_KEY in the environment to read the App's access with");
  });

  it("writes the caller file straight to main where main still takes direct pushes, opening no PR", () => {
    const { run, held } = enrolling(bare({ files: { ".github/workflows/ci.yml": ci().replace("name: Gate", "name: CI") }, refused: { "/rulesets": "gh: Upgrade to GitHub Pro to enable this feature (HTTP 403)" } }));

    run();

    expect(held().files[".github/workflows/machine.yml"]).toBe(CALLER);
    expect(held().writes.filter((args) => args[0] === "pr")).toEqual([]);
  });

  it("refuses the caller file before opening anything when auto-merge is off, since its PR would never merge on its own", () => {
    const { run, held } = enrolling(bare({ rules: HELD_FOR_CHECK, refused: { "allow_auto_merge=true": "gh: Must have admin rights to Repository. (HTTP 403)" } }));

    expect(run().stderr).toContain("- the caller file, check-job rule and pre-push: auto-merge is off, so a PR for it would never merge on its own");
    expect(held().prs).toEqual([]);
    expect(held().branches).toEqual({});
  });

  it("closes its PR and deletes its branch when GitHub refuses to merge the PR on its own", () => {
    const { run, held } = enrolling(bare({ rules: HELD_FOR_CHECK, allow_auto_merge: true, refused: { "pr merge": "GraphQL: Pull request Protected branch rules not configured for this branch (enablePullRequestAutoMerge)" } }));

    expect(run().stderr).toContain("- the caller file, check-job rule and pre-push: GraphQL: Pull request Protected branch rules not configured");
    expect(held().prs).toEqual([]);
    expect(held().branches).toEqual({});
  });

  it("names the merge refusal and the failed cleanup when cleaning up its PR fails too", () => {
    const { run, held } = enrolling(bare({ rules: HELD_FOR_CHECK, allow_auto_merge: true, refused: { "pr merge": "GraphQL: Protected branch rules not configured", "pr close": "gh: Resource not accessible (HTTP 403)" } }));

    expect(run().stderr).toContain("- the caller file, check-job rule and pre-push: GraphQL: Protected branch rules not configured, and cleaning up its PR and branch failed too: gh: Resource not accessible (HTTP 403)");
    expect(held().prs).toHaveLength(1);
  });

  it("deletes its branch, leaving no PR, when GitHub refuses to open the PR (#1157)", () => {
    const { run, held } = enrolling(bare({ rules: HELD_FOR_CHECK, allow_auto_merge: true, refused: { "pr create": "pull request create failed: GraphQL: Resource not accessible by integration (createPullRequest)" } }));

    expect(run().stderr).toContain("- the caller file, check-job rule and pre-push: pull request create failed: GraphQL: Resource not accessible by integration");
    expect(held().prs).toEqual([]);
    expect(held().branches).toEqual({});
  });

  it("deletes its branch when GitHub refuses the caller file written to it (#1157)", () => {
    const { run, held } = enrolling(bare({ rules: HELD_FOR_CHECK, allow_auto_merge: true, refused: { "branch=enrol/caller": "gh: Resource not accessible by integration (HTTP 403)" } }));

    expect(run().stderr).toContain("- the caller file, check-job rule and pre-push: gh: Resource not accessible by integration (HTTP 403)");
    expect(held().prs).toEqual([]);
    expect(held().branches).toEqual({});
  });

  it("holds main with rulesets that take a branch behind main, since land rebases before it checks and a strict rule reruns the full check each time main moves (agent-hooks#176)", () => {
    const { run, held } = enrolling(bare());

    expect(run().status).toBe(0);
    const required = held().rules.filter(({ type }) => type === "required_status_checks");
    expect(required.map(({ parameters }) => (parameters as { strict_required_status_checks_policy?: boolean }).strict_required_status_checks_policy)).toEqual([false]);
  });

  it("names the caller PR still waiting on check, and leaves it alone on a re-run (#1285)", () => {
    const { run, held } = enrolling(bare({ rules: HELD_FOR_CHECK, allow_auto_merge: true, pending: true, files: { ".github/workflows/ci.yml": ci(), ".github/workflows/machine.yml": STALE } }));
    const pr = `https://github.com/${REPO}/pull/900 merges on its own once check passes`;
    const waiting = `- the caller file, check-job rule and pre-push: ${pr}`;

    expect(run().stdout).toBe(`enrol: ${REPO} is enrolled once its PR merges, 7 settings set:\n${waiting}\n${OFFER}`);
    const before = held().writes.length;

    expect(run()).toEqual({ status: 0, stdout: `enrol: ${REPO} is enrolled once its PR merges, 0 settings set:\n${waiting}\n${OFFER}`, stderr: "" });
    expect(held().writes).toHaveLength(before);
    expect(held().prs.map(({ auto }) => auto)).toEqual([true]);
  });
});

describe("bin/enrol drops the review main required, since the reviewer lands what it reviews in the run that built it (ADR-0012)", () => {
  const CHECK_RULES = [
    { type: "pull_request", ruleset_id: 7 },
    { type: "required_status_checks", ruleset_id: 7, parameters: { strict_required_status_checks_policy: true, required_status_checks: [{ context: "check" }] } },
  ];
  const REVIEW_RULESET = { type: "required_status_checks", ruleset_id: 8, parameters: { strict_required_status_checks_policy: true, required_status_checks: [{ context: ENROLLED_REVIEW }] } };
  const SHARED = [{ type: "pull_request", ruleset_id: 7 }, { type: "required_status_checks", ruleset_id: 7, parameters: { strict_required_status_checks_policy: true, required_status_checks: [{ context: "check" }, { context: ENROLLED_REVIEW }] } }];
  const enrolled = (rules: ReturnType<typeof bare>["rules"]) => bare({ rules, allow_auto_merge: true, files: { ".github/workflows/ci.yml": ci(), ".github/workflows/machine.yml": CALLER.replace("workflows: [CI]\n", "workflows: [Gate]\n") } });

  it.each([
    ["deletes the review's own ruleset", [...CHECK_RULES, REVIEW_RULESET]],
    ["drops the review from the ruleset it shares with check", SHARED],
  ])("%s, keeping main held for check through a PR", (_, rules) => {
    const { run, held } = enrolling(enrolled(rules));

    expect(run()).toMatchObject({ status: 0, stderr: "" });
    const after = held();
    expect(JSON.stringify(after.rules)).not.toContain(ENROLLED_REVIEW);
    expect(after.rules.filter(({ ruleset_id }) => ruleset_id === 7).map(({ type }) => type).sort()).toEqual(["pull_request", "required_status_checks"]);
    expect(JSON.stringify(after.rules)).toContain('"context":"check"');
  });
});

const HELD_OFF_THE_PC = [
  "name: Gate",
  "on:",
  "  pull_request:",
  "jobs:",
  "  check:",
  `    if: \${{ !(github.event.sender.login == '${MACHINE}') }}`,
  "    runs-on: ubuntu-latest",
  "    services:",
  "      postgres:",
  "        image: postgres:16",
  "        ports:",
  '          - "5432:5432"',
  "          - 6379",
  "    steps:",
  "      - run: pnpm check",
  "  machine:",
  "    uses: collod873/claude-workflow/.github/workflows/tickets.yml@main",
  "",
].join("\n");

describe("bin/enrol says what a repo needs before its jobs suit this PC's runners, and how to move them (#1270)", () => {

  it("names each job left on GitHub's runners, a check that skips check's slots and a pinned host port, then offers bin/runner", () => {
    const { run } = enrolling(bare({ files: { ".github/workflows/ci.yml": HELD_OFF_THE_PC, ".github/workflows/deploy.yml": DEPLOY } }));

    const result = run();

    expect(result.status).toBe(0);
    expect(result.stdout.split("\n").slice(1)).toEqual([
      `enrol: ${REPO} needs 3 changes for PC runners:`,
      `- ci.yml's check job runs on ubuntu-latest, not ${PC_RUNS_ON}, so it stays on GitHub's runners`,
      "- ci.yml's check job runs its check without check, so it skips the PC's check slots",
      "- ci.yml's check job pins host port 5432 for postgres, which two PC runners cannot share",
      ...OFFER.split("\n"),
    ]);
  });

});

const LANDED = { rules: HELD_FOR_CHECK, allow_auto_merge: true };
const TWO_JOBS = CI_ON_EVERY_PR.replace("jobs:\n", "jobs:\n  lint: # kept as written\n    runs-on: 'ubuntu-latest'\n    steps:\n      - run: npm run lint\n");
const RULED_TWO_JOBS = TWO_JOBS.replace("  check:\n", ["  check:", ...checkJobRule(), ""].join("\n"));
const EARLIER_RULE = checkJobRule().map((line) => line.replaceAll(" && !startsWith(github.head_ref, 'enrol/')", ""));
const EARLIER_TWO_JOBS = TWO_JOBS.replace("  check:\n", ["  check:", ...EARLIER_RULE, ""].join("\n"));

describe("bin/enrol brings an enrolled repo's CI check job to this repo's and takes out its pre-push, in the one PR its caller file goes through, so a change lands once here and land is the one gate (#1368, agent-hooks#176)", () => {
  const STALE_MAIN = { ".github/workflows/ci.yml": TWO_JOBS, ".github/workflows/machine.yml": STALE, ".husky/pre-push": "pnpm check\n" };
  const CALLER_ONLY_BRANCH = { ...STALE_MAIN, ".github/workflows/machine.yml": CALLER.replace("[CI]", "[Gate]") };

  it.each([
    ["opens one PR", {}],
    ["updates the open PR that carries only the caller file", { branches: { "enrol/caller": CALLER_ONLY_BRANCH }, prs: [{ number: 900, head: "enrol/caller", auto: true }] }],
    ["rewrites the open PR whose rule is an earlier one, so a change to the rule reaches it (#1386)", { branches: { "enrol/caller": { ...CALLER_ONLY_BRANCH, ".github/workflows/ci.yml": EARLIER_TWO_JOBS } }, prs: [{ number: 900, head: "enrol/caller", auto: true }] }],
  ])("%s adding the check-job rule to the check job alone, keeping every other byte, and deleting the pre-push", (_, open) => {
    const { run, held } = enrolling(bare({ ...LANDED, pending: true, files: STALE_MAIN, ...open }), {});

    const result = run(REPO, "--caller");

    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    const after = held();
    expect(after.prs).toHaveLength(1);
    expect(after.branches["enrol/caller"]?.[".github/workflows/ci.yml"]).toBe(RULED_TWO_JOBS);
    expect(after.branches["enrol/caller"]?.[".husky/pre-push"]).toBeUndefined();
    expect(after.files[".husky/pre-push"]).toBe("pnpm check\n");
  });

  it("leaves a repo alone whose main already carries the caller file and the rule, and no pre-push", () => {
    const { run, held } = enrolling(bare({ ...LANDED, files: { ".github/workflows/ci.yml": RULED_TWO_JOBS, ".github/workflows/machine.yml": CALLER.replace("[CI]", "[Gate]") } }), {});

    expect(run(REPO, "--caller")).toEqual({ status: 0, stdout: `enrol: ${REPO} was already enrolled, nothing changed\n`, stderr: "" });
    expect(held().writes).toEqual([]);
  });

  it("writes no pre-push in a repo with a package.json, since land judges every landing (agent-hooks#176)", () => {
    const { run, held } = enrolling(bare({ files: { ...bare().files, "package.json": "{}\n" } }));

    const result = run();

    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(held().files[".github/workflows/machine.yml"]).toBeDefined();
    expect(held().files[".husky/pre-push"]).toBeUndefined();
  });

  it("finds a check job by its id when its name is an earlier rule's text, and brings it to the rule (#1386)", () => {
    expect(EARLIER_RULE).not.toEqual(checkJobRule());
    const { run, held } = enrolling(bare({ ...LANDED, pending: true, files: { ...STALE_MAIN, ".github/workflows/ci.yml": EARLIER_TWO_JOBS } }), {});

    const result = run(REPO, "--caller");

    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(held().branches["enrol/caller"]?.[".github/workflows/ci.yml"]).toBe(RULED_TWO_JOBS);
  });

  it("refuses by name a CI with two check jobs on pull requests, writing nothing", () => {
    const twice = CI_ON_EVERY_PR + "  other:\n    name: check\n    runs-on: ubuntu-latest\n    steps:\n      - run: check\n";
    const { run, held } = enrolling(bare({ ...LANDED, files: { ".github/workflows/ci.yml": twice } }), {});

    const result = run(REPO, "--caller");

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("ci.yml runs more than one `check` job on pull requests: check, other");
    expect(held().branches).toEqual({});
  });
});

describe("bin/enrol on this repo drops the plain review main required, under --caller as the machine's own token runs it (ADR-0012)", () => {
  it("keeps check alone in main's required checks, keeping every other rule", () => {
    const { run, held } = enrolling(home(), {});

    const result = run(HOME, "--caller");

    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    const checks = held().rules.flatMap(({ parameters }) => (parameters as { required_status_checks?: { context: string }[] } | undefined)?.required_status_checks ?? []).map(({ context }) => context);
    expect(checks).toEqual(["check"]);
    expect(held().rules.map(({ type }) => type).sort()).toEqual(["pull_request", "required_status_checks"]);
    expect(held().prs).toEqual([]);
  });

  it.each([
    ["waits on bin/enrol run on the owner's token, ending green on one line, when GitHub refuses the App's token the ruleset write (#1389)", "gh: Resource not accessible by integration (HTTP 403)", 0],
    ["still ends red on any other refusal of the ruleset write", "gh: Validation Failed (HTTP 422)", 1],
  ])("%s", (_, refusal, status) => {
    const { run, held } = enrolling({ ...home(), refused: { "rulesets/3 --input": refusal } }, {});

    const result = run(HOME, "--caller");

    expect(result.status).toBe(status);
    if (status === 0) expect(result).toMatchObject({ stderr: "", stdout: `enrol: ${HOME} was already enrolled, nothing changed\nenrol: ${HOME}: dropping ${ENROLLED_REVIEW} and review from main's required checks waits on bin/enrol run on the owner's token\n` });
    else expect(result.stderr).toContain(refusal);
    expect(JSON.stringify(held().rules)).toContain('"context":"review"');
  });
});
