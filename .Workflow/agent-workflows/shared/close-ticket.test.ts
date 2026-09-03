import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { readArgvLog, stubGh } from "./stub-gh.fixture.ts";

/**
 * The two halves of what `--spec` adds to a close, driven in the real interpreter against the real
 * functions: `undelivered`, the precondition it refuses on, and `render_record`, the verdict it
 * reaches. Each function's own docstring in `bin/close-ticket` is the home for why — the pull
 * request's side of the delivery question (#195, #233, #253), and evidence rather than exit status
 * (#270).
 *
 * The cases below are the payload shapes `closedByPullRequestsReferences` returns, not a second
 * copy of the parsing. Driven through Python rather than restated in TypeScript for
 * `render-body.test.ts`'s reason: a TypeScript belief about what the Python decides is the thing
 * that was wrong.
 *
 * The last block is the exception, and deliberately so: `No diff.` is a claim about what a close
 * *did to the tracker*, so it is driven through the process boundary — a real `bin/close-ticket`,
 * a real repository, a stub `gh` that records every call — and asserted on what got posted and
 * whether the close ran. #300's defect was invisible to every function-level reading of this
 * script, because each function did exactly what it said; the range simply never reached one.
 */

const REPO_ROOT = resolve(import.meta.dirname, "../../..");
const CLOSE_TICKET = join(REPO_ROOT, "bin/close-ticket");
const CLOSE_GATE = join(REPO_ROOT, ".claude/hooks/close-gate.py");


/**
 * Loads `bin/close-ticket` as a module and runs `body` against it, JSON in, JSON out.
 *
 * `VERIFY_WORKFLOW` is pinned to `verify-caller.yml` here rather than left to whatever the test
 * runner's own environment happens to carry — `verify_workflow_file()`'s workstation default and
 * its runner refusal each get their own tests below, driven with their own explicit `env`, so
 * every other test in this file exercises the ordinary, explicitly-configured path instead of
 * that fallback.
 */
function inCloseTicket(body: string, payload: unknown, env: Record<string, string | undefined> = {}): { stdout: string; stderr: string } {
  const reader = `
import importlib.util, json, sys
from importlib.machinery import SourceFileLoader
# Named through an explicit loader: the script has no \`.py\` suffix, and
# \`spec_from_file_location\` alone declines to guess a loader for that.
loader = SourceFileLoader("close_ticket", ${JSON.stringify(CLOSE_TICKET)})
module = importlib.util.module_from_spec(importlib.util.spec_from_loader(loader.name, loader))
loader.exec_module(module)
payload = json.load(sys.stdin)
${body}
`;
  const run = spawnSync("python3", ["-c", reader], {
    input: JSON.stringify(payload),
    encoding: "utf8",
    cwd: REPO_ROOT,
    env: { ...process.env, VERIFY_WORKFLOW: "verify-caller.yml", ...env },
  });
  expect(run.status, run.stderr).toBe(0);
  return { stdout: run.stdout, stderr: run.stderr };
}

/**
 * A `gh` stub whose answer depends on *which* subcommand was called — `stub-gh.fixture.ts`'s
 * `stubGh` answers every call identically, which is enough for a single `issue view` read but not
 * for `fetch_closing_pr`/`fetch_verify_verdict` (#306), each of which makes several different
 * calls in sequence and needs a different answer to each. `routes` is tried in order; the first
 * whose `contains` substrings all appear in the call's space-joined argv wins, and its `respond`
 * is printed verbatim to stdout. A call matching nothing gets `{}`.
 */
