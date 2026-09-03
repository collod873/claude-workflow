import { scrubGitLocationVars, scrubTargetLocationVars } from "./child-env.ts";

scrubGitLocationVars(process.env);

scrubTargetLocationVars(process.env);
