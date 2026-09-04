import type { GitExec } from "../shared/git";
import type { StageExec } from "../shared/stage";
import { sessionRangeDiff } from "./diff";
import { applyTwoSiteGate, parseProposedFindings, proposedPrompt, type GatedProposedFinding } from "./lenses/proposed";
import { violationPrompt } from "./lenses/violation";

export interface AuditorOptions {
  git: GitExec;
  exec: StageExec;
  repoDir: string;
  base: string;
  head: string;
  touchedPaths?: string[];
  spine: string;
  standards: string;
}

const SANDBOX_FLAGS = [
  "--model",
  "sonnet",
  "--output-format",
  "text",
  "--no-session-persistence",
  "--tools",
  "",
  "--strict-mcp-config",
  "--disable-slash-commands",
  "--setting-sources",
  "",
];

async function runLens(exec: StageExec, prompt: string): Promise<string> {
  const reply = await exec(["-p", ...SANDBOX_FLAGS], prompt);
  return typeof reply === "string" ? reply : reply.text;
}

export async function runAuditor(options: AuditorOptions): Promise<string> {
  const { git, exec, repoDir, base, head, touchedPaths, spine, standards } = options;
  const diff = sessionRangeDiff({ git, repoDir, base, head, touchedPaths });
  const prompt = violationPrompt({ standards, diff, spine });
  return runLens(exec, prompt);
}

export interface ProposedAuditorOptions {
  git: GitExec;
  exec: StageExec;
  repoDir: string;
  base: string;
  head: string;
  touchedPaths?: string[];
  spine: string;
  priorFindings?: GatedProposedFinding[];
}

export async function runProposedAuditor(
  options: ProposedAuditorOptions,
): Promise<GatedProposedFinding[]> {
  const { git, exec, repoDir, base, head, touchedPaths, spine, priorFindings = [] } = options;
  const diff = sessionRangeDiff({ git, repoDir, base, head, touchedPaths });
  const prompt = proposedPrompt({ diff, spine });
  const raw = await runLens(exec, prompt);
  const findings = parseProposedFindings(raw);
  return applyTwoSiteGate(priorFindings, findings);
}
