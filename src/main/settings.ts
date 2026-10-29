// App settings, stored as JSON in the app's own userData folder.
// No Electron imports here, so the tests can run it under plain Node.

import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface Settings {
  /** Path to the claude CLI. Empty: not found yet. */
  claudePath: string;
  /** Default parent folder for new projects. */
  projectsFolder: string;
  /** Hard time cap for a build, in minutes. */
  buildCapMinutes: number;
  /** Pass --dangerously-skip-permissions when building (read at build time). */
  skipPermissions: boolean;
}

export const SETTINGS_FILE = 'settings.json';

export function defaultSettings(): Settings {
  return {
    claudePath: findOnPath('claude') ?? '',
    projectsFolder: path.join(os.homedir(), 'software2-projects'),
    buildCapMinutes: 30,
    skipPermissions: true,
  };
}

/** Reads settings from dir, filling anything missing or invalid with defaults. */
export function loadSettings(dir: string): Settings {
  let stored: unknown = {};
  try {
    stored = JSON.parse(readFileSync(path.join(dir, SETTINGS_FILE), 'utf8'));
  } catch {
    // Missing or unreadable file: defaults.
  }
  return normalize(stored, defaultSettings());
}

/** Merges a change into the stored settings and writes them. Returns the result. */
export function saveSettings(dir: string, change: Partial<Settings>): Settings {
  const next = normalize({ ...loadSettings(dir), ...change }, defaultSettings());
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, SETTINGS_FILE);
  writeFileSync(file + '.tmp', JSON.stringify(next, null, 2));
  renameSync(file + '.tmp', file);
  return next;
}

function normalize(raw: unknown, defaults: Settings): Settings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const str = (v: unknown, d: string) => (typeof v === 'string' && v.trim() ? v.trim() : d);
  const cap = Number(r.buildCapMinutes);
  return {
    claudePath: str(r.claudePath, defaults.claudePath),
    projectsFolder: str(r.projectsFolder, defaults.projectsFolder),
    buildCapMinutes: Number.isFinite(cap) && cap >= 1 ? Math.min(Math.round(cap), 24 * 60) : defaults.buildCapMinutes,
    skipPermissions: typeof r.skipPermissions === 'boolean' ? r.skipPermissions : defaults.skipPermissions,
  };
}

/** Finds a command on PATH the way Windows would (PATHEXT order). Only looks at
 *  files; never runs anything. */
export function findOnPath(
  name: string,
  envPath = process.env.PATH ?? process.env.Path ?? '',
  pathExt = process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD',
): string | null {
  const exts = process.platform === 'win32' ? pathExt.split(';').filter(Boolean) : [''];
  for (const dir of envPath.split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const candidate = path.join(dir.replace(/^"|"$/g, ''), name + ext.toLowerCase());
      try {
        if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
      } catch {
        // Unreadable PATH entry: skip.
      }
    }
  }
  return null;
}