function routedGhStub(routes: { contains: string[]; respond: string }[]): {
  path: string;
  calls: () => string[][];
} {
  const dir = mkdtempSync(join(tmpdir(), "routed-gh-stub-"));
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "gh");
  const log = join(dir, "argv.jsonl");
  const script = `#!/usr/bin/env python3
import json, sys
args = sys.argv[1:]
with open(${JSON.stringify(log)}, "a") as f:
    f.write(json.dumps(args) + "\\n")
joined = " ".join(args)
routes = ${JSON.stringify(routes)}
for route in routes:
    if all(needle in joined for needle in route["contains"]):
        print(route["respond"])
        sys.exit(0)
print("{}")
`;
  writeFileSync(path, script);
  chmodSync(path, 0o755);
  return { path, calls: () => readArgvLog(log) };
}

/** A `subIssues` node as the GraphQL query returns it. */
function child(
  number: number,
  overrides: {
    state?: string;
    stateReason?: string | null;
    prs?: { number: number; merged: boolean }[];
  } = {},
): unknown {
  return {
    number,
    state: overrides.state ?? "CLOSED",
    stateReason: overrides.stateReason ?? "COMPLETED",
    closedByPullRequestsReferences: { nodes: overrides.prs ?? [] },
  };
}

/** `undelivered(children)`, run by the real `bin/close-ticket` loaded as a module. */
function undelivered(children: unknown[]): string[] {
  const { stdout } = inCloseTicket(`print(json.dumps(module.undelivered(payload)))`, children);
  return JSON.parse(stdout) as string[];
}

/** What one `render_record` call decided, plus the stderr it refused on. */
interface Rendered {
  record: string | null;
  ok: boolean;
  stderr: string;
}

/**
 * `render_record` over `blocks`, in ticket mode or `--spec` mode.
 *
 * The checks are real shell commands run in a real cwd — `REPO_ROOT` — because the thing under
 * test is what `run_check` observes, and a stub that reports an exit status and an output is a
 * restatement of the belief this ticket exists to correct.
 */
function renderRecord(
  blocks: string[],
  opts: { spec?: boolean; closingPr?: { number: number; url: string; merge_sha: string | null }; verify?: string } = {},
): Rendered {
  const { stdout, stderr } = inCloseTicket(
    `record, ok = module.render_record("base..head", payload["blocks"], ".", spec=payload["spec"],
                                     closing_pr=payload["closing_pr"], verify=payload["verify"])
print(json.dumps({"record": record, "ok": ok}))`,
    { blocks, spec: opts.spec ?? false, closing_pr: opts.closingPr ?? null, verify: opts.verify ?? null },
  );
  return { ...(JSON.parse(stdout) as Omit<Rendered, "stderr">), stderr };
}

/** Every bullet the real close gate counts in `record` — its `BULLET_RE`, not a copy of it. */
function gateBullets(record: string): string[] {
  const reader = `
import importlib.util, json, sys
from importlib.machinery import SourceFileLoader
# The gate imports its sibling \`_hook\`, which normally resolves off the script's own
# directory; loading it as a module rather than running it means saying so here.
sys.path.insert(0, ${JSON.stringify(join(REPO_ROOT, ".claude/hooks"))})
loader = SourceFileLoader("close_gate", ${JSON.stringify(CLOSE_GATE)})
module = importlib.util.module_from_spec(importlib.util.spec_from_loader(loader.name, loader))
loader.exec_module(module)
print(json.dumps(module.BULLET_RE.findall(sys.stdin.read())))
`;
  const run = spawnSync("python3", ["-c", reader], { input: record, encoding: "utf8" });
  expect(run.status, run.stderr).toBe(0);
  return (JSON.parse(run.stdout) as string[]).map((b) => b.trim()).filter(Boolean);
}

