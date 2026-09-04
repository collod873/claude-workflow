import { readFileSync } from "node:fs";
import { reason } from "../shared/reason";

const SPEC_FORMAT_PATH = "docs/agents/spec-format.md";

export function specFormat(): string {
  let page: string;
  try {
    page = readFileSync(SPEC_FORMAT_PATH, "utf8");
  } catch (err) {
    throw new Error(`the spec contract at ${SPEC_FORMAT_PATH} could not be read: ${reason(err)}`);
  }

  const [core, variants] = page.split(/^## Variants[ \t]*$/m);
  const laneSpec = variants
    ?.split(/^### /m)
    .find((section) => section.startsWith("Lane spec"));
  if (!core?.trim() || !laneSpec) {
    throw new Error(
      `${SPEC_FORMAT_PATH} has no "### Lane spec" variant under "## Variants", so the author's spec contract would be empty`,
    );
  }
  return `${core.trim()}\n\n## Variants\n\n### ${laneSpec.trim()}\n`;
}
