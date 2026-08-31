import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createRecordingGh } from "../shared/gh.fake";
import { RATIFICATION_DUE_DISPATCH_ACTION } from "./dispatch";
import { CLOSE_STATE_REASON, PRD_LABEL, ratifyOnPrdClose } from "./prd-close";

const silent = () => {};

describe("ratifyOnPrdClose — the gate", () => {
  it("rings the door exactly once for a PRD closed as delivered", () => {
    const gh = createRecordingGh();
    const sent: Array<{ head: string; prdClosed: boolean }> = [];

    const outcome = ratifyOnPrdClose({
      issueNumber: 7,
      stateReason: CLOSE_STATE_REASON,
      labels: [PRD_LABEL, "something-else"],
      head: "headsha",
      gh: gh.gh,
      dispatch: (_gh, dispatch) => void sent.push(dispatch),
      log: silent,
    });

    expect(outcome).toEqual({ sent: true });
    expect(sent).toEqual([{ head: "headsha", prdClosed: true }]);
  });

  it("makes no call for a close that claims nothing was delivered", () => {
    const gh = createRecordingGh();

    const outcome = ratifyOnPrdClose({
      stateReason: "not_planned",
      labels: [PRD_LABEL],
      head: "headsha",
      gh: gh.gh,
      dispatch: () => {
        throw new Error("should not dispatch");
      },
      log: silent,
    });

    expect(outcome).toEqual({ sent: false });
    expect(gh.calls).toEqual([]);
  });

  it("makes no call for an ordinary issue that was never a PRD", () => {
    const outcome = ratifyOnPrdClose({
      stateReason: CLOSE_STATE_REASON,
      labels: ["bug"],
      head: "headsha",
      gh: createRecordingGh().gh,
      dispatch: () => {
        throw new Error("should not dispatch");
      },
      log: silent,
    });

    expect(outcome).toEqual({ sent: false });
  });
});

describe("the dispatch on the wire", () => {
  it("sends the action ratify.yml's own types: filter names, and the scope the run needs", () => {
    const gh = createRecordingGh();

    ratifyOnPrdClose({
      stateReason: CLOSE_STATE_REASON,
      labels: [PRD_LABEL],
      head: "headsha",
      gh: gh.gh,
      log: silent,
    });

    expect(gh.calls).toEqual([
      [
        "api",
        "repos/{owner}/{repo}/dispatches",
        "-f",
        `event_type=${RATIFICATION_DUE_DISPATCH_ACTION}`,
        "-f",
        "client_payload[head]=headsha",
        "-f",
        "client_payload[prd_closed]=true",
      ],
    ]);
  });
});

describe("ratify-on-prd-close.yml agrees with the scope rule it is a copy of", () => {
  const workflow = readFileSync(
    fileURLToPath(new URL("../../../.github/workflows/ratify-on-prd-close.yml", import.meta.url)),
    "utf8",
  );

  it("fires on an issue closing", () => {
    expect(workflow).toMatch(/issues:\s*\n\s*types:\s*\[closed\]/);
  });

  it("gates the job on the same two conditions the connector checks", () => {
    expect(workflow).toContain(`state_reason == '${CLOSE_STATE_REASON}'`);
    expect(workflow).toContain(`'${PRD_LABEL}'`);
  });
});
