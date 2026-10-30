// The project folder: always a new one, made by the app inside the projects folder from
// Settings, then a fresh git repo with one empty commit, so every build starts from a
// clean repo. No Electron imports.

import { execFile } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { numberedName } from './naming';

export type FolderResult = { ok: true } | { ok: false; error: string };

export type NewFolderResult = { ok: true; folder: string } | { ok: false; error: string };

/** How far name-2, name-3, ... go before giving up. */
const MAX_TRIES = 999;

/** The folder a new project called name would get in parent now: name, or name-2,
 *  name-3, ... when taken. Only looks; createProjectFolder may still pick a later one. */
export function plannedFolder(parent: string, name: string): string {
  for (let n = 1; n <= MAX_TRIES; n++) {
    const dir = path.join(path.resolve(parent), numberedName(name, n));
    if (!existsSync(dir)) return dir;
  }
  return path.join(path.resolve(parent), name);
}

/** Makes a new folder for the project in parent (made too if missing): name, or
 *  name-2, name-3, ... when taken. Never reuses a folder that is already there, even an
 *  empty one: each try is a plain mkdir, which fails if anything has that name. */
export function createProjectFolder(parent: string, name: string): NewFolderResult {
  const root = path.resolve(parent);
  try {
    mkdirSync(root, { recursive: true });
  } catch (err) {
    return { ok: false, error: `Could not create the projects folder "${root}": ${(err as Error).message}` };
  }
  for (let n = 1; n <= MAX_TRIES; n++) {
    const dir = path.join(root, numberedName(name, n));
    try {
      mkdirSync(dir);
      return { ok: true, folder: dir };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EEXIST') continue;
      return { ok: false, error: `Could not create "${dir}": ${(err as Error).message}` };
    }
  }
  return { ok: false, error: `"${root}" already has ${MAX_TRIES} folders called ${name}. Clear some out or pick another projects folder in Settings.` };
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

/** Runs git in cwd; resolves with stdout. */
export function git(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, windowsHide: true, timeout: 30_000 }, (err, stdout, stderr) => {
      if (err) reject(Object.assign(err, { stderr }));
      else resolve(stdout);
    });
  });
}
