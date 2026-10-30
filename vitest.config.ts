import { defineConfig } from "vitest/config";
import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

export const RUN_TEMP_PREFIX = "claude-workflow-test-run-";

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
};

function sweepInterruptedRuns(base: string): void {
  for (const name of readdirSync(base)) {
    if (!name.startsWith(RUN_TEMP_PREFIX)) continue;
    const pid = Number(name.slice(RUN_TEMP_PREFIX.length));
    if (Number.isInteger(pid) && pid !== process.pid && !alive(pid)) rmSync(join(base, name), { recursive: true, force: true });
  }
}

function ownRunTemp(): void {
  const base = tmpdir();
  if (basename(base).startsWith(RUN_TEMP_PREFIX)) return;
  sweepInterruptedRuns(base);
  const own = join(base, `${RUN_TEMP_PREFIX}${process.pid}`);
  rmSync(own, { recursive: true, force: true });
  mkdirSync(own);
  process.env.TMPDIR = own;
  process.once("exit", () => rmSync(own, { recursive: true, force: true }));
}

ownRunTemp();

export default defineConfig({
  test: {
    root: import.meta.dirname,
    include: ["src/**/*.test.ts"],
    exclude: ["**/node_modules/**", ".claude/**"],
    maxWorkers: "50%",
    testTimeout: 30_000,
  },
});
