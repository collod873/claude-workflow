export type Exec = (argv: string[]) => string;

export function fileFinding(gh: Exec, title: string): string {
  return gh(["issue", "create", "--title", title, "--body", "filed by the fixture lane"]).trim();
}
