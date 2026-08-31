import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { stubGh } from "./stub-gh.fixture.ts";

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


/** Loads `bin/close-ticket` as a module and runs `body` against it, JSON in, JSON out. */
function inCloseTicket(body: string, payload: unknown): { stdout: string; stderr: string } {
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
  });
  expect(run.status, run.stderr).toBe(0);
  return { stdout: run.stdout, stderr: run.stderr };
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
function renderRecord(blocks: string[], opts: { spec?: boolean } = {}): Rendered {
  const { stdout, stderr } = inCloseTicket(
    `record, ok = module.render_record("base..head", payload["blocks"], ".", spec=payload["spec"])
print(json.dumps({"record": record, "ok": ok}))`,
    { blocks, spec: opts.spec ?? false },
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

/** One real `bin/close-ticket` invocation against `gh`. */
function closeTicket(args: string[], gh: string): { status: number | null; stdout: string; stderr: string } {
  const run = spawnSync("python3", [CLOSE_TICKET, ...args], {
    encoding: "utf8",
    cwd: REPO_ROOT,
    env: { ...process.env, AGENT_SKILLS_GH: gh },
  });
  return { status: run.status, stdout: run.stdout ?? "", stderr: run.stderr ?? "" };
}

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
