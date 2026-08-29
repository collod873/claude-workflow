import type { GhExec } from "../../.Workflow/agent-workflows/shared/gh";

/**
 * The tracker fake lane 09's spec-evaluate pass is asserted against (#237).
 *
 * Not a `.test.ts`, so `vitest.config.ts`'s `tests/acceptance/**\/*.test.ts` include never collects
 * it as a suite — it exists only to be imported by the criterion files beside it, the same way
 * `workflow-shape.fixture.ts` holds the YAML readers those files share.
 *
 * **Why a fake tracker rather than three fakes.** Two of #237's three criteria drive the same
 * entrypoint — `runReconcile` — over the same tracker and differ only in what the specs on it look
 * like. Written twice, the second copy is a second parser of `gh` argv with its own bugs; that is
 * exactly the divergence a shared reader exists to prevent.
 *
 * **What it asserts against is what a reader of the tracker would see** — the text of the comment
 * bodies written and the labels added or removed — never the argv shape that carried them. So the
 * readers below accept every spelling `gh` offers for one act: a comment created with
 * `gh issue comment`, one created or rewritten through `gh api .../comments` or
 * `.../issues/comments/<id>`, a label moved with `gh issue edit --add-label` or through the labels
 * API. A test that pinned one spelling would be red about the implementer's choice of call rather
 * than about the pass's behaviour.
 */

/** A log sink for a run whose output is not what is under test. */
export const silent = (): void => {};

/**
 * One well-formed criterion: the owner's sentence, the shared delimiter, `check:`, and exactly one
 * backtick-quoted command. `true` because the pass runs the spec's check directly — a real command
 * that exits 0 keeps the test free of any assumption about what the runner seam is called.
 */
export const RUNNABLE_CRITERION =
  "I'll know it works when I can see a verdict on a spec that is still open — check: `true`";

/** A second well-formed criterion — a spec carrying both is one the pass must refuse. */
export const SECOND_RUNNABLE_CRITERION =
  "I'll know it works when I can read the exit status it observed — check: `true`";

/** A spec body in the shape `/to-spec` publishes: prose, then the criteria heading, then items. */
export function specBody(criteria: string[]): string {
  return [
    "## Problem Statement",
    "",
    "A spec closes when its tickets close. Nothing ever asks whether the product does the thing.",
    "",
    "## Acceptance criteria",
    "",
    ...criteria.map((criterion) => `- [ ] ${criterion}`),
    "",
  ].join("\n");
}

/** A comment already standing on a spec, with the id an in-place rewrite would need. */
export interface FakeComment {
  id: number;
  body: string;
}

/** One open `prd` issue on the fake tracker. */
export interface SpecFixture {
  number: number;
  title: string;
  body: string;
  /** Defaults to `["prd"]`. */
  labels?: string[];
  comments?: FakeComment[];
  /**
   * Sub-issue numbers. Each is registered as an open published slice of this spec — carrying the
   * `## Parent PRD` heading `render-body.ts` writes — and answered by the sub-issues API, so a pass
   * that reads either one finds the same children.
   */
  children?: number[];
}

interface FakeIssue {
  number: number;
  title: string;
  body: string;
  labels: string[];
  comments: FakeComment[];
  state: "open" | "closed";
}

/** One comment body written this run, and the issue a reader would find it on. */
export interface CommentWrite {
  issue: number | undefined;
  body: string;
}

/** One label added to or removed from an issue this run. */
export interface LabelOp {
  issue: number;
  label: string;
  op: "add" | "remove";
}

export interface Tracker {
  gh: GhExec;
  calls: string[][];
  /** Every comment body written this run, in order. */
  commentWrites(): CommentWrite[];
  /** The comment bodies written onto one issue. */
  bodiesFor(issue: number): string[];
  /** Every label added or removed this run. */
  labelOps(): LabelOp[];
}

function valueOf(argv: readonly string[], flags: string[]): string | undefined {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    for (const flag of flags) {
      if (arg === flag) return argv[i + 1];
      if (arg.startsWith(`${flag}=`)) return arg.slice(flag.length + 1);
    }
  }
  return undefined;
}

/** The `--json` field list, or `[]` when the call names none. */
function jsonFields(argv: readonly string[]): string[] {
  const fields = valueOf(argv, ["--json"]);
  return fields === undefined ? [] : fields.split(",").map((f) => f.trim()).filter((f) => f.length > 0);
}

/** A `-f name=value` / `--field name=value` field's value, whichever form carried it. */
function fieldValue(argv: readonly string[], name: string): string | undefined {
  for (const arg of argv) {
    if (arg.startsWith(`${name}=`)) return arg.slice(name.length + 1);
  }
  return undefined;
}

