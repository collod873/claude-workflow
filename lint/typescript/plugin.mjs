import { configPredictsEnvironment } from "./rules/config-predicts-environment.mjs";
import {
  noChildProcessInTests,
  noDevDependencyImport,
  noTestUtilsImport,
} from "./rules/import-bans.mjs";
import { noBoundaryMock } from "./rules/no-boundary-mock.mjs";
import { noMkdtempSync } from "./rules/no-mkdtemp-sync.mjs";
import { noSoleClassnameAssertion } from "./rules/no-sole-classname-assertion.mjs";
import { noTopLevelGlobalWrite } from "./rules/no-top-level-global-write.mjs";
import { requireUseClient } from "./rules/require-use-client.mjs";

export const NAMESPACE = "shared";

export const plugin = {
  meta: { name: "agent-hooks-shared-lint" },
  rules: {
    "config-predicts-environment": configPredictsEnvironment,
    "no-boundary-mock": noBoundaryMock,
    "no-child-process-in-tests": noChildProcessInTests,
    "no-dev-dependency-import": noDevDependencyImport,
    "no-mkdtemp-sync": noMkdtempSync,
    "no-sole-classname-assertion": noSoleClassnameAssertion,
    "no-test-utils-import": noTestUtilsImport,
    "no-top-level-global-write": noTopLevelGlobalWrite,
    "require-use-client": requireUseClient,
  },
};
