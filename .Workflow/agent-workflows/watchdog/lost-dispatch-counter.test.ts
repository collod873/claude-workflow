import { expect, test } from "vitest";
import { countLostDispatch, SLICEABLE_LABEL, type CounterOutcome } from "./lost-dispatch-counter";
import { historyWithRunSincePrd } from "./slicing-history.fixture";

function count(fake: ReturnType<typeof historyWithRunSincePrd>): CounterOutcome {
  const options = { gh: fake.gh, labelName: SLICEABLE_LABEL, prdNumber: 200, slicingWorkflow: "to-tickets-caller.yml", log: () => {} };
  return countLostDispatch(options);
}

function runsProjection(calls: string[][]): string {
  const call = calls.find((args) => args[0] === "api" && (args[1] ?? "").includes("/runs"));
  expect(call).toBeDefined();
  return call![call!.indexOf("--jq") + 1] ?? "";
}

test("#532.1: the run projection asks for conclusion alongside status, and only a successful run counts as proof a PRD was sliced", () => {
  const fake = historyWithRunSincePrd({ status: "completed", conclusion: "success" });

  expect(count(fake)).toEqual({ action: "clean" });

  const projection = runsProjection(fake.calls);
  expect(projection).toContain("status");
  expect(projection).toContain("conclusion");
});

test("#532.2: a run created after the PRD reading status completed, conclusion failure leaves the finding standing", () => {
  const crashed = historyWithRunSincePrd({ status: "completed", conclusion: "failure" });

  expect(count(crashed)).toEqual({ action: "opened", issue: 42 });
});

test("#532.3: a run created after the PRD reading status in_progress, conclusion null leaves the finding standing too", () => {
  const inFlight = historyWithRunSincePrd({ status: "in_progress", conclusion: null });

  expect(count(inFlight)).toEqual({ action: "opened", issue: 42 });
  expect(runsProjection(inFlight.calls)).toContain("conclusion");
});
