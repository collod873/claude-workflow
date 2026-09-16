/**
 * @fixture Reached only from dispatch lane fixtures, by design: shared `issue list` / `run list`
 * response shaping so two independent `gh` stand-ins don't restate the same JSON shape.
 */

export interface OpenIssueLike {
  number: number;
  title: string;
  body?: string;
  labels?: string[];
}

export function openIssuesAnswer(open: OpenIssueLike[], defaultBody: () => string): string {
  return JSON.stringify(
    open.map((issue) => ({
      number: issue.number,
      title: issue.title,
      body: issue.body ?? defaultBody(),
      labels: (issue.labels ?? []).map((name) => ({ name })),
    })),
  );
}

export interface FakeRunLike {
  id: number;
  title: string;
  status?: "completed" | "in_progress" | "queued";
  conclusion?: "success" | "failure" | "cancelled" | "timed_out";
}

export function runListAnswer(runs: FakeRunLike[]): string {
  return JSON.stringify(
    runs.map((run) => ({
      databaseId: run.id,
      displayTitle: run.title,
      status: run.status ?? "completed",
      conclusion: run.status === undefined || run.status === "completed" ? (run.conclusion ?? "success") : null,
      url: `https://github.com/owner/repo/actions/runs/${run.id}`,
    })),
  );
}
