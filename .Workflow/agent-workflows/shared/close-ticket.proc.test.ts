import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  checkoutWithCommits,
  closeTicket,
  closingPrRoute,
  inCloseTicket,
  issueViewRoute,
  loadAsModule,
  mergedPr,
  python,
  REPO_ROOT,
  trackerAnswering,
  verifyRoutes,
  type Route,
} from "./close-ticket.fixture.ts";
import { scratchDir } from "./scratch.fixture.ts";

/**
 * The two halves of what `--spec` adds to a close, driven in the real interpreter against the real
 * functions: `undelivered`, the precondition it refuses on, and `render_record`, the verdict it
 * reaches. Each function's own docstring in `bin/close-ticket` is the home for why — the pull
 * request's side of the delivery question (#195, #233, #253), and evidence rather than exit status
 * (#270).
 *
 * The cases below are the payload shapes `closedByPullRequestsReferences` returns, not a second
 * copy of the parsing. Driven through Python rather than restated in TypeScript for
 * `render-body.proc.test.ts`'s reason: a TypeScript belief about what the Python decides is the
 * thing that was wrong.
 *
 * The last two blocks are the exception, and deliberately so: `No diff.` and the closing-record
 * line are claims about what a close *did to the tracker*, so they are driven through the process
 * boundary — a real `bin/close-ticket`, a real repository, a `gh` that records every call — and
 * asserted on what got posted and whether the close ran. #300's defect was invisible to every
 * function-level reading of this script, because each function did exactly what it said; the range
 * simply never reached one. The spawning itself lives in `close-ticket.fixture.ts`.
 */

const CLOSE_GATE = join(REPO_ROOT, ".claude/hooks/close-gate.py");
const PR_URL = "https://github.com/acme/widgets/pull/42";
const PASSING_JOBS = [
  { name: "Immutability", status: "completed", conclusion: "success" },
  { name: "Verify", status: "completed", conclusion: "success" },
];

/** A `subIssues` node as the GraphQL query returns it. */
function child(
  number: number,
  overrides: { state?: string; stateReason?: string | null; prs?: { number: number; merged: boolean }[] } = {},
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
  const { stdout } = python(
    `${loadAsModule("close_gate", CLOSE_GATE, join(REPO_ROOT, ".claude/hooks"))}\nprint(json.dumps(module.BULLET_RE.findall(sys.stdin.read())))`,
    record,
  );
  return (JSON.parse(stdout) as string[]).map((b) => b.trim()).filter(Boolean);
}

/** A criterion block as `ticket_shape.criteria_blocks` hands one to `render_record`. */
function criterion(text: string, command: string): string {
  return `- [ ] ${text} — check: \`${command}\``;
}

const CLOSING_PR = { number: 42, url: PR_URL, merge_sha: "deadbeef" };

describe("undelivered", () => {
  it("delivers a child the Actions bot closed whose number a merged PR body closes", () => {
    // #237 exactly: closed by lane 08 itself, so no `closer` on the close event, and PR #244's
    // body ends `Closes #237`.
    expect(undelivered([child(237, { prs: [{ number: 244, merged: true }] })])).toEqual([]);
  });

  it("delivers every slice of a spec the chain built end to end", () => {
    const children = [237, 238, 239, 240, 241, 242].map((n, i) => child(n, { prs: [{ number: 244 + i, merged: true }] }));

    expect(undelivered(children)).toEqual([]);
  });

  it("refuses a child closed with no pull request naming it — closed by hand", () => {
    expect(undelivered([child(9, { prs: [] })])).toEqual(["#9: closed by hand, not by a merged PR"]);
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
    const notPlanned = child(9, { stateReason: "NOT_PLANNED", prs: [{ number: 12, merged: true }] });

    expect(undelivered([notPlanned])).toEqual(["#9: closed as not planned — not delivered"]);
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

    expect(undelivered(children)).toEqual(["#2: closed by hand, not by a merged PR", "#3: still open"]);
  });
});

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
    expect(gateBullets(record as string)).toEqual(["the sweep ran — MET: `printf -- '- one\\n- two\\n'` exit 0"]);
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
    expect(renderRecord([quiet], {}).record).not.toContain("Closed by");
  });

  it("carries the pull request, its merge SHA, and Verify's conclusion", () => {
    const { record } = renderRecord([quiet], { closingPr: CLOSING_PR, verify: "passed" });

    expect(record).toContain("Closed by #42");
    expect(record).toContain("merge `deadbeef`");
    expect(record).toContain("Verify: passed");
  });

  it("names Verify unjudged rather than staying silent about it", () => {
    expect(renderRecord([quiet], { closingPr: CLOSING_PR }).record).toContain("Verify: unjudged");
  });

  it("is never miscounted as a criterion bullet or as the range line", () => {
    const { record } = renderRecord([quiet], { closingPr: CLOSING_PR, verify: "passed" });

    expect(gateBullets(record as string)).toEqual(["the module exists — MET: `test -f bin/close-ticket` exit 0"]);
  });
});

