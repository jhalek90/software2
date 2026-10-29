// Past builds, stored as JSON in the app's own userData folder, newest first.
// No Electron imports, so the tests run it under plain Node.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export type BuildResult = 'done' | 'stopped' | 'failed' | 'timed out';

export interface Commit {
  hash: string;
  subject: string;
}

export interface HistoryEntry {
  id: string;
  request: string;
  folder: string;
  /** ISO time the build started. */
  startedAt: string;
  durationMs: number;
  result: BuildResult;
  /** Claude's final summary, or why it failed. */
  summary: string;
  estimateMinutes: number;
  commits: Commit[];
  hasReadme: boolean;
  /** The run's full log (estimate and build), in the app's logs folder. */
  logFile?: string;
}

export const HISTORY_FILE = 'history.json';
/** Older entries are dropped. */
export const HISTORY_MAX = 100;

export function loadHistory(dir: string): HistoryEntry[] {
  try {
    const raw = JSON.parse(readFileSync(path.join(dir, HISTORY_FILE), 'utf8'));
    return Array.isArray(raw) ? raw.filter(isEntry) : [];
  } catch {
    // Missing or unreadable file: no history.
    return [];
  }
}

/** Puts entry first and writes the file. Returns the new list. */
export function addHistory(dir: string, entry: HistoryEntry): HistoryEntry[] {
  const next = [entry, ...loadHistory(dir).filter((e) => e.id !== entry.id)].slice(0, HISTORY_MAX);
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, HISTORY_FILE);
  writeFileSync(file + '.tmp', JSON.stringify(next, null, 2));
  renameSync(file + '.tmp', file);
  return next;
}

function isEntry(v: unknown): v is HistoryEntry {
  const e = v as HistoryEntry;
  return !!e && typeof e === 'object' && typeof e.id === 'string' && typeof e.folder === 'string' && typeof e.request === 'string';
}
