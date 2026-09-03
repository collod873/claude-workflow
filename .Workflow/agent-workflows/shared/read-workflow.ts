import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

export const WORKFLOWS_DIR = join(REPO_ROOT, ".github/workflows");

export const STUB_SUFFIX = "-caller.yml";

export interface ParsedWorkflow<T = unknown> {
  path: string;
  source: string;
  workflow: T;
}

export interface NamedWorkflow<T = unknown> extends ParsedWorkflow<T> {
  name: string;
}

const isWorkflowFile = (name: string) => name.endsWith(".yml") || name.endsWith(".yaml");

export function workflowNames(dir = WORKFLOWS_DIR): string[] {
  return readdirSync(dir).filter(isWorkflowFile);
}

export function readWorkflow<T = unknown>(name: string, dir = WORKFLOWS_DIR): ParsedWorkflow<T> {
  const path = join(dir, name);
  const source = readFileSync(path, "utf8");
  return { path, source, workflow: parse(source) as T };
}

export function readWorkflows<T = unknown>(dir = WORKFLOWS_DIR): NamedWorkflow<T>[] {
  return workflowNames(dir).map((name) => ({ name, ...readWorkflow<T>(name, dir) }));
}

export function laneIds(): string[] {
  return workflowNames()
    .filter((name) => name.endsWith(STUB_SUFFIX))
    .map((name) => name.slice(0, -STUB_SUFFIX.length));
}