describe("undelivered", () => {
  it("delivers a child the Actions bot closed whose number a merged PR body closes", () => {
    // #237 exactly: closed by lane 08 itself, so no `closer` on the close event, and PR #244's
    // body ends `Closes #237`.
    expect(undelivered([child(237, { prs: [{ number: 244, merged: true }] })])).toEqual([]);
  });

  it("delivers every slice of a spec the chain built end to end", () => {
    const children = [
      child(237, { prs: [{ number: 244, merged: true }] }),
      child(238, { prs: [{ number: 246, merged: true }] }),
      child(239, { prs: [{ number: 247, merged: true }] }),
      child(240, { prs: [{ number: 248, merged: true }] }),
      child(241, { prs: [{ number: 250, merged: true }] }),
      child(242, { prs: [{ number: 249, merged: true }] }),
    ];

    expect(undelivered(children)).toEqual([]);
  });

  it("refuses a child closed with no pull request naming it — closed by hand", () => {
    expect(undelivered([child(9, { prs: [] })])).toEqual([
      "#9: closed by hand, not by a merged PR",
    ]);
  });

  it("refuses a child named only by a pull request that never merged", () => {
    expect(undelivered([child(9, { prs: [{ number: 12, merged: false }] })])).toEqual([
      "#9: closed by PR #12, which is not merged",
    ]);
  });

  it("delivers a child one of whose naming pull requests merged", () => {
    const prs = [
      { number: 11, merged: false },
      { number: 12, merged: true },
    ];

    expect(undelivered([child(9, { prs })])).toEqual([]);
  });

  it("refuses a child that is still open even when a merged PR names it", () => {
    const open = child(9, { state: "OPEN", stateReason: null, prs: [{ number: 12, merged: true }] });

    expect(undelivered([open])).toEqual(["#9: still open"]);
  });

  it("refuses a child closed as not planned, merged PR or not", () => {
    const notPlanned = child(9, {
      stateReason: "NOT_PLANNED",
      prs: [{ number: 12, merged: true }],
    });

    expect(undelivered([notPlanned])).toEqual([
      "#9: closed as not planned — not delivered",
    ]);
  });

  it("passes a spec that was never sliced — nothing is undelivered", () => {
    expect(undelivered([])).toEqual([]);
  });

  it("names every undelivered child, not just the first", () => {
    const children = [
      child(1, { prs: [{ number: 44, merged: true }] }),
      child(2, { prs: [] }),
      child(3, { state: "OPEN", stateReason: null }),
    ];

    expect(undelivered(children)).toEqual([
      "#2: closed by hand, not by a merged PR",
      "#3: still open",
    ]);
  });
});

/** A criterion block as `ticket_shape.criteria_blocks` hands one to `render_record`. */
function criterion(text: string, command: string): string {
  return `- [ ] ${text} — check: \`${command}\``;
}

describe("render_record in --spec mode", () => {
  it("refuses a check that exits 0 having printed nothing", () => {
    // #236's own check in a world where nothing was built: `gh issue list … | xargs -r`, whose
    // second half runs nothing and exits 0 on empty input.
    const empty = criterion("the door fires", "printf '' | xargs -r -I{} echo {}");

    const { record, ok, stderr } = renderRecord([empty], { spec: true });

    expect(ok).toBe(false);
    expect(record).toBeNull();
    expect(stderr).toContain("printed no evidence");
    expect(stderr).toContain("the door fires");
  });

  it("carries the check's own output in the MET bullet", () => {
    const found = criterion("a spec sourced from #143 exists", "echo 271");

    const { record, ok } = renderRecord([found], { spec: true });

    expect(ok).toBe(true);
    expect(record).toContain("- a spec sourced from #143 exists — MET: `echo 271` exit 0");
    expect(record).toContain("> 271");
    expect(record).toContain("1 of 1 criteria verified · 0 unverified");
  });

  it("still refuses a non-zero exit, output or not", () => {
    const failing = criterion("the door fires", "echo 271; exit 3");

    const { ok, stderr } = renderRecord([failing], { spec: true });

    expect(ok).toBe(false);
    expect(stderr).toContain("exit status: 3");
  });

  it("quotes evidence so the close gate still counts one bullet per criterion", () => {
    // A check whose output is itself a markdown list: the shape that would otherwise inflate
    // `BULLET_RE`'s count past the body's criteria and get the close denied.
    const listy = criterion("the sweep ran", "printf -- '- one\\n- two\\n'");

    const { record, ok } = renderRecord([listy], { spec: true });

    expect(ok).toBe(true);
    expect(gateBullets(record as string)).toEqual([
      "the sweep ran — MET: `printf -- '- one\\n- two\\n'` exit 0",
    ]);
  });

  it("caps the evidence it quotes rather than pasting a whole log", () => {
    const noisy = criterion("the sweep ran", "seq 1 500");

    const { record } = renderRecord([noisy], { spec: true });

    expect(record).toContain("> 1");
    expect(record).toContain("[…]");
    expect(record).not.toContain("> 400");
  });
});