/**
 * `fetch_closing_pr` and `fetch_verify_verdict`, driven against a `gh` this repo controls
 * (`trackerAnswering`) rather than the real tracker — the two functions `render_record`'s caller
 * (`run()`) uses to fill in `closing_pr`/`verify` itself, never accepting either from its own
 * caller (#306).
 */
describe("fetch_closing_pr", () => {
  function fetchClosingPr(routes: Route[]): unknown {
    const { stdout } = inCloseTicket(
      `print(json.dumps(module.fetch_closing_pr(payload["gh_path"], "acme/widgets", "999")))`,
      { gh_path: trackerAnswering(routes).path },
    );
    return JSON.parse(stdout);
  }

  it("reads the merged pull request closedByPullRequestsReferences names", () => {
    expect(fetchClosingPr([closingPrRoute([mergedPr(42, "deadbeef")])])).toEqual(CLOSING_PR);
  });

  it("returns null when no pull request naming this issue ever merged", () => {
    const unmerged = { ...mergedPr(9, "none"), merged: false, mergedAt: null, mergeCommit: null };

    expect(fetchClosingPr([closingPrRoute([unmerged])])).toBeNull();
  });

  it("picks the most recently merged pull request when more than one names the issue", () => {
    const nodes = [mergedPr(9, "old", "2026-01-01T00:00:00Z"), mergedPr(42, "new", "2026-09-01T00:00:00Z")];

    expect((fetchClosingPr([closingPrRoute(nodes)]) as { number: number }).number).toBe(42);
  });
});

describe("fetch_verify_verdict", () => {
  function fetchVerifyVerdict(routes: Route[]): { verdict: string; calls: string[][] } {
    const gh = trackerAnswering(routes);
    const { stdout } = inCloseTicket(
      `gh = module.gh_support.bind_gh(payload["gh_path"])
print(json.dumps(module.fetch_verify_verdict(gh, payload["pr_url"])))`,
      { gh_path: gh.path, pr_url: PR_URL },
    );
    return { verdict: JSON.parse(stdout) as string, calls: gh.calls() };
  }

  /**
   * Why the run list must take its query in the path is written where the fix landed:
   * `fetch_verify_verdict`'s comment in `bin/close-ticket`. Asserted on the call's shape because
   * `trackerAnswering` answers on substring and cannot tell a POST from a GET.
   */
  it("asks for the run list as a GET, with the query in the path", () => {
    const { calls } = fetchVerifyVerdict(verifyRoutes(PASSING_JOBS, PR_URL));

    const listCall = calls.find((call) => call.some((arg) => arg.includes("/runs")));
    expect(listCall, "no call asked for the workflow's runs").toBeDefined();
    expect(listCall).not.toContain("-f");
    expect(listCall?.some((arg) => arg.includes("per_page=") && arg.includes("event=repository_dispatch"))).toBe(true);
  });

  it("reads passed when both jobs concluded success", () => {
    expect(fetchVerifyVerdict(verifyRoutes(PASSING_JOBS, PR_URL)).verdict).toBe("passed");
  });

  it("reads failed when the acceptance job concluded failure", () => {
    const jobs = [PASSING_JOBS[0], { ...PASSING_JOBS[1], conclusion: "failure" }];

    expect(fetchVerifyVerdict(verifyRoutes(jobs, PR_URL)).verdict).toBe("failed");
  });

  it("reads unjudged when no run's Immutability job log names this pull request", () => {
    const routes = verifyRoutes([PASSING_JOBS[0]], "https://github.com/acme/widgets/pull/999");

    expect(fetchVerifyVerdict(routes).verdict).toBe("unjudged");
  });

  it("reads unjudged rather than throwing when gh itself fails", () => {
    // Every call falls through to "{}", which json.loads reads as {} — no "workflow_runs" key.
    expect(fetchVerifyVerdict([]).verdict).toBe("unjudged");
  });

  it("still reads passed when both jobs carry a caller-stub prefix — verify / Immutability, verify / Verify", () => {
    // A run reached through `uses:` (ADR-0055, amended by ADR-0132) reports every job as
    // `<caller job key> / <job name>` — confirmed on run 33649164483. `job_matches_name` must
    // still find both jobs under that spelling.
    const prefixed = PASSING_JOBS.map((job) => ({ ...job, name: `verify / ${job.name}` }));

    expect(fetchVerifyVerdict(verifyRoutes(prefixed, PR_URL)).verdict).toBe("passed");
  });
});

