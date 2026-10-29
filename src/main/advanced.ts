// The Advanced panel's options for one run: a run-time cap, a design style and files the
// person supplies. Checks them, copies the files into the project's assets/ folder and
// writes the prompt lines about them. No Electron imports, so the tests run it under Node.

import { copyFile, mkdir } from 'node:fs/promises';
import { statSync } from 'node:fs';
import path from 'node:path';
import { commitAll } from './project';

/** What the page sends with Go. Empty or missing values mean "not set". */
export interface AdvancedOptions {
  /** Minutes for this run's time cap, instead of the one in Settings. */
  capMinutes?: number | null;
  /** The design direction, in the person's words. */
  style?: string;
  /** Full paths of the files to copy into the project's assets/ folder. */
  files?: string[];
}

/** A file the person supplied. path is only used for copying, never sent to Claude. */
export interface UserFile {
  path: string;
  name: string;
  size: number;
  type: string;
}

/** A file as Claude hears about it: in the estimate only these three, and in the build
 *  name is its name inside assets/. */
export interface FileInfo {
  name: string;
  size: number;
  type: string;
}

/** The options after checking: what the build gets. */
export interface RunExtras {
  capMinutes?: number;
  style: string;
  files: UserFile[];
}

export const RUN_TIME_MIN = 5;
export const RUN_TIME_MAX = 120;
export const MAX_TOTAL_BYTES = 200 * 1024 * 1024;
export const ASSETS_DIR = 'assets';
const MAX_STYLE_LENGTH = 300;

/** The minutes, kept inside RUN_TIME_MIN..RUN_TIME_MAX; undefined when not set. */
export function clampRunTime(minutes: unknown): number | undefined {
  const n = Number(minutes);
  if (minutes === null || minutes === undefined || minutes === '' || !Number.isFinite(n) || n <= 0) return undefined;
  return Math.min(Math.max(Math.round(n), RUN_TIME_MIN), RUN_TIME_MAX);
}

/** Looks at each path: files come back with their size and type, anything else as a
 *  message saying why it was left out. Opens nothing. */
export function inspectFiles(paths: string[]): { files: UserFile[]; refused: string[] } {
  const files: UserFile[] = [];
  const refused: string[] = [];
  for (const p of paths) {
    const name = path.basename(p);
    try {
      const st = statSync(p);
      if (st.isDirectory()) refused.push(`"${name}" is a folder. Add the files inside it instead.`);
      else if (!st.isFile()) refused.push(`"${name}" is not a file.`);
      else files.push({ path: p, name, size: st.size, type: fileType(name) });
    } catch {
      refused.push(`"${name}" could not be found.`);
    }
  }
  return { files, refused };
}

/** The size cap message, or null when the total fits. */
export function sizeCapError(totalBytes: number): string | null {
  if (totalBytes <= MAX_TOTAL_BYTES) return null;
  return `These files add up to ${formatSize(totalBytes)}, over the ${formatSize(MAX_TOTAL_BYTES)} limit. Remove some and try again.`;
}

/** Checks the page's options again in the main process (the files may have changed since
 *  they were added). */
export function checkOptions(opts: AdvancedOptions | undefined): { ok: true; extras: RunExtras } | { ok: false; error: string } {
  const paths = [...new Set((opts?.files ?? []).filter((p) => typeof p === 'string' && p))];
  const { files, refused } = inspectFiles(paths);
  if (refused.length) return { ok: false, error: refused.join(' ') };
  const tooBig = sizeCapError(files.reduce((sum, f) => sum + f.size, 0));
  if (tooBig) return { ok: false, error: tooBig };
  const style = String(opts?.style ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_STYLE_LENGTH);
  const capMinutes = clampRunTime(opts?.capMinutes);
  return { ok: true, extras: { ...(capMinutes ? { capMinutes } : {}), style, files } };
}

/** name, or "name (2).ext" and so on, so it is unique in taken (compared the way Windows
 *  does, ignoring case). Adds the result to taken. */
export function uniqueName(name: string, taken: Set<string>): string {
  const ext = path.extname(name);
  const stem = name.slice(0, name.length - ext.length);
  let candidate = name;
  for (let i = 2; taken.has(candidate.toLowerCase()); i++) candidate = `${stem} (${i})${ext}`;
  taken.add(candidate.toLowerCase());
  return candidate;
}

/** Copies the files into folder/assets (names kept, clashes numbered) and commits them,
 *  so Claude starts from a clean tree. Returns the files with their names in assets/. */
export async function copyIntoAssets(folder: string, files: UserFile[]): Promise<FileInfo[]> {
  if (!files.length) return [];
  const dir = path.join(folder, ASSETS_DIR);
  await mkdir(dir, { recursive: true });
  const taken = new Set<string>();
  const copied: FileInfo[] = [];
  for (const f of files) {
    const name = uniqueName(f.name, taken);
    await copyFile(f.path, path.join(dir, name));
    copied.push({ name, size: f.size, type: f.type });
  }
  await commitAll(folder, 'Add the files supplied for this project (software2)');
  return copied;
}

/** The design-direction paragraph for the prompts. */
export function designText(style: string | undefined): string {
  const s = (style ?? '').trim();
  if (!s) return 'None given: choose a clean look that suits what is being built.';
  return `The person asked for this look and feel, in their words:\n<design>\n${s}\n</design>\nFollow it for the visual design.`;
}

/** The files paragraph for the prompts. In the build they are in assets/ already. */
export function filesText(files: FileInfo[] | undefined, where: 'estimate' | 'build'): string {
  if (!files?.length) return 'None.';
  const list = files.map((f) => `- ${where === 'build' ? `${ASSETS_DIR}/` : ''}${f.name} (${f.type}, ${formatSize(f.size)})`).join('\n');
  if (where === 'estimate') {
    return `The person will supply ${files.length === 1 ? 'this file' : `these ${files.length} files`} to use in the project (only the names, types and sizes are shown here):\n${list}`;
  }
  return (
    `The person supplied ${files.length === 1 ? 'this file' : `these ${files.length} files`} to use in the project, for example photos for a website. ` +
    `They are already in the ${ASSETS_DIR}/ folder here, committed:\n${list}\n` +
    `Use them where they fit what was asked for. Do not delete, rename or edit them; make resized copies if you need other sizes. Say in the README where they are used.`
  );
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  const mb = kb / 1024;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

const TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.bmp': 'image/bmp', '.avif': 'image/avif', '.heic': 'image/heic',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
  '.ogg': 'audio/ogg', '.pdf': 'application/pdf', '.txt': 'text/plain', '.md': 'text/markdown', '.csv': 'text/csv',
  '.json': 'application/json', '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.xml': 'application/xml',
  '.ttf': 'font/ttf', '.otf': 'font/otf', '.woff': 'font/woff', '.woff2': 'font/woff2', '.zip': 'application/zip',
  '.xlsx': 'spreadsheet (xlsx)', '.docx': 'document (docx)',
};

/** A plain type from the extension only; the file is never opened. */
export function fileType(name: string): string {
  return TYPES[path.extname(name).toLowerCase()] ?? 'file';
}