describe("render_record in ticket mode", () => {
  it("accepts a silent exit 0 — `grep -q` and `test -f` are how ticket checks are written", () => {
    const quiet = criterion("the module exists", "test -f bin/close-ticket");

    const { record, ok } = renderRecord([quiet], {});

    expect(ok).toBe(true);
    expect(record).toContain("- the module exists — MET: `test -f bin/close-ticket` exit 0");
    expect(record).toContain("1 of 1 criteria verified · 0 unverified");
  });

  it("quotes no evidence, so 445 existing records keep their shape", () => {
    const { record } = renderRecord([criterion("the module exists", "echo 271")], {});

    expect(record).not.toContain("> 271");
  });
});

/**
 * The record's own claim rests on what `render_record` was handed for `closing_pr`/`verify`
 * (#306) — the closing pull request, its merge SHA, and Verify's conclusion on it, appended as
 * one line neither a bullet (`hooks/close-gate.py`'s `BULLET_RE`) nor the range line
 * (`RANGE_LINE_RE`) can mistake for something else. `fetch_closing_pr`/`fetch_verify_verdict`
 * themselves — the functions that *find* these values — are exercised separately, against a real
 * `gh` stub, below; this block is about what `render_record` does with them once found.
 */
describe("render_record's closing-pull-request line", () => {
  const quiet = criterion("the module exists", "test -f bin/close-ticket");

  it("adds nothing when no closing pull request was found", () => {
    const { record } = renderRecord([quiet], {});

    expect(record).not.toContain("Closed by");
  });

  it("carries the pull request, its merge SHA, and Verify's conclusion", () => {
    const { record } = renderRecord([quiet], {
      closingPr: { number: 42, url: "https://github.com/acme/widgets/pull/42", merge_sha: "deadbeef" },
      verify: "passed",
    });

    expect(record).toContain("Closed by #42");
    expect(record).toContain("merge `deadbeef`");
    expect(record).toContain("Verify: passed");
  });

  it("names Verify unjudged rather than staying silent about it", () => {
    const { record } = renderRecord([quiet], {
      closingPr: { number: 42, url: "https://github.com/acme/widgets/pull/42", merge_sha: "deadbeef" },
    });

    expect(record).toContain("Verify: unjudged");
  });

  it("is never miscounted as a criterion bullet or as the range line", () => {
    const { record } = renderRecord([quiet], {
      closingPr: { number: 42, url: "https://github.com/acme/widgets/pull/42", merge_sha: "deadbeef" },
      verify: "passed",
    });

    expect(gateBullets(record as string)).toEqual([
      "the module exists — MET: `test -f bin/close-ticket` exit 0",
    ]);
  });
});

/**
 * `fetch_closing_pr` and `fetch_verify_verdict`, driven against a `gh` this repo controls
 * (`routedGhStub`) rather than the real tracker — the two functions `render_record`'s caller
 * (`run()`) uses to fill in `closing_pr`/`verify` itself, never accepting either from its own
 * caller (#306).
 */
/** One `closedByPullRequestsReferences` node, in the shape `fetch_closing_pr` reads. */
interface PrRefNode {
  number: number;
  url: string;
  merged: boolean;
  mergedAt: string | null;
  mergeCommit: { oid: string } | null;
}