describe("verify_workflow_file", () => {
  /** Runs `module.verify_workflow_file()` under `env`, returning its value or the exception it raised. */
  function verifyWorkflowFile(env: Record<string, string | undefined>): { value?: string; error?: string } {
    const { stdout } = inCloseTicket(
      `try:
    print(json.dumps({"value": module.verify_workflow_file()}))
except Exception as e:
    print(json.dumps({"error": str(e)}))`,
      null,
      { VERIFY_WORKFLOW: undefined, GITHUB_ACTIONS: undefined, ...env },
    );
    return JSON.parse(stdout) as { value?: string; error?: string };
  }

  it("reads the env var when one is set", () => {
    expect(verifyWorkflowFile({ VERIFY_WORKFLOW: "verify-caller.yml" })).toEqual({ value: "verify-caller.yml" });
  });

  it("defaults to verify-caller.yml at this workstation, where every invocation runs inside this repository's own checkout", () => {
    expect(verifyWorkflowFile({})).toEqual({ value: "verify-caller.yml" });
  });

  it("refuses rather than defaulting on a runner — a wrong default there would misreport every enrolled repository's closing records, silently", () => {
    expect(verifyWorkflowFile({ GITHUB_ACTIONS: "true" }).error).toContain("VERIFY_WORKFLOW must be set");
  });
});

/**
 * A checkout with `commits` commits, and a `gh` answering `issue view` with `body` (plus whatever
 * `routes` add) — the pair every end-to-end close below runs against.
 */
function checkoutAndTracker(commits: number, body: string, routes: Route[] = []) {
  const { checkout, shas } = checkoutWithCommits(commits);
  const gh = trackerAnswering([issueViewRoute(body), ...routes]);
  return { checkout, shas, gh, range: `${shas[0]}..${shas[shas.length - 1]}` };
}

/** The `<subcommand> <verb>` of every call the tracker saw, in order. */
const verbs = (calls: string[][]) => calls.map((call) => call.slice(0, 2));

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
    const { checkout, gh, range } = checkoutAndTracker(2, CRITERION_BODY, [
      { contains: ["repo", "view"], respond: JSON.stringify({ nameWithOwner: "acme/widgets" }) },
      closingPrRoute([mergedPr(42, "deadbeef")]),
      ...verifyRoutes(PASSING_JOBS, PR_URL),
    ]);

    const result = closeTicket(["999", range, checkout], gh.path);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("Closed by #42 · merge `deadbeef` · Verify: passed");
    expect(result.stdout).toContain(range);
    // Posted to the tracker, not just printed — the `--body-file -` comment is the record itself.
    expect(verbs(gh.calls())).toContainEqual(["issue", "comment"]);
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
    const { checkout, gh, range } = checkoutAndTracker(2, NO_CRITERIA);

    const result = closeTicket(["283", range, checkout], gh.path);

    expect(result.status, result.stderr).not.toBe(0);
    expect(result.stdout).toBe("");
    expect(verbs(gh.calls())).toEqual([["issue", "view"]]);
    expect(result.stderr).toContain(range);
    expect(result.stderr).toContain("carries 1 commit");
  });

  it("still closes on No diff. when the range really is empty", () => {
    // The behaviour a map or task ticket depends on, unchanged — and the reason the guard is a
    // count rather than a ban: a ticket that carried nothing says so by naming the empty range
    // it carried, which is a thing the closer can check rather than take on faith.
    const { checkout, shas, gh } = checkoutAndTracker(2, NO_CRITERIA);
    const head = shas[1];

    const result = closeTicket(["55", `${head}..${head}`, checkout], gh.path);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe("## Closing record\n\nNo diff.\n");
    expect(verbs(gh.calls())).toEqual([
      ["issue", "view"],
      ["issue", "comment"],
      ["issue", "close"],
    ]);
  });

  it("refuses rather than assumes zero when the range cannot be counted", () => {
    // A checkout that is not a repository, or a range it does not resolve. Reading nothing is
    // not reading zero — and were this the fallback instead, every case above would be one bad
    // `<checkout>` argument away from the old behaviour.
    const notARepo = scratchDir("close-ticket-bare");
    const gh = trackerAnswering([issueViewRoute(NO_CRITERIA)]);

    const result = closeTicket(["56", "aaa1111..bbb2222", notARepo], gh.path);

    expect(result.status, result.stderr).not.toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("could not count the commits in aaa1111..bbb2222");
    expect(verbs(gh.calls())).toEqual([["issue", "view"]]);
  });
});
