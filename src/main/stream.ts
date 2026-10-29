// Turns the CLI's `--output-format stream-json` lines into a readable log: Claude's
// text, tool calls as one-liners ("Edit src/app.js", "Bash npm test") and short tool
// results. No Electron imports.

import path from 'node:path';

export interface StreamResult {
  text: string;
  isError: boolean;
  numTurns?: number;
}

export interface ParsedLine {
  entries: LogEntry[];
  /** What Claude is doing now, as one short sentence for the status line ("Writing src/app.js").
   *  Set when the line says something new; the last block of the line wins. */
  activity?: string;
  /** Set by the final `result` event. */
  result?: StreamResult;
}

/** Tool results are cut to this many lines of this many characters. */
const RESULT_LINES = 3;
const LINE_CHARS = 160;

/** Parses one stdout line. folder: the project folder, for showing paths relative to it. */
export function parseStreamLine(line: string, folder: string): ParsedLine {
  if (!line.trim()) return { entries: [] };
  let ev: Record<string, any>;
  try {
    ev = JSON.parse(line);
  } catch {
    return { entries: [{ kind: 'stdout', text: line }] };
  }
  if (!ev || typeof ev !== 'object') return { entries: [{ kind: 'stdout', text: line }] };

  switch (ev.type) {
    case 'system':
      if (ev.subtype === 'init') {
        const bits = [ev.model && `model ${ev.model}`, ev.permissionMode && `permission mode ${ev.permissionMode}`].filter(Boolean);
        return { entries: [{ kind: 'info', text: `Claude started${bits.length ? ` (${bits.join(', ')})` : ''}.` }], activity: 'Getting started...' };
      }
      if (ev.subtype === 'compact_boundary') {
        return { entries: [{ kind: 'info', text: 'Claude compacted its context.' }], activity: 'Tidying up its notes...' };
      }
      return { entries: [] };

    case 'assistant': {
      const blocks = contentOf(ev);
      const activity = blocks.map((block) => blockActivity(block, folder)).filter(Boolean).at(-1);
      return { entries: blocks.flatMap((block) => assistantBlock(block, folder)), ...(activity ? { activity } : {}) };
    }

    case 'user':
      return { entries: contentOf(ev).flatMap(toolResult) };

    case 'result': {
      const text = typeof ev.result === 'string' ? ev.result : '';
      const isError = ev.is_error === true || (typeof ev.subtype === 'string' && ev.subtype !== 'success');
      const numTurns = typeof ev.num_turns === 'number' ? ev.num_turns : undefined;
      const facts = [numTurns !== undefined && `${numTurns} turn${numTurns === 1 ? '' : 's'}`].filter(Boolean);
      const entries: LogEntry[] = [
        {
          kind: isError ? 'error' : 'info',
          text: `${isError ? `Claude ended with an error (${ev.subtype ?? 'error'})` : 'Claude finished'}${facts.length ? `, ${facts.join(', ')}` : ''}.`,
        },
      ];
      if (isError && text) entries.push({ kind: 'error', text });
      return { entries, result: { text, isError, numTurns } };
    }

    default:
      // stream_event (partial messages), hook events and anything newer: not shown.
      return { entries: [] };
  }
}

function contentOf(ev: Record<string, any>): Record<string, any>[] {
  const content = ev.message?.content;
  if (typeof content === 'string') return [{ type: 'text', text: content }];
  return Array.isArray(content) ? content.filter((b) => b && typeof b === 'object') : [];
}

function assistantBlock(block: Record<string, any>, folder: string): LogEntry[] {
  if (block.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
    return [{ kind: 'assistant', text: block.text.trim() }];
  }
  if (block.type === 'tool_use') return [{ kind: 'tool', text: toolLine(String(block.name ?? 'Tool'), block.input ?? {}, folder) }];
  return [];
}

/** One line for a tool call: the tool's name and what it works on. */
export function toolLine(name: string, input: Record<string, any>, folder: string): string {
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  const rel = (p: string) => relPath(p, folder);
  let what: string;
  switch (name) {
    case 'Read':
    case 'Write':
    case 'Edit':
    case 'MultiEdit':
      what = rel(str(input.file_path));
      break;
    case 'NotebookEdit':
      what = rel(str(input.notebook_path));
      break;
    case 'Bash':
    case 'PowerShell':
      what = str(input.command);
      break;
    case 'Glob':
      what = [str(input.pattern), input.path ? `in ${rel(str(input.path))}` : ''].filter(Boolean).join(' ');
      break;
    case 'Grep':
      what = [JSON.stringify(str(input.pattern)), input.path ? `in ${rel(str(input.path))}` : ''].filter(Boolean).join(' ');
      break;
    case 'TodoWrite': {
      const todos = Array.isArray(input.todos) ? input.todos : [];
      const done = todos.filter((t: any) => t?.status === 'completed').length;
      what = `${done} of ${todos.length} done`;
      break;
    }
    case 'Task':
    case 'Agent':
      what = str(input.description) || str(input.prompt);
      break;
    case 'WebFetch':
      what = str(input.url);
      break;
    case 'WebSearch':
      what = str(input.query);
      break;
    default:
      what = Object.values(input).find((v): v is string => typeof v === 'string' && v.trim() !== '') ?? '';
  }
  return `${name} ${oneLine(what)}`.trim();
}

/** Status lines are cut to this many characters (the window cuts them further with an ellipsis). */
const ACTIVITY_CHARS = 90;
/** Claude's text is shown as is only when its first sentence is this short; otherwise "Thinking...". */
const SENTENCE_CHARS = 80;