describe("fetch_closing_pr", () => {
  function fetchClosingPr(ghPath: string, issue: string): unknown {
    const { stdout } = inCloseTicket(
      `print(json.dumps(module.fetch_closing_pr(payload["gh_path"], "acme/widgets", payload["issue"])))`,
      { gh_path: ghPath, issue },
    );
    return JSON.parse(stdout);
  }

  /** A `gh api graphql` stub answering `fetch_closing_pr`'s query with `nodes` as its issue's `closedByPullRequestsReferences`. */
  function closingPrStub(nodes: PrRefNode[]): ReturnType<typeof routedGhStub> {
    return routedGhStub([
      {
        contains: ["api", "graphql"],
        respond: JSON.stringify({
          data: { repository: { issue: { closedByPullRequestsReferences: { nodes } } } },
        }),
      },
    ]);
  }

  it("reads the merged pull request closedByPullRequestsReferences names", () => {
    const gh = closingPrStub([
      {
        number: 42,
        url: "https://github.com/acme/widgets/pull/42",
        merged: true,
        mergedAt: "2026-09-01T00:00:00Z",
        mergeCommit: { oid: "deadbeef" },
      },
    ]);

    expect(fetchClosingPr(gh.path, "999")).toEqual({
      number: 42,
      url: "https://github.com/acme/widgets/pull/42",
      merge_sha: "deadbeef",
    });
  });

  it("returns null when no pull request naming this issue ever merged", () => {
    const gh = closingPrStub([
      { number: 9, url: "https://github.com/acme/widgets/pull/9", merged: false, mergedAt: null, mergeCommit: null },
    ]);

    expect(fetchClosingPr(gh.path, "999")).toBeNull();
  });

  it("picks the most recently merged pull request when more than one names the issue", () => {
    const gh = closingPrStub([
      {
        number: 9,
        url: "https://github.com/acme/widgets/pull/9",
        merged: true,
        mergedAt: "2026-01-01T00:00:00Z",
        mergeCommit: { oid: "old" },
      },
      {
        number: 42,
        url: "https://github.com/acme/widgets/pull/42",
        merged: true,
        mergedAt: "2026-09-01T00:00:00Z",
        mergeCommit: { oid: "new" },
      },
    ]);

    expect((fetchClosingPr(gh.path, "999") as { number: number }).number).toBe(42);
  });
});

