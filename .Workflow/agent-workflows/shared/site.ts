/**
 * What a site is, and how to read one as a path.
 *
 * A finding is anchored to a site, and two mechanisms read that anchor as a
 * path: the staleness self-drop (`./notes.ts`) resolves it against a ref to
 * decide whether the finding still describes anything, and the two-site gate
 * (`./lenses/proposed.ts`) compares two of them to decide whether they are
 * distinct. Both need the same answer to "which path is this", so the rule
 * lives here rather than in either — #108, where `notes.ts` held a private
 * answer that the lens writing sites had never been told.
 *
 * The contract is `path` or `path:line`, with no whitespace: everything a
 * reader needs to find the code, and nothing a reader has to interpret.
 * Prose belongs in the finding, which is the field that carries it.
 */

/** A site already in contract form: a whitespace-free path, optionally `:<line>`. */
const BARE_SITE = /^\S+$/;

/**
 * True when `site` is already what the contract says a site is. False for
 * anything carrying a parenthetical, a comment, or a second word — the shape
 * the PROPOSED lens actually emitted for every site in the first real audit.
 */
export function isBareSite(site: string): boolean {
  return BARE_SITE.test(site.trim());
}

/**
 * `site` reduced to contract form: its leading whitespace-free token, which
 * for a site the lens wrote as prose is the path plus line the prose was
 * hung off. Applied where a site is produced (`./lenses/grammar.ts`) and
 * where two are compared (`applyTwoSiteGate`), so a note written before this
 * existed and one written after compare equal instead of reading as two
 * distinct sightings and falsely clearing the two-site gate.
 */
export function normalizeSite(site: string): string {
  return site.trim().split(/\s+/)[0] ?? "";
}

/**
 * The path `site` names — its normalized form with a trailing `:<line>`
 * removed. A path with no line suffix is returned unchanged, and a colon not
 * followed by digits is left alone, since it is part of the path rather than
 * a line number.
 */
export function sitePath(site: string): string {
  const token = normalizeSite(site);
  const lastColon = token.lastIndexOf(":");
  if (lastColon === -1) return token;
  return /^\d+$/.test(token.slice(lastColon + 1)) ? token.slice(0, lastColon) : token;
}
