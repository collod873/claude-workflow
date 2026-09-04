import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DISPATCH_REQUESTS_PATH_ENV, requestDispatch } from "./dispatch-request";
import { createRecordingGh } from "./gh.fake";

function requestsFile(): string {
  return join(mkdtempSync(join(tmpdir(), "dispatch-request-")), "requests.jsonl");
}

describe("requestDispatch with no handoff path: the caller already holds contents: write", () => {
  it("sends the dispatch through gh, in the argv every caller used to build inline", () => {
    const { gh, calls } = createRecordingGh();

    requestDispatch(gh, { event_type: "ticket-ready", client_payload: { issue: 42 } }, {});

    expect(calls).toEqual([
      [
        "api",
        "repos/{owner}/{repo}/dispatches",
        "-f",
        "event_type=ticket-ready",
        "-f",
        "client_payload[issue]=42",
      ],
    ]);
  });

  it("carries every payload key, so a doorbell naming a pull request is not a special case", () => {
    const { gh, calls } = createRecordingGh();

    requestDispatch(gh, { event_type: "graph-changed", client_payload: { pr: "17" } }, {});

    expect(calls[0]).toContain("client_payload[pr]=17");
  });
});

describe("requestDispatch with a handoff path: the caller is inside a model job", () => {
  it("writes the request as JSON rather than attempting a call it cannot make", () => {
    const path = requestsFile();
    const { gh, calls } = createRecordingGh();

    requestDispatch(
      gh,
      { event_type: "prd-sliceable", client_payload: { issue: 188 } },
      { [DISPATCH_REQUESTS_PATH_ENV]: path },
    );

    expect(calls, "a contents: read job that calls POST /dispatches gets a 403").toEqual([]);
    expect(JSON.parse(readFileSync(path, "utf8").trim())).toEqual({
      event_type: "prd-sliceable",
      client_payload: { issue: 188 },
    });
  });

  it("appends one line per request, because a publish asks for a whole wave of them", () => {
    const path = requestsFile();
    const { gh } = createRecordingGh();
    const env = { [DISPATCH_REQUESTS_PATH_ENV]: path };

    for (const issue of [11, 12, 13]) {
      requestDispatch(gh, { event_type: "ticket-ready", client_payload: { issue } }, env);
    }

    const lines = readFileSync(path, "utf8").trim().split("\n");
    expect(lines).toHaveLength(3);
    expect(lines.map((line) => (JSON.parse(line) as { client_payload: { issue: number } }).client_payload.issue))
      .toEqual([11, 12, 13]);
  });

  it("writes each line as the REST body itself, so the sender job needs no parser", () => {
    const path = requestsFile();
    const { gh } = createRecordingGh();

    requestDispatch(
      gh,
      { event_type: "sheet-accepted", client_payload: { issue: 7 } },
      { [DISPATCH_REQUESTS_PATH_ENV]: path },
    );

    const body = readFileSync(path, "utf8").trim();
    expect(body).not.toContain("\n");
    expect(Object.keys(JSON.parse(body) as object).sort()).toEqual(["client_payload", "event_type"]);
  });
});
