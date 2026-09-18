import { execFileSync } from "node:child_process";
import { childEnv } from "./child-env.ts";

export type GitExec = (args: string[]) => string;

export const execGit: GitExec = (args) =>
  execFileSync("git", args, {
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
    env: childEnv(),
    stdio: ["pipe", "pipe", "pipe"],
  });
