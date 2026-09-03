const BARE_SITE = /^\S+$/;

export function isBareSite(site: string): boolean {
  return BARE_SITE.test(site.trim());
}

export function normalizeSite(site: string): string {
  return site.trim().split(/\s+/)[0] ?? "";
}

export function sitePath(site: string): string {
  const token = normalizeSite(site);
  const lastColon = token.lastIndexOf(":");
  if (lastColon === -1) return token;
  return /^\d+$/.test(token.slice(lastColon + 1)) ? token.slice(0, lastColon) : token;
}