/** The REST path a `gh api` call names — always the `repos/...` positional, wherever it sits. */
function apiPath(argv: readonly string[]): string {
  return argv.find((arg) => /^\/?repos\//.test(arg)) ?? "";
}

function splitLabels(value: string | undefined): string[] {
  if (value === undefined) return [];
  return value.split(",").map((label) => label.trim()).filter((label) => label.length > 0);
}

export function createTracker(specs: SpecFixture[]): Tracker {
  const calls: string[][] = [];
  const issues = new Map<number, FakeIssue>();
  const children = new Map<number, number[]>();
  let nextCommentId = 9000;

  for (const spec of specs) {
    issues.set(spec.number, {
      number: spec.number,
      title: spec.title,
      body: spec.body,
      labels: spec.labels ?? ["prd"],
      comments: spec.comments ?? [],
      state: "open",
    });
    const kids = spec.children ?? [];
    children.set(spec.number, kids);
    for (const child of kids) {
      issues.set(child, {
        number: child,
        title: `A slice of #${spec.number}`,
        body: `## Parent PRD\n#${spec.number}\n\n## What to build\nOne vertical cut.\n`,
        labels: ["ticket"],
        comments: [],
        state: "open",
      });
    }
  }

  const ownerOfComment = (id: number): number | undefined =>
    [...issues.values()].find((issue) => issue.comments.some((comment) => comment.id === id))?.number;

  /** One issue as `gh --json` renders it: `state` upper-cased, labels and comments as objects. */
  function project(issue: FakeIssue, fields: string[]): Record<string, unknown> {
    const all: Record<string, unknown> = {
      number: issue.number,
      title: issue.title,
      body: issue.body,
      state: issue.state.toUpperCase(),
      url: `https://github.com/owner/repo/issues/${issue.number}`,
      labels: issue.labels.map((name) => ({ name })),
      comments: issue.comments.map((comment) => ({ id: comment.id, body: comment.body })),
      closedByPullRequestsReferences: [],
    };
    if (fields.length === 0) return all;
    const out: Record<string, unknown> = {};
    for (const field of fields) out[field] = all[field] ?? null;
    return out;
  }

  function listIssues(argv: readonly string[]): string {
    const state = (valueOf(argv, ["--state", "-s"]) ?? "open").toLowerCase();
    const label = valueOf(argv, ["--label", "-l"]);
    let rows = [...issues.values()];
    if (state === "open") rows = rows.filter((issue) => issue.state === "open");
    if (state === "closed") rows = rows.filter((issue) => issue.state === "closed");
    if (label !== undefined) {
      const wanted = splitLabels(label);
      rows = rows.filter((issue) => wanted.every((name) => issue.labels.includes(name)));
    }
    return JSON.stringify(rows.map((issue) => project(issue, jsonFields(argv))));
  }

  function viewIssue(argv: readonly string[]): string {
    const issue = issues.get(Number(argv[2]));
    if (!issue) return "{}";
    const jq = valueOf(argv, ["--jq", "-q"]);
    // Nothing here has closed, so nothing has a merged closing pull request: no child is delivered
    // and the closer is never reached.
    if (jq !== undefined && jq.includes("closedByPullRequests")) return "[]";
    if (jq !== undefined && jq.includes("comments")) return JSON.stringify(issue.comments);
    if (jq !== undefined && jq.includes("labels")) return JSON.stringify(issue.labels);
    return JSON.stringify(project(issue, jsonFields(argv)));
  }

  function restIssue(issue: FakeIssue): Record<string, unknown> {
    return {
      number: issue.number,
      title: issue.title,
      body: issue.body,
      state: issue.state,
      state_reason: null,
      labels: issue.labels.map((name) => ({ name })),
    };
  }

  function apiCall(argv: readonly string[]): string {
    const path = apiPath(argv);
    if (path.includes("matching-refs")) return "[]";
    if (path.includes("/dependencies/")) return "[]";
    if (path.endsWith("/dispatches")) return "";

    const sub = /\/issues\/(\d+)\/sub_issues/.exec(path);
    if (sub) {
      return JSON.stringify(
        (children.get(Number(sub[1])) ?? []).map((number) => {
          const child = issues.get(number);
          return {
            number,
            title: child?.title ?? "",
            state: child?.state ?? "open",
            state_reason: null,
          };
        }),
      );
    }

    const byId = /\/issues\/comments\/(\d+)/.exec(path);
    if (byId) {
      return JSON.stringify({ id: Number(byId[1]), body: fieldValue(argv, "body") ?? "" });
    }

    const onIssue = /\/issues\/(\d+)\/comments/.exec(path);
    if (onIssue) {
      const written = fieldValue(argv, "body");
      if (written !== undefined) return JSON.stringify({ id: nextCommentId++, body: written });
      const issue = issues.get(Number(onIssue[1]));
      return JSON.stringify(
        (issue?.comments ?? []).map((comment) => ({
          id: comment.id,
          body: comment.body,
          user: { login: "github-actions[bot]" },
        })),
      );
    }

    const labels = /\/issues\/(\d+)\/labels$/.exec(path);
    if (labels) {
      const issue = issues.get(Number(labels[1]));
      return JSON.stringify((issue?.labels ?? []).map((name) => ({ name })));
    }

    const one = /\/issues\/(\d+)$/.exec(path);
    if (one) {
      const issue = issues.get(Number(one[1]));
      return issue ? JSON.stringify(restIssue(issue)) : "{}";
    }

    return "[]";
  }

  const gh: GhExec = (args) => {
    const argv = [...args];
    calls.push(argv);

    if (argv[0] === "issue") {
      if (argv[1] === "list") return listIssues(argv);
      if (argv[1] === "view") return viewIssue(argv);
      if (argv[1] === "create") return "https://github.com/owner/repo/issues/999\n";
      // comment, edit, close, reopen, label moves: recorded through `calls` and read back by the
      // helpers below, which is where the assertions look.
      return "";
    }
    if (argv[0] === "api") return apiCall(argv);
    return "";
  };

  function commentWrites(): CommentWrite[] {
    const writes: CommentWrite[] = [];
    for (const argv of calls) {
      if (argv[0] === "issue" && argv[1] === "comment") {
        const body = valueOf(argv, ["--body", "-b"]);
        if (body !== undefined) writes.push({ issue: Number(argv[2]), body });
        continue;
      }
      if (argv[0] !== "api") continue;
      const body = fieldValue(argv, "body");
      if (body === undefined) continue;
      const path = apiPath(argv);
      const byId = /\/issues\/comments\/(\d+)/.exec(path);
      if (byId) {
        writes.push({ issue: ownerOfComment(Number(byId[1])), body });
        continue;
      }
      const onIssue = /\/issues\/(\d+)\/comments/.exec(path);
      if (onIssue) {
        writes.push({ issue: Number(onIssue[1]), body });
        continue;
      }
      writes.push({ issue: undefined, body });
    }
    return writes;
  }

  function bodiesFor(issue: number): string[] {
    return commentWrites()
      .filter((write) => write.issue === issue)
      .map((write) => write.body);
  }

  function labelOps(): LabelOp[] {
    const ops: LabelOp[] = [];
    for (const argv of calls) {
      if (argv[0] === "issue" && (argv[1] === "edit" || argv[1] === "close" || argv[1] === "reopen")) {
        const issue = Number(argv[2]);
        for (let i = 0; i < argv.length; i++) {
          const arg = argv[i];
          for (const [flag, op] of [
            ["--add-label", "add"],
            ["--remove-label", "remove"],
          ] as const) {
            const value = arg === flag ? argv[i + 1] : arg.startsWith(`${flag}=`) ? arg.slice(flag.length + 1) : undefined;
            for (const label of splitLabels(value)) ops.push({ issue, label, op });
          }
        }
        continue;
      }
      if (argv[0] !== "api") continue;
      const path = apiPath(argv);

      const removed = /\/issues\/(\d+)\/labels\/(.+)$/.exec(path);
      if (removed) {
        ops.push({ issue: Number(removed[1]), label: decodeURIComponent(removed[2]), op: "remove" });
        continue;
      }

      const added = /\/issues\/(\d+)\/labels$/.exec(path);
      if (added) {
        for (const arg of argv) {
          if (arg.startsWith("labels[]=")) {
            ops.push({ issue: Number(added[1]), label: arg.slice("labels[]=".length), op: "add" });
          }
        }
        continue;
      }

      // A whole-issue PATCH replaces the label set, so what it did is the difference from what the
      // issue already carried.
      const replaced = /\/issues\/(\d+)$/.exec(path);
      if (replaced) {
        const wanted = argv
          .filter((arg) => arg.startsWith("labels[]="))
          .map((arg) => arg.slice("labels[]=".length));
        if (wanted.length === 0) continue;
        const issue = Number(replaced[1]);
        const held = issues.get(issue)?.labels ?? [];
        for (const label of wanted) if (!held.includes(label)) ops.push({ issue, label, op: "add" });
        for (const label of held) if (!wanted.includes(label)) ops.push({ issue, label, op: "remove" });
      }
    }
    return ops;
  }

  return { gh, calls, commentWrites, bodiesFor, labelOps };
}