describe("fetch_verify_verdict", () => {
  const PR_URL = "https://github.com/acme/widgets/pull/42";

  function fetchVerifyVerdict(ghPath: string): string {
    const { stdout } = inCloseTicket(
      `gh = module.gh_support.bind_gh(payload["gh_path"])
print(json.dumps(module.fetch_verify_verdict(gh, payload["pr_url"])))`,
      { gh_path: ghPath, pr_url: PR_URL },
    );
    return JSON.parse(stdout) as string;
  }

  /** The two-call sequence every scenario below shares: the run list, then that run's jobs. */
  function verifyRoutes(jobs: { name: string; status: string; conclusion: string | null }[]): { contains: string[]; respond: string }[] {
    return [
      { contains: ["actions/workflows/verify-caller.yml/runs"], respond: JSON.stringify([{ id: 555, status: "completed" }]) },
      {
        contains: ["actions/runs/555/jobs"],
        respond: JSON.stringify(jobs.map((j, i) => ({ id: i + 1, ...j }))),
      },
      { contains: ["run", "view", "--job", "1", "--log"], respond: `judging ${PR_URL} on implement/issue-999` },
    ];
  }

  /**
   * Why the run list must take its query in the path is written where the fix landed:
   * `fetch_verify_verdict`'s comment in `bin/close-ticket`. Asserted on the call's shape because
   * `routedGhStub` answers on substring and cannot tell a POST from a GET.
   */
  it("asks for the run list as a GET, with the query in the path", () => {
    const gh = routedGhStub(verifyRoutes([
      { name: "Immutability", status: "completed", conclusion: "success" },
      { name: "Restore and run acceptance", status: "completed", conclusion: "success" },
    ]));
    fetchVerifyVerdict(gh.path);

    const listCall = gh.calls().find((call) => call.some((arg) => arg.includes("/runs")));
    expect(listCall, "no call asked for the workflow's runs").toBeDefined();
    expect(listCall).not.toContain("-f");
    expect(listCall?.some((arg) => arg.includes("per_page=") && arg.includes("event=repository_dispatch"))).toBe(true);
  });

  it("reads passed when both jobs concluded success", () => {
    const gh = routedGhStub(verifyRoutes([
      { name: "Immutability", status: "completed", conclusion: "success" },
      { name: "Restore and run acceptance", status: "completed", conclusion: "success" },
    ]));

    expect(fetchVerifyVerdict(gh.path)).toBe("passed");
  });

  it("reads failed when the acceptance job concluded failure", () => {
    const gh = routedGhStub(verifyRoutes([
      { name: "Immutability", status: "completed", conclusion: "success" },
      { name: "Restore and run acceptance", status: "completed", conclusion: "failure" },
    ]));

    expect(fetchVerifyVerdict(gh.path)).toBe("failed");
  });

  it("reads unjudged when no run's Immutability job log names this pull request", () => {
    const gh = routedGhStub([
      { contains: ["actions/workflows/verify-caller.yml/runs"], respond: JSON.stringify([{ id: 555, status: "completed" }]) },
      {
        contains: ["actions/runs/555/jobs"],
        respond: JSON.stringify([{ id: 1, name: "Immutability", status: "completed", conclusion: "success" }]),
      },
      { contains: ["run", "view"], respond: "judging https://github.com/acme/widgets/pull/999 on implement/issue-1" },
    ]);

    expect(fetchVerifyVerdict(gh.path)).toBe("unjudged");
  });

  it("reads unjudged rather than throwing when gh itself fails", () => {
    const gh = routedGhStub([]); // every call falls through to "{}", which json.loads reads as {} — no "workflow_runs" key

    expect(fetchVerifyVerdict(gh.path)).toBe("unjudged");
  });

  it("still reads passed when both jobs carry a caller-stub prefix — verify / Immutability, verify / Restore and run acceptance", () => {
    // A run reached through `uses:` (ADR-0055, amended by ADR-0132) reports every job as
    // `<caller job key> / <job name>` — confirmed on run 33649164483. `job_matches_name` must
    // still find both jobs under that spelling.
    const gh = routedGhStub(verifyRoutes([
      { name: "verify / Immutability", status: "completed", conclusion: "success" },
      { name: "verify / Restore and run acceptance", status: "completed", conclusion: "success" },
    ]));

    expect(fetchVerifyVerdict(gh.path)).toBe("passed");
  });
});

describe("verify_workflow_file", () => {
  /** Runs `module.verify_workflow_file()` under `env`, returning its value or the exception it raised. */
  function verifyWorkflowFile(env: Record<string, string | undefined>): { value?: string; error?: string } {
    const reader = `
import importlib.util, json, sys
from importlib.machinery import SourceFileLoader
loader = SourceFileLoader("close_ticket", ${JSON.stringify(CLOSE_TICKET)})
module = importlib.util.module_from_spec(importlib.util.spec_from_loader(loader.name, loader))
loader.exec_module(module)
try:
    print(json.dumps({"value": module.verify_workflow_file()}))
except Exception as e:
    print(json.dumps({"error": str(e)}))
`;
    const run = spawnSync("python3", ["-c", reader], {
      encoding: "utf8",
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        VERIFY_WORKFLOW: undefined,
        GITHUB_ACTIONS: undefined,
        ...env,
      },
    });
    expect(run.status, run.stderr).toBe(0);
    return JSON.parse(run.stdout) as { value?: string; error?: string };
  }

  it("reads the env var when one is set", () => {
    expect(verifyWorkflowFile({ VERIFY_WORKFLOW: "verify-caller.yml" })).toEqual({ value: "verify-caller.yml" });
  });

  it("defaults to verify-caller.yml at this workstation, where every invocation runs inside this repository's own checkout", () => {
    expect(verifyWorkflowFile({})).toEqual({ value: "verify-caller.yml" });
  });

  it("refuses rather than defaulting on a runner — a wrong default there would misreport every enrolled repository's closing records, silently", () => {
    const { error } = verifyWorkflowFile({ GITHUB_ACTIONS: "true" });
    expect(error).toContain("VERIFY_WORKFLOW must be set");
  });
});

