export function labelList(joined: string): string[] {
  return joined
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name !== "");
}

export function isOwner(sender: string, owner: string): boolean {
  return sender !== "" && sender === owner;
}
