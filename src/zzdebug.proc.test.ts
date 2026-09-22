import { it } from "vitest";
import { RENAMED_CLAIM_TICKET, renamedAndDeletedHistory, starting } from "./scenarios.ts";

it("debug probe", () => {
  const { run, edited } = starting({ body: RENAMED_CLAIM_TICKET, history: renamedAndDeletedHistory });
  const result = run();
  console.log("STATUS", result.status);
  console.log("STDOUT", JSON.stringify(result.stdout));
  console.log("STDERR", JSON.stringify(result.stderr));
  console.log("EDITED", JSON.stringify(edited()));
});