function blockActivity(block: Record<string, any>, folder: string): string | undefined {
  if (block.type === 'tool_use') return toolActivity(String(block.name ?? 'Tool'), block.input ?? {}, folder);
  if (block.type === 'thinking' || block.type === 'redacted_thinking') return 'Thinking...';
  if (block.type === 'text' && typeof block.text === 'string' && block.text.trim()) return textActivity(block.text);
  return undefined;
}

/** Claude's text as a status: its first sentence when that is short, else "Thinking...". */
export function textActivity(text: string): string {
  const first = (text.split(/\r?\n/).find((l) => l.trim()) ?? '')
    .replace(/^[\s#>*\-]+/, '')
    .replace(/[*_`]/g, '')
    .trim();
  const sentence = (first.match(/^.*?[.!?:](?=\s|$)/)?.[0] ?? first).replace(/:$/, '...').trim();
  return sentence && sentence.length <= SENTENCE_CHARS ? sentence : 'Thinking...';
}

/** A tool call as a status: "Writing src/app.js", "Running npm test", "Committing: Add README". */
export function toolActivity(name: string, input: Record<string, any>, folder: string): string {
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  const file = (p: unknown) => relPath(str(p), folder) || 'a file';
  let text: string;
  switch (name) {
    case 'Write':
      text = `Writing ${file(input.file_path)}`;
      break;
    case 'Edit':
    case 'MultiEdit':
      text = `Editing ${file(input.file_path)}`;
      break;
    case 'NotebookEdit':
      text = `Editing ${file(input.notebook_path)}`;
      break;
    case 'Read':
      text = `Reading ${file(input.file_path)}`;
      break;
    case 'Bash':
    case 'PowerShell':
      text = commandActivity(str(input.command)) || str(input.description) || 'Running a command';
      break;
    case 'Glob':
      text = `Looking for ${str(input.pattern) || 'files'}`;
      break;
    case 'Grep':
      text = `Searching for ${JSON.stringify(str(input.pattern))}`;
      break;
    case 'TodoWrite': {
      const todos = Array.isArray(input.todos) ? input.todos : [];
      const done = todos.filter((t: any) => t?.status === 'completed').length;
      text = todos.length ? `Planning: ${done} of ${todos.length} steps done` : 'Planning';
      break;
    }
    case 'Task':
    case 'Agent':
      text = `Handing off: ${str(input.description) || 'a sub-task'}`;
      break;
    case 'WebFetch':
      text = `Fetching ${str(input.url) || 'a web page'}`;
      break;
    case 'WebSearch':
      text = `Searching the web for ${JSON.stringify(str(input.query))}`;
      break;
    default:
      text = `Using ${name}`;
  }
  return cut(oneLine(text, ACTIVITY_CHARS).replace(/ \.\.\.$/, '...'), ACTIVITY_CHARS);
}

/** "Committing: <message>" for a git commit anywhere in the command, else "Running <first line>". */
function commandActivity(command: string): string {
  const commit = command.match(/\bgit\b(?:\s+-c\s+\S+)*\s+commit\b[^\n]*?\s(?:-[a-zA-Z]*m|--message)[= ]?\s*(?:"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+))/);
  if (commit) return `Committing: ${(commit[1] ?? commit[2] ?? commit[3]).replace(/\\"/g, '"')}`;
  if (/\bgit\b(?:\s+-c\s+\S+)*\s+commit\b/.test(command)) return 'Committing';
  const lines = command.split(/\r?\n/).filter((l) => l.trim());
  return lines.length ? `Running ${lines[0].trim()}${lines.length > 1 ? '...' : ''}` : '';
}

function cut(text: string, max: number): string {
  return text.length > max ? text.slice(0, max - 3).trimEnd() + '...' : text;
}

/** A path relative to the project folder when it is inside it, with forward slashes. */
function relPath(p: string, folder: string): string {
  if (!p) return '';
  if (!folder || !path.isAbsolute(p)) return p.replace(/\\/g, '/');
  const rel = path.relative(folder, p);
  if (rel === '') return '.';
  if (rel.startsWith('..') || path.isAbsolute(rel)) return p;
  return rel.replace(/\\/g, '/');
}

function oneLine(text: string, max = 200): string {
  const first = text.split(/\r?\n/).find((l) => l.trim()) ?? '';
  const more = text.trim().includes('\n');
  const cut = first.length > max ? first.slice(0, max - 3) + '...' : first;
  return more && cut === first ? `${cut} ...` : cut;
}

function toolResult(block: Record<string, any>): LogEntry[] {
  if (block.type !== 'tool_result') return [];
  const raw = block.content;
  const text =
    typeof raw === 'string'
      ? raw
      : Array.isArray(raw)
        ? raw.map((c: any) => (c?.type === 'text' && typeof c.text === 'string' ? c.text : '')).join('\n')
        : '';
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length === 0) return block.is_error ? [{ kind: 'error', text: '  -> (error)' }] : [];
  const shown = lines
    .slice(0, RESULT_LINES)
    .map((l) => '  ' + (l.length > LINE_CHARS ? l.slice(0, LINE_CHARS - 3) + '...' : l));
  if (lines.length > RESULT_LINES) shown.push(`  (${lines.length - RESULT_LINES} more line${lines.length - RESULT_LINES === 1 ? '' : 's'})`);
  shown[0] = '  -> ' + shown[0].slice(2);
  return [{ kind: block.is_error ? 'error' : 'output', text: shown.join('\n') }];
}
