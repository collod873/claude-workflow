import { starting, RENAMED_CLAIM_TICKET, renamedAndDeletedHistory } from "../src/scenarios.ts";

const { run, edited, session } = starting({ body: RENAMED_CLAIM_TICKET, history: renamedAndDeletedHistory });
const result = run();
console.log("status", result.status);
console.log("stdout", JSON.stringify(result.stdout));
console.log("stderr", JSON.stringify(result.stderr));
console.log("edited", JSON.stringify(edited()));
console.log("session", session);
