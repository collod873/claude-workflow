import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { OUTWARD_CREDENTIAL, derivedSecretNames } from "./secrets.ts";
import { WORKFLOWS_PATH } from "./stub-set.ts";

const ENROL_WORKFLOW = ".github/workflows/enrol.yml";

const SECRET_BINDING = /^\s*([A-Za-z_][A-Za-z0-9_]*):\s*\$\{\{\s*secrets\.([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/gm;

describe("secret registration", () => {
  it("hands enrol.ts an environment carrying exactly the secrets its scan derives", () => {
    const workflow = readFileSync(ENROL_WORKFLOW, "utf8");
    const bound = [...workflow.matchAll(SECRET_BINDING)].filter(([, , secret]) => secret !== OUTWARD_CREDENTIAL);

    expect(new Set(bound.map(([, key]) => key))).toEqual(new Set(derivedSecretNames(WORKFLOWS_PATH)));
    expect(bound.filter(([, key, secret]) => key !== secret)).toEqual([]);
  });
});
