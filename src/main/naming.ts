// The project's folder name: from the estimate's "name", else from the request, made safe
// for Windows (lowercase a-z, 0-9 and hyphens, at most 40 characters, never a reserved
// device name). No Electron imports.

export const MAX_NAME_LENGTH = 40;
export const FALLBACK_NAME = 'project';

/** Names Windows keeps for devices, with or without an extension. */
const RESERVED = new Set(['con', 'prn', 'aux', 'nul', ...[1, 2, 3, 4, 5, 6, 7, 8, 9].flatMap((n) => [`com${n}`, `lpt${n}`])]);

/** Words left out of a name made from the request. */
const FILLER = new Set(['a', 'an', 'the', 'my', 'our', 'your', 'me', 'some', 'of', 'about', 'very', 'just', 'please', 'to', 'and']);

/** Where the "what" of a request usually ends: "a timer | with a big start button". */
const CLAUSE_END = /[,;:.!?()]|\s(?:with|that|which|where|who|using|so|for|like|in|on)\s/i;

/** A safe folder name from raw, or null when nothing usable is left (empty, or a
 *  reserved name). Accents are dropped ("café" -> "cafe"), anything else that is not
 *  a-z or 0-9 becomes one hyphen, and a long name is cut at a hyphen where it can be. */
export function cleanName(raw: unknown, maxLength = MAX_NAME_LENGTH): string | null {
  if (typeof raw !== 'string') return null;
  let name = raw
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (name.length > maxLength) {
    const cut = name.slice(0, maxLength + 1);
    const lastHyphen = cut.lastIndexOf('-');
    name = (lastHyphen >= maxLength / 2 ? cut.slice(0, lastHyphen) : name.slice(0, maxLength)).replace(/-+$/, '');
  }
  if (!name || RESERVED.has(name)) return null;
  return name;
}

/** cleanName, or "project" when nothing is left. */
export function safeFolderName(raw: unknown): string {
  return cleanName(raw) ?? FALLBACK_NAME;
}

/** A name from the request: without "build me", up to where its "what" ends, filler
 *  words left out, the first four words. "Build me a pomodoro timer with sounds" ->
 *  "pomodoro-timer". */
export function nameFromRequest(request: string): string {
  const text = request.replace(/\s+/g, ' ').trim().replace(/^build me\b[\s:,]*/i, '');
  const words = (part: string) =>
    part
      .split(/[\s/\\]+/)
      .filter((w) => w && !FILLER.has(w.toLowerCase().replace(/[^a-z]/g, '')))
      .slice(0, 4);
  const end = text.search(CLAUSE_END);
  let picked = words(end > 0 ? text.slice(0, end) : text);
  if (!picked.some((w) => cleanName(w))) picked = words(text);
  return safeFolderName(picked.join(' '));
}

/** The estimate's name if it is usable, else one from the request. */
export function projectName(estimateName: unknown, request: string): string {
  return cleanName(estimateName) ?? nameFromRequest(request);
}

/** name, name-2, name-3, ...: each kept within MAX_NAME_LENGTH. */
export function numberedName(name: string, n: number): string {
  if (n <= 1) return name;
  const suffix = `-${n}`;
  return `${name.slice(0, MAX_NAME_LENGTH - suffix.length).replace(/-+$/, '')}${suffix}`;
}
