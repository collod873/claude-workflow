import { generateKeyPairSync } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CHECK_PASSES } from "./builder.part.ts";
import { BRIEF, BUILDS, ONTO, SLICE, SLICE_SESSION, SPEC, slicing } from "./slice-builder.part.ts";
import { BIN, execute, scratch } from "./scenarios.ts";
import { OUT_OF_TIME } from "./slice-builder.ts";

const ending = (stdout: string) => JSON.parse(stdout.trim().split("\n").at(-1) ?? "") as { outcome: string; left: string; reason: string; session: string };
const envOf = (dump: string | undefined, name: string) => new RegExp(`^${name}=(.*)$`, "m").exec(dump ?? "")?.[1];
const fastForwards = (log: (...args: string[]) => string, from: string) => log("merge-base", "--is-ancestor", from, "HEAD") === "";
const MOVES_ONTO = `git update-ref refs/heads/${ONTO} elsewhere\n`;
const CHECK_RED_ONCE = [
  `if [ -f ../checked-once ]; then ${CHECK_PASSES.trim()}; exit 0; fi`,
  "touch ../checked-once",
  'log="$(git rev-parse --absolute-git-dir)/check-red.log"',
  "printf -- '--- test ---\\nOTHER-TEST-BROKE in src/zone.test.ts\\n' >\"$log\"",
  "printf 'check: red test src/zone.test.ts:4; log %s\\n' \"$log\"",
  "exit 1",
  "",
].join("\n");
const DATABASE_STEP = '{ "steps": { "lint": { "run": "true" }, "integration": { "run": "true", "needs": ["DATABASE_URL"] } } }\n';
const TIMES_OUT_ON_CALL = (call: number) => `[ "$CALL" = ${call} ] && { printf '{"type":"system","session_id":"${SLICE_SESSION}"}\\n'; exit 124; }\n`;
const CONTAINER = `database-collod873-Lumaria-GitHub-Actions-7-${SPEC}-${SLICE}`;

const handedBackOnce = (builder: ReturnType<typeof slicing>) => {
  const result = builder.run();
  expect(result.status, result.stderr).toBe(0);
  expect(ending(result.stdout).outcome).toBe("built");
  expect(builder.handed()).toHaveLength(2);
  return builder.handed()[1] ?? "";
};

const isolationOf = (builder: ReturnType<typeof slicing>) => {
  const [model] = builder.ranWith("claude");
  return { temp: envOf(model, "TMPDIR") ?? "", port: envOf(model, "PORT") ?? "" };
};