/** A repository at a fresh temp path with `commits` commits on it, newest SHA last. */
function repoWithCommits(commits: number): { checkout: string; shas: string[] } {
  const checkout = mkdtempSync(join(tmpdir(), "close-ticket-repo-"));
  onTestFinished(() => rmSync(checkout, { recursive: true, force: true }));
  // Identity on the command line, not in a config file: the fixture's own, never whatever the
  // runner's `~/.gitconfig` says, and never a prompt for a signing passphrase.
  const ident = [
    "-c",
    "user.name=close-ticket tests",
    "-c",
    "user.email=tests@example.invalid",
    "-c",
    "commit.gpgsign=false",
    "-c",
    "init.defaultBranch=main",
  ];
  const git = (...args: string[]): string => {
    const run = spawnSync("git", [...ident, ...args], { cwd: checkout, encoding: "utf8" });
    expect(run.status, `git ${args.join(" ")}: ${run.stderr}`).toBe(0);
    return run.stdout.trim();
  };
  git("init", "-q");
  const shas: string[] = [];
  for (let n = 0; n < commits; n += 1) {
    writeFileSync(join(checkout, `file-${n}.txt`), `${n}\n`);
    git("add", "-A");
    git("commit", "-q", "--no-gpg-sign", "-m", `commit ${n}`);
    shas.push(git("rev-parse", "HEAD"));
  }
  return { checkout, shas };
}

/**
 * One real `bin/close-ticket` invocation against `gh`. `VERIFY_WORKFLOW` is pinned the same way
 * `inCloseTicket` pins it, and for the same reason.
 */
function closeTicket(args: string[], gh: string, env: Record<string, string | undefined> = {}): { status: number | null; stdout: string; stderr: string } {
  const run = spawnSync("python3", [CLOSE_TICKET, ...args], {
    encoding: "utf8",
    cwd: REPO_ROOT,
    env: { ...process.env, AGENT_SKILLS_GH: gh, VERIFY_WORKFLOW: "verify-caller.yml", ...env },
  });
  return { status: run.status, stdout: run.stdout ?? "", stderr: run.stderr ?? "" };
}

describe("a ticket close carries its closing pull request, driven end to end", () => {
  const CRITERION_BODY = [
    "## Acceptance criteria",
    "",
    "- [ ] the first commit's file exists — check: `test -f file-0.txt`",
    "",
    "## Files claimed",
    "- file-0.txt",
    "",
  ].join("\n");

  it("posts a record naming the PR, its merge SHA, and Verify's conclusion — read, not handed", () => {
    const { checkout, shas } = repoWithCommits(2);
    const gh = routedGhStub([
      { contains: ["issue", "view"], respond: JSON.stringify({ body: CRITERION_BODY, comments: [] }) },
      { contains: ["repo", "view"], respond: JSON.stringify({ nameWithOwner: "acme/widgets" }) },
      {
        contains: ["api", "graphql"],
        respond: JSON.stringify({
          data: {
            repository: {
              issue: {
                closedByPullRequestsReferences: {
                  nodes: [
                    {
                      number: 42,
                      url: "https://github.com/acme/widgets/pull/42",
                      merged: true,
                      mergedAt: "2026-09-01T00:00:00Z",
                      mergeCommit: { oid: "deadbeef" },
                    },
                  ],
                },
              },
            },
          },
        }),
      },
      { contains: ["actions/workflows/verify-caller.yml/runs"], respond: JSON.stringify([{ id: 555, status: "completed" }]) },
      {
        contains: ["actions/runs/555/jobs"],
        respond: JSON.stringify([
          { id: 1, name: "Immutability", status: "completed", conclusion: "success" },
          { id: 2, name: "Restore and run acceptance", status: "completed", conclusion: "success" },
        ]),
      },
      { contains: ["run", "view"], respond: "judging https://github.com/acme/widgets/pull/42 on implement/issue-999" },
      { contains: ["issue", "comment"], respond: "" },
      { contains: ["issue", "close"], respond: "" },
    ]);

    const result = closeTicket(["999", `${shas[0]}..${shas[1]}`, checkout], gh.path);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("Closed by #42 · merge `deadbeef` · Verify: passed");
    expect(result.stdout).toContain(`${shas[0]}..${shas[1]}`);
    // Posted to the tracker, not just printed — the `--body-file -` comment is the record itself.
    const commentCall = gh.calls().find((call) => call[0] === "issue" && call[1] === "comment");
    expect(commentCall).toBeDefined();
  });
});

