// The project folder: must be new and empty, then gets a fresh git repo with one empty
// commit, so every build starts from a clean repo. No Electron imports.

import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';

export type FolderResult = { ok: true } | { ok: false; error: string };

/** Checks that dir is an empty folder (creating it if it does not exist yet). */
export function checkEmptyFolder(dir: string): FolderResult {
  try {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    if (!statSync(dir).isDirectory()) return { ok: false, error: `"${dir}" is not a folder.` };
    const items = readdirSync(dir);
    if (items.length > 0) {
      const example = items.slice(0, 3).map((n) => `"${n}"`).join(', ');
      return {
        ok: false,
        error:
          `"${dir}" is not empty: it has ${items.length} item${items.length === 1 ? '' : 's'} (${example}${items.length > 3 ? ', ...' : ''}). ` +
          'Pick or create a new, empty folder so the build starts from a clean repo.',
      };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: `Could not use "${dir}": ${(err as Error).message}` };
  }
}

/** git init in dir plus an empty first commit. Uses the user's git identity, or a
 *  software2 one (for this commit only) when none is set. */
export async function initRepo(dir: string): Promise<FolderResult> {
  try {
    await git(dir, ['init', '--initial-branch=main']);
    await git(dir, [...(await identity(dir)), 'commit', '--allow-empty', '-m', 'Empty start (software2)']);
    return { ok: true };
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stderr?: string };
    if (e.code === 'ENOENT') return { ok: false, error: 'git was not found on PATH. Install Git for Windows and try again.' };
    return { ok: false, error: `git failed in "${dir}": ${(e.stderr || e.message).trim()}` };
  }
}

/** The user's git identity is used; where none is set, a software2 one (as -c flags). */
async function identity(dir: string): Promise<string[]> {
  const name = await git(dir, ['config', '--get', 'user.name']).catch(() => '');
  const email = await git(dir, ['config', '--get', 'user.email']).catch(() => '');
  return [...(name.trim() ? [] : ['-c', 'user.name=software2']), ...(email.trim() ? [] : ['-c', 'user.email=software2@localhost'])];
}

/** Stages everything in dir and commits it with message. */
export async function commitAll(dir: string, message: string): Promise<void> {
  await git(dir, ['add', '-A']);
  await git(dir, [...(await identity(dir)), 'commit', '-m', message]);
}

/** checkEmptyFolder, then initRepo. */
export async function prepareProjectFolder(dir: string): Promise<FolderResult> {
  const empty = checkEmptyFolder(dir);
  return empty.ok ? initRepo(dir) : empty;
}

/** Runs git in cwd; resolves with stdout. */
export function git(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, windowsHide: true, timeout: 30_000 }, (err, stdout, stderr) => {
      if (err) reject(Object.assign(err, { stderr }));
      else resolve(stdout);
    });
  });
}