describe("a fresh builder builds one slice of a spec in its own worktree until its branch fast-forwards the integration branch (ADR-0013)", () => {
  it("hires a fresh Opus builder with the slice's brief and tdd, runs only the fast check, and ends on a built line once its branch fast-forwards the integration branch", () => {
    const { run, hired, handed, checked, log } = slicing();

    const result = run();

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.trim().split("\n")).toHaveLength(1);
    expect(ending(result.stdout)).toEqual({ outcome: "built", left: "", reason: "a job time shows in the tenant's zone", session: SLICE_SESSION });
    const [argv = []] = hired();
    expect(argv[argv.indexOf("--model") + 1]).toBe("opus");
    expect(argv).not.toContain("--resume");
    expect(handed()[0]).toContain(BRIEF);
    expect(handed()[0]).toContain("Call the Skill tool with `tdd`");
    expect(checked()).toEqual(["check"]);
    expect(log("rev-list", "--count", `${ONTO}..HEAD`)).toBe("1");
    expect(fastForwards(log, ONTO)).toBe(true);
  });

  it("puts the `Slice:` trailer on every commit past the integration branch, the builder's and the leftovers the machine commits, so the final reviewers can split the diff per slice", () => {
    const { run, log } = slicing({ claude: `${BUILDS}printf 'left over\\n' >src/left.ts\n` });

    expect(run().status).toBe(0);
    expect(log("log", "--format=%s|%(trailers:key=Slice,valueonly,separator=%x2C)", `${ONTO}..HEAD`).split("\n")).toEqual([`Build slice ${SLICE} of #${SPEC}|${SLICE}`, `Show the tenant's time zone|${SLICE}`]);
  });

  it("hands a red fast check back to the same session with the log its verdict names, then ends built", () => {
    const builder = slicing({ check: CHECK_RED_ONCE });

    const repair = handedBackOnce(builder);

    expect(repair).toContain("`check` is red on this branch");
    expect(repair).toContain("OTHER-TEST-BROKE in src/zone.test.ts");
    const [, again = []] = builder.hired();
    expect(again[again.indexOf("--resume") + 1]).toBe(SLICE_SESSION);
    expect(builder.checked()).toEqual(["check", "check"]);
  });

  it("at its time cap tells the builder to hand back what holds, and ends on the partial it gives", () => {
    const left = "Invoices still show times in UTC.";
    const { run, handed, log } = slicing({ stageMinutes: "6", claude: `${TIMES_OUT_ON_CALL(1)}${BUILDS}`, answers: [undefined, { outcome: "partial", reason: "the zone shows on jobs only", left }] });

    const result = run();

    expect(result.status, result.stderr).toBe(0);
    expect(handed()[1]).toBe(OUT_OF_TIME);
    expect(ending(result.stdout)).toMatchObject({ outcome: "partial", left });
    expect(fastForwards(log, ONTO)).toBe(true);
  });

  it("ends out of time, exit 1, when its builder gives no answer even in the minutes kept for its hand-back", () => {
    const { run, handed } = slicing({ stageMinutes: "6", claude: TIMES_OUT_ON_CALL(1) + TIMES_OUT_ON_CALL(2) });

    const result = run();

    expect(result.status).toBe(1);
    expect(handed()).toHaveLength(2);
    expect(ending(result.stdout)).toMatchObject({ outcome: "outOfTime", session: SLICE_SESSION });
    expect(ending(result.stdout).reason).toContain("ran past its 6 minute cap");
  });

  it("rebases onto the integration branch's tip itself when another slice landed while it built, asking the builder nothing more", () => {
    const { run, handed, log } = slicing({ elsewhere: { "src/other.ts": "export const other = 1;\n" }, claude: `${MOVES_ONTO}${BUILDS}` });

    const result = run();

    expect(result.status, result.stderr).toBe(0);
    expect(handed()).toHaveLength(1);
    expect(fastForwards(log, ONTO)).toBe(true);
    expect(log("rev-parse", ONTO)).toBe(log("rev-parse", "elsewhere"));
    expect(log("log", "--format=%(trailers:key=Slice,valueonly)", "-1")).toBe(SLICE);
  });

  it("hands a conflict with the integration branch's new tip back to the builder to resolve, then ends built on that tip", () => {
    const resolves = `if [ "$CALL" = 1 ]; then ${MOVES_ONTO.trim()}; ${BUILDS.trim().split("\n").join("; ")}; else git rebase --quiet ${ONTO} >/dev/null 2>&1 || { printf 'export const zone = "both";\\n' >src/zone.ts; git add src/zone.ts; GIT_EDITOR=true git rebase --continue >/dev/null 2>&1; }; fi\n`;
    const builder = slicing({ elsewhere: { "src/zone.ts": 'export const zone = "Europe/Paris";\n' }, claude: resolves });
    const { log } = builder;

    expect(handedBackOnce(builder)).toContain(`\`${ONTO}\` moved, and rebasing this branch onto it stopped on a conflict in:\n\nsrc/zone.ts`);
    expect(fastForwards(log, ONTO)).toBe(true);
    expect(log("show", "HEAD:src/zone.ts")).toBe('export const zone = "both";');
  });

  it("refuses a merge commit past the integration branch back to the builder, and ends built once its commits are plain", () => {
    const merges = `if [ "$CALL" = 1 ]; then ${MOVES_ONTO.trim()}; ${BUILDS.trim().split("\n").join("; ")}; git merge --quiet --no-edit ${ONTO}; else git rebase --quiet ${ONTO}; fi\n`;
    const builder = slicing({ elsewhere: { "src/other.ts": "export const other = 1;\n" }, claude: merges });
    const { log } = builder;

    expect(handedBackOnce(builder)).toContain(`This branch must fast-forward \`${ONTO}\` with plain commits, and these past it are merge commits:`);
    expect(log("log", "--merges", "--format=%h", `${ONTO}..HEAD`)).toBe("");
    expect(fastForwards(log, ONTO)).toBe(true);
  });

  it("asks a round that gave no outcome for one, then ends on the outcome it gives", () => {
    const builder = slicing({ answers: [undefined, { outcome: "built", reason: "a job time shows in the tenant's zone" }] });

    expect(handedBackOnce(builder)).toBe("You gave no outcome. Answer one.");
  });

  it("hands `built` or `partial` on a branch with no commits past the integration branch back as nothing built, pointing at `done`", () => {
    for (const outcome of ["built", "partial"]) {
      const { run, handed } = slicing({ claude: ":\n", answers: [{ outcome, reason: "done", ...(outcome === "partial" ? { left: "Invoices." } : {}) }, { outcome: "stuck", reason: "the branch already does it" }] });

      expect(run().status).toBe(1);
      expect(handed()[1]).toBe(`You answered \`${outcome}\`, and this branch has no commits past \`${ONTO}\`: build the slice, or answer \`done\` if \`${ONTO}\` already does what it asks.`);
    }
  });

  it("ends done, exit 0, running no check, when its builder finds the integration branch already does what the slice asks", () => {
    const { run, checked } = slicing({ claude: ":\n", answers: [{ outcome: "done", reason: "another slice already shows the zone" }] });

    const result = run();

    expect(result.status, result.stderr).toBe(0);
    expect(ending(result.stdout)).toEqual({ outcome: "done", left: "", reason: "another slice already shows the zone", session: SLICE_SESSION });
    expect(checked()).toEqual([]);
  });

  it("hands `done` on a branch with commits past the integration branch back, so built work is never thrown away", () => {
    const { run, handed } = slicing({ answers: [{ outcome: "done", reason: "already there" }, { outcome: "built", reason: "a job time shows in the tenant's zone" }] });

    const result = run();

    expect(result.status, result.stderr).toBe(0);
    expect(handed()[1]).toContain(`You answered \`done\`, and this branch has commits past \`${ONTO}\``);
    expect(ending(result.stdout).outcome).toBe("built");
  });

  it("hands a `partial` with no `left` back to name what is left", () => {
    const left = "Invoices still show times in UTC.";
    const { run, handed } = slicing({ answers: [{ outcome: "partial", reason: "the zone shows on jobs only" }, { outcome: "partial", reason: "the zone shows on jobs only", left }] });

    const result = run();

    expect(result.status, result.stderr).toBe(0);
    expect(handed()[1]).toContain("You answered `partial` with no `left`");
    expect(ending(result.stdout)).toMatchObject({ outcome: "partial", left });
  });

  it("keeps a partial's `left` when the builder answers `built` after a red hand-back, and ends partial", () => {
    const left = "Invoices still show times in UTC.";
    const builder = slicing({ check: CHECK_RED_ONCE, answers: [{ outcome: "partial", reason: "the zone shows on jobs only", left }, { outcome: "built", reason: "the check passes" }] });

    const result = builder.run();

    expect(result.status, result.stderr).toBe(0);
    expect(ending(result.stdout)).toMatchObject({ outcome: "partial", left });
  });

  it("ends stopped with the line it stopped on, never a stop key, when it stops before hiring", () => {
    const { run, hired } = slicing();

    const result = run("--brief", "/nowhere/brief.md");

    expect(result.status).toBe(1);
    expect(ending(result.stdout)).toMatchObject({ outcome: "stopped", reason: "the brief /nowhere/brief.md could not be read, so no builder was hired" });
    expect(hired()).toEqual([]);
  });

  it("ends partial with what is left, exit 0, once what it built passes the fast check and fast-forwards the integration branch", () => {
    const { run, checked, log } = slicing({ answers: [{ outcome: "partial", reason: "the zone shows on jobs only", left: "Invoices still show times in UTC." }] });

    const result = run();

    expect(result.status, result.stderr).toBe(0);
    expect(ending(result.stdout)).toEqual({ outcome: "partial", left: "Invoices still show times in UTC.", reason: "the zone shows on jobs only", session: SLICE_SESSION });
    expect(checked()).toEqual(["check"]);
    expect(fastForwards(log, ONTO)).toBe(true);
  });

  it("ends stuck, exit 1, with the builder's reason, running no check", () => {
    const { run, checked } = slicing({ claude: ":\n", answers: [{ outcome: "stuck", reason: "the zone has no source" }] });

    const result = run();

    expect(result.status).toBe(1);
    expect(ending(result.stdout)).toEqual({ outcome: "stuck", left: "", reason: "the zone has no source", session: SLICE_SESSION });
    expect(checked()).toEqual([]);
  });

  it("refuses a call missing what it needs, or naming a slice id that is not kebab-case, before it hires anything", () => {
    const { run, hired, tree } = slicing();

    for (const extra of [["--slice", "Not Kebab"], ["--spec", "next"], ["--unknown", "x"]]) {
      const refused = run(...extra);
      expect(refused.status, extra.join(" ")).toBe(2);
      expect(refused.stderr).toContain("build-slice: usage:");
    }
    expect(execute(join(BIN, "build-slice"), tree, {}, ["--help"]).status).toBe(0);
    expect(hired()).toEqual([]);
  });
});

