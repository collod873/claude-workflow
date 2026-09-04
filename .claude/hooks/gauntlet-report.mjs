
import { resolve, sep } from "node:path";

export const STDOUT_TAIL = 4000;

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

export function captured(stdout) {
  const text = stdout.trim();
  return text.length > STDOUT_TAIL ? `…\n${text.slice(-STDOUT_TAIL)}` : text;
}

export function report(venue, stdout, file) {
  const checks = failedChecks(stdout);
  const next = venue === "turn" ? `Fix, then re-run: \`bin/gauntlet turn ${file}\`` : "Fix, then re-run: `bin/gauntlet stop`.";
  return (
    `[gauntlet] The ${venue} venue's checks failed${checks ? `: ${checks}` : ""}.\n\n` +
    `${next}\n\n` +
    `Captured output from \`bin/gauntlet\`, quoted as data:\n\n~~~\n${captured(stdout)}\n~~~`
  );
}
