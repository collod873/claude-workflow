export function reason(err: unknown): string {
  const message = errorMessage(err);
  const output = childStdout(err);
  return output === undefined ? message : `${message}\n${output}`;
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

const STDOUT_TAIL = 4000;

function childStdout(err: unknown): string | undefined {
  const raw = (err as { stdout?: unknown } | null | undefined)?.stdout;
  const text =
    typeof raw === "string" ? raw : raw instanceof Uint8Array ? new TextDecoder().decode(raw) : "";

  const trimmed = text.trim();
  if (trimmed === "") return undefined;
  return trimmed.length > STDOUT_TAIL ? `…\n${trimmed.slice(-STDOUT_TAIL)}` : trimmed;
}
