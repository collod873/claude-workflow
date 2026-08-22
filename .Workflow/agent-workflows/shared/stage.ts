import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

/**
 * One `claude` invocation, as its argv (not including the `claude` binary
 * itself), returning stdout as a string. The only seam through which a
 * stage spawns a model — every stage and the local-debug entrypoint go
 * through this, so injecting a fake here is what lets a test assert on
 * prompt substitution and argv shape without launching one.
 */
export type StageExec = (argv: string[]) => string;

/**
 * The real StageExec: shells out to the `claude` CLI headlessly, in
 * print mode, with permission prompts skipped — there is no human on the
 * other end of a runner job to answer one. Requires
 * `CLAUDE_CODE_OAUTH_TOKEN` in the environment; the caller is responsible
 * for refusing before this runs when it's empty (the workflow's preflight
 * step in `.github/workflows/to-tickets.yml`).
 */
export const execClaude: StageExec = (argv) =>
  execFileSync("claude", argv, { encoding: "utf8", maxBuffer: 1024 * 1024 * 64 });

const PLACEHOLDER = /\{\{(\w+)\}\}/g;

/**
 * Runs one stage: reads `promptPath`, substitutes every `{{VAR}}`
 * placeholder in it with `vars[VAR]`, builds the `claude` argv for a single
 * headless print-mode call, and returns raw stdout via the injected `exec`.
 *
 * Throws, without calling `exec`, when the template references a
 * placeholder `vars` doesn't cover — a stage prompt with an unresolved
 * `{{VAR}}` is a wiring bug to catch here, not a partially-substituted
 * prompt to hand to a model.
 */
export function runStage(promptPath: string, vars: Record<string, string>, exec: StageExec): string {
  const template = readFileSync(promptPath, "utf8");
  const prompt = substitute(promptPath, template, vars);
  return exec(["-p", prompt, "--dangerously-skip-permissions"]);
}

function substitute(promptPath: string, template: string, vars: Record<string, string>): string {
  return template.replace(PLACEHOLDER, (match, name: string) => {
    if (!(name in vars)) {
      throw new Error(`${promptPath} references {{${name}}}, which no var was supplied for`);
    }
    return vars[name];
  });
}