describe("a slice's builder resumes where it was stopped", () => {
  it("resumes the session it is given with only what it is told", () => {
    const told = "The integration branch moved: bring your slice onto its tip again.";
    const { run, hired, handed } = slicing();

    expect(run("--resume", "sess-earlier", "--told", told).status).toBe(0);
    const [argv = []] = hired();
    expect(argv[argv.indexOf("--resume") + 1]).toBe("sess-earlier");
    expect(handed()[0]).toBe(told);
  });

  it("lands the answer it is given again with no model turn when the integration branch moved after it", () => {
    const { run, handed, log } = slicing({ elsewhere: { "src/other.ts": "export const other = 1;\n" } });
    log("commit", "--quiet", "--allow-empty", "-m", "Show the tenant's time zone");
    log("update-ref", `refs/heads/${ONTO}`, "elsewhere");

    const result = run("--resume", "sess-earlier", "--answer", JSON.stringify({ outcome: "built", reason: "a job time shows in the tenant's zone" }));

    expect(result.status, result.stderr).toBe(0);
    expect(handed()).toEqual([]);
    expect(fastForwards(log, ONTO)).toBe(true);
    expect(ending(result.stdout)).toMatchObject({ outcome: "built", reason: "a job time shows in the tenant's zone" });
  });

  it("hires the session it is given only when landing its answer again turns the check red, keeping the answer's `left`", () => {
    const left = "Invoices still show times in UTC.";
    const { run, handed, hired, log } = slicing({ check: CHECK_RED_ONCE });
    log("commit", "--quiet", "--allow-empty", "-m", "Show the tenant's time zone");

    const result = run("--resume", "sess-earlier", "--answer", JSON.stringify({ outcome: "partial", reason: "the zone shows on jobs only", left }));

    expect(result.status, result.stderr).toBe(0);
    expect(handed()).toHaveLength(1);
    expect(handed()[0]).toContain("`check` is red on this branch");
    const [argv = []] = hired();
    expect(argv[argv.indexOf("--resume") + 1]).toBe("sess-earlier");
    expect(ending(result.stdout)).toMatchObject({ outcome: "partial", left });
  });

  it("resumes the session it is given told to hand back what holds when its last run ran out of time", () => {
    const { run, hired, handed } = slicing();

    expect(run("--resume", "sess-earlier", "--out-of-time").status).toBe(0);
    const [argv = []] = hired();
    expect(argv[argv.indexOf("--resume") + 1]).toBe("sess-earlier");
    expect(handed()[0]).toBe(OUT_OF_TIME);
  });

  it("hands a fresh builder the brief beside what it is told when no session is given", () => {
    const { run, hired, handed } = slicing();

    expect(run("--told", "Build only the job list's times.").status).toBe(0);
    expect(hired()[0]).not.toContain("--resume");
    expect(handed()[0]).toContain(BRIEF);
    expect(handed()[0]).toContain("Build only the job list's times.");
  });

  it("resumes the session saved for its spec and slice when its last run stopped before its last line, and forgets it once built", () => {
    const { run, hired, handed, keptSession } = slicing({ savedSession: "sess-killed" });

    expect(run().status).toBe(0);
    const [argv = []] = hired();
    expect(argv[argv.indexOf("--resume") + 1]).toBe("sess-killed");
    expect(handed()[0]).toContain("Carry on from where this branch stands");
    expect(keptSession()).toBeUndefined();
  });

  it("keeps the session of a stuck builder for its next run, under its own spec and slice alone", () => {
    const root = scratch("slice-builder-");
    const stuck = slicing({ root, claude: ":\n", answers: [{ outcome: "stuck", reason: "the zone has no source" }] });
    const other = slicing({ root, slice: "invoice-time-zone" });

    expect(stuck.run().status).toBe(1);
    expect(other.run().status).toBe(0);
    expect(stuck.keptSession()).toBe(SLICE_SESSION);
    expect(other.hired()[0]).not.toContain("--resume");
  });
});

