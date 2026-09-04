export const GIT_LOCATION_VARS = [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_COMMON_DIR",
  "GIT_NAMESPACE",
  "GIT_CEILING_DIRECTORIES",
] as const;

export const TARGET_LOCATION_VARS = ["TARGET_WORKSPACE"] as const;

export const STAGE_SESSION_VARS = ["WORKFLOW_STAGE"] as const;

export function scrubTargetLocationVars(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  for (const key of TARGET_LOCATION_VARS) delete env[key];
  return env;
}

export function scrubStageSessionVars(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  for (const key of STAGE_SESSION_VARS) delete env[key];
  return env;
}

export function childEnv(): NodeJS.ProcessEnv {
  return scrubGitLocationVars({ ...process.env });
}

export function scrubGitLocationVars(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  for (const key of GIT_LOCATION_VARS) delete env[key];
  return env;
}
