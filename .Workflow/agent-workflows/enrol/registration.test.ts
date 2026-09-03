import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { OUTWARD_CREDENTIAL, derivedSecretNames } from "./secrets.ts";
import { WORKFLOWS_PATH } from "./stub-set.ts";

const ENROL_WORKFLOW = ".github/workflows/enrol.yml";

/** Every `<KEY>: ${{ secrets.<NAME> }}` binding in a workflow file, as written. */
const SECRET_BINDING = /^\s*([A-Za-z_][A-Za-z0-9_]*):\s*\$\{\{\s*secrets\.([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/gm;

/**
 * The secret set is written twice: `derivedSecretNames` scans this repository's workflows for it,
 * and `enrol.yml`'s `env:` block names each derived secret by hand. GitHub Actions forces the
 * second copy — a job cannot read the value of a secret it was not handed by name — and no
 * compiler sees across that boundary. The failure it hides is silent in the worst direction: a
 * lane that starts spending a third secret is picked up by the scan, so the name is propagated,
 * but `process.env[name]` is `undefined` and the target is enrolled without it.
 *
 * `ENROL_PAT` is excluded on the same grounds `derivedSecretNames` excludes it — it is this
 * lane's own outward credential, never a value handed to a target.
 */
describe("secret registration", () => {
  it("hands enrol.ts an environment carrying exactly the secrets its scan derives", () => {
    const workflow = readFileSync(ENROL_WORKFLOW, "utf8");
    const bound = [...workflow.matchAll(SECRET_BINDING)].filter(([, , secret]) => secret !== OUTWARD_CREDENTIAL);

    // Keyed by env name rather than secret name: `enrol.ts` reads `process.env[name]`, so a
    // binding under any other key reaches the process under a name nothing looks for.
    expect(new Set(bound.map(([, key]) => key))).toEqual(new Set(derivedSecretNames(WORKFLOWS_PATH)));
    expect(bound.filter(([, key, secret]) => key !== secret)).toEqual([]);
  });
});