describe("three builders run at once in one runner job, each with its own Postgres, ports and temp dir, all gone once it ends", () => {
  it("starts postgres:16 named for its repo, runner, spec and slice on a free port when a step needs DATABASE_URL, hands its address to the builder and the check, and removes it on exit", () => {
    const { run, dockered, ranWith } = slicing({ contract: DATABASE_STEP });

    const result = run();

    expect(result.status, result.stderr).toBe(0);
    const calls = dockered();
    expect(calls[0]).toBe('ps --all --filter label=machine.runner=GitHub Actions 7 --format {{.ID}}\t{{.Names}}\t{{.Label "machine.run"}}');
    expect(calls[1]).toMatch(new RegExp(`^run --quiet --detach --name ${CONTAINER} --label machine.runner=GitHub Actions 7 --label machine.run=7001-1 --publish 127\\.0\\.0\\.1::5432 .*postgres:16$`));
    expect(calls.slice(2)).toEqual([`exec ${CONTAINER} pg_isready --quiet --host 127.0.0.1`, `port ${CONTAINER} 5432/tcp`, `rm --force ${CONTAINER}`]);
    const url = "postgres://postgres:postgres@localhost:49153/postgres";
    expect(envOf(ranWith("claude")[0], "DATABASE_URL")).toBe(url);
    expect(envOf(ranWith("check")[0], "DATABASE_URL")).toBe(url);
  });

  it("clears the Postgres an earlier job on its runner left, and its own slice's from a stopped run in this job, never another builder's of this job, since a PC runner keeps containers between jobs", () => {
    const { run, dockered } = slicing({
      contract: DATABASE_STEP,
      containers: [
        ["c0ffee", "database-collod873-Lumaria-GitHub-Actions-7-1400-old-slice", "6990-1"],
        ["beef01", CONTAINER, "7001-1"],
        ["face02", `database-collod873-Lumaria-GitHub-Actions-7-${SPEC}-invoice-time-zone`, "7001-1"],
        ["dead03", "database-collod873-Lumaria-GitHub-Actions-7-1400-old-slice", "7001-2"],
      ],
    });

    expect(run().status).toBe(0);
    expect(dockered()[1]).toBe("rm --force c0ffee beef01 dead03");
  });

  it("removes its Postgres when its builder ends stuck too", () => {
    const { run, dockered } = slicing({ contract: DATABASE_STEP, claude: ":\n", answers: [{ outcome: "stuck", reason: "the zone has no source" }] });

    expect(run().status).toBe(1);
    expect(dockered().at(-1)).toBe(`rm --force ${CONTAINER}`);
  });

  it("starts no Postgres when no step of the contract needs DATABASE_URL, as Lumaria's contract today", () => {
    const { run, dockered, ranWith } = slicing({ contract: '{ "steps": { "integration": { "run": "bin/integration" } } }\n' });

    expect(run().status).toBe(0);
    expect(dockered()).toEqual([]);
    expect(envOf(ranWith("claude")[0], "DATABASE_URL")).toBeUndefined();
  });

  it("hands its builder a temp dir of fixed length under the job's own TMPDIR, never the long RUNNER_TEMP, so tsx can listen on a Unix socket there and the tree's setup passes (Lumaria#1439)", () => {
    const builder = slicing({ slice: "notify-customer-box-on-booking-reschedule-and-reassign" });

    expect(builder.run().status).toBe(0);
    expect(isolationOf(builder).temp).toMatch(new RegExp(`^${builder.temp}/slice-[A-Za-z0-9]{6}$`));
  });

  it("builds three slices at once on one integration branch, each on its own temp dir, port, container and session file, and leaves no temp dir behind", () => {
    const root = scratch("slice-builder-");
    const builders = ["tenant-time-zone", "invoice-time-zone", "report-time-zone"].map((slice) => slicing({ root, slice, contract: DATABASE_STEP }));
    const [first] = builders;
    if (first === undefined) throw new Error("no builder");
    const together = join(root, "together.sh");
    writeFileSync(together, `${builders.map((builder, at) => `(cd '${builder.tree}' && ${builder.command()} >'${root}/out-${at}' 2>&1) &`).join("\n")}\nwait\n`);

    expect(execute("bash", root, first.env, [together]).status).toBe(0);
    const ended = builders.map((_, at) => readFileSync(join(root, `out-${at}`), "utf8"));
    for (const said of ended) expect(ending(said).outcome, said).toBe("built");
    const seen = builders.map(isolationOf);
    expect(new Set(seen.map(({ temp }) => temp)).size).toBe(3);
    expect(new Set(seen.map(({ port }) => port)).size).toBe(3);
    for (const { temp, port } of seen) {
      expect(temp).toMatch(new RegExp(`^${first.temp}/slice-`));
      expect(Number(port)).toBeGreaterThan(1023);
    }
    expect(new Set(builders.map((builder) => builder.dockered().at(-1))).size).toBe(3);
    expect(readdirSync(first.temp)).toEqual([]);
    for (const builder of builders) expect(builder.keptSession()).toBeUndefined();
  });
});

describe("a slice's builder holds a fresh App token after each model run, as the ticket's builder does (#1504)", () => {
  it("takes the App key off disk before any model runs and hands the next round a token minted after the last", () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
    const file = join(scratch("app-key-"), "app-key.json");
    writeFileSync(file, JSON.stringify({ clientId: "Iv23liAppClient", key: privateKey }));
    const { run, ranWith: envs } = slicing({ check: CHECK_RED_ONCE, appKeyFile: file });

    expect(run().status).toBe(0);
    expect(existsSync(file)).toBe(false);
    const [first, second] = envs("claude").map((dump) => envOf(dump, "GH_TOKEN"));
    expect(first).toBe("job-token");
    expect(second).toMatch(/^minted-\d+$/);
    expect(envs("claude").join("")).not.toContain(privateKey.split("\n")[1]);
  });
});
