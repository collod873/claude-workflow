export const SEEDED_DOC_NAMES = ["ticket-format.md", "pipeline-labels.md", "issue-tracker.md", "spec-format.md"] as const;

export const WORKSTATION_CLONE = "~/.agents/workflow";

export const CLAUDE_MD_HEADING = "## Agent skills";

function titleOf(name: string): string {
  return name
    .replace(/\.md$/, "")
    .split("-")
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(" ");
}

export function pointerDocPath(name: string): string {
  return `docs/agents/${name}`;
}

export function pointerDoc(name: string, machineRepository: string): string {
  return [
    `# ${titleOf(name)}`,
    "",
    `Pointer, not a copy. Canonical: \`${machineRepository}\`'s \`${pointerDocPath(name)}\`.`,
    `Workstation clone: \`${WORKSTATION_CLONE}/${pointerDocPath(name)}\`.`,
    "",
  ].join("\n");
}

export function claudeMdPointerLine(machineRepository: string): string {
  return `Issue tracker, ticket format, pipeline labels, spec format → \`${machineRepository}\`'s \`docs/agents/\` (workstation clone: \`${WORKSTATION_CLONE}/docs/agents/\`).`;
}

export function withAgentSkillsPointer(content: string, machineRepository: string): string {
  const line = claudeMdPointerLine(machineRepository);
  if (content.includes(line)) return content;

  const headingRe = /^## Agent skills\s*$/m;
  if (headingRe.test(content)) {
    return content.replace(headingRe, (heading) => `${heading}\n\n${line}`);
  }

  const trimmed = content.replace(/\n+$/, "");
  return `${trimmed}\n\n${CLAUDE_MD_HEADING}\n\n${line}\n`;
}