describe("the No diff. close, driven end to end", () => {
  const NO_CRITERIA = "Just a task. No acceptance criteria in this body at all.\n";

  it("posts nothing and closes nothing when the range it was handed carries a commit", () => {
    // #283 exactly: `bin/close-ticket 283 3fc1769..7f9d443 .` posted `## Closing record / No
    // diff.` and exited 0 against a range carrying a real commit. The body has no acceptance
    // criteria, which used to be read as "map or task ticket" — a kind — and took a branch that
    // discarded the range unread. The record then said the ticket carried no diff; it carried
    // one, and a human had to correct it.
    const { checkout, shas } = repoWithCommits(2);
    const { path: gh, calls } = stubGh(NO_CRITERIA);

    const result = closeTicket(["283", `${shas[0]}..${shas[1]}`, checkout], gh);

    expect(result.status, result.stderr).not.toBe(0);
    expect(result.stdout).toBe("");
    expect(calls().map((call: string[]) => call.slice(0, 2))).toEqual([["issue", "view"]]);
    expect(result.stderr).toContain(`${shas[0]}..${shas[1]}`);
    expect(result.stderr).toContain("carries 1 commit");
  });

  it("still closes on No diff. when the range really is empty", () => {
    // The behaviour a map or task ticket depends on, unchanged — and the reason the guard is a
    // count rather than a ban: a ticket that carried nothing says so by naming the empty range
    // it carried, which is a thing the closer can check rather than take on faith.
    const { checkout, shas } = repoWithCommits(2);
    const { path: gh, calls } = stubGh(NO_CRITERIA);
    const head = shas[1];

    const result = closeTicket(["55", `${head}..${head}`, checkout], gh);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe("## Closing record\n\nNo diff.\n");
    expect(calls().map((call: string[]) => call.slice(0, 2))).toEqual([
      ["issue", "view"],
      ["issue", "comment"],
      ["issue", "close"],
    ]);
  });

  it("refuses rather than assumes zero when the range cannot be counted", () => {
    // A checkout that is not a repository, or a range it does not resolve. Reading nothing is
    // not reading zero — and were this the fallback instead, every case above would be one bad
    // `<checkout>` argument away from the old behaviour.
    const notARepo = mkdtempSync(join(tmpdir(), "close-ticket-bare-"));
    onTestFinished(() => rmSync(notARepo, { recursive: true, force: true }));
    const { path: gh, calls } = stubGh(NO_CRITERIA);

    const result = closeTicket(["56", "aaa1111..bbb2222", notARepo], gh);

    expect(result.status, result.stderr).not.toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("could not count the commits in aaa1111..bbb2222");
    expect(calls().map((call: string[]) => call.slice(0, 2))).toEqual([["issue", "view"]]);
  });
});
