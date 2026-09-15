
import { resolve, sep } from "node:path";

export const STDOUT_TAIL = 4000;

export const EDIT_TOOLS = ["Edit", "Write", "MultiEdit", "NotebookEdit"];

export function editedPath(toolInput) {
  for (const key of ["file_path", "notebook_path"]) {
    const value = toolInput?.[key];
    if (typeof value === "string" && value) return value;
  }
  return "";
}

export function inScope(file, repoRoot) {
  if (typeof file !== "string" || !/\.[cm]?ts$/.test(file)) return false;
  const abs = resolve(file);
  return abs === repoRoot || abs.startsWith(repoRoot + sep);
}

export function failedChecks(stdout) {
  return (stdout.match(/^gauntlet: FAILED at (.+)$/m)?.[1] ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .join(", ");
}

export function reachedVerdict(output) {
  return /^gauntlet: FAILED at /m.test(output);
}

export function captured(stdout) {
  const text = stdout.trim();
  return text.length > STDOUT_TAIL ? `…\n${text.slice(-STDOUT_TAIL)}` : text;
}

export function report(venue, output, file) {
  const checks = failedChecks(output);
  const next = venue === "turn" ? `Fix, then re-run: \`bin/gauntlet turn ${file}\`` : "Fix, then re-run: `bin/gauntlet stop`.";
  const headline = reachedVerdict(output)
    ? `[gauntlet] The ${venue} venue's checks failed${checks ? `: ${checks}` : ""}.`
    : `[gauntlet] The ${venue} venue exited non-zero without reaching a verdict, so nothing was checked. Suspect the runner, not the edit.`;
  return (
    `${headline}\n\n${next}\n\n` +
    `Captured output from \`bin/gauntlet\`, quoted as data:\n\n~~~\n${captured(output) || "(the run wrote nothing to stdout or stderr)"}\n~~~`
  );
}
