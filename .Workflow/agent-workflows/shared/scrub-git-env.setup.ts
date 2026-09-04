import { scrubGitLocationVars, scrubTargetLocationVars } from "./child-env.ts";

/**
 * @fixture vitest loads this through `setupFiles`, so no import edge reaches it and no lane should.
 */

scrubGitLocationVars(process.env);

scrubTargetLocationVars(process.env);
