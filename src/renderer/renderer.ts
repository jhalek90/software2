// Renderer: the text box, the log, the build result, history and the settings panel. A plain script (no imports);
// everything it can do goes through window.api from the preload.

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const form = $<HTMLFormElement>('request-form');
const request = $<HTMLTextAreaElement>('request');
const statusText = $<HTMLSpanElement>('status-text');
const spinner = $<HTMLSpanElement>('spinner');
const elapsedEl = $<HTMLSpanElement>('elapsed');
const goButton = $<HTMLButtonElement>('go');
const logEl = $<HTMLPreElement>('log');

const settingsPanel = $<HTMLElement>('settings');
const settingsToggle = $<HTMLButtonElement>('settings-toggle');
const claudePath = $<HTMLInputElement>('claude-path');
const projectsFolder = $<HTMLInputElement>('projects-folder');
const buildCap = $<HTMLInputElement>('build-cap');
const skipPermissions = $<HTMLInputElement>('skip-permissions');
const savedEl = $<HTMLParagraphElement>('settings-saved');

function appendLog(entry: LogEntry): void {
  const atBottom = logEl.scrollTop + logEl.clientHeight >= logEl.scrollHeight - 4;
  const line = document.createElement('div');
  line.className = entry.kind;
  line.textContent = entry.text;
  logEl.appendChild(line);
  if (atBottom) logEl.scrollTop = logEl.scrollHeight;
}

function showSettings(s: Settings): void {
  claudePath.value = s.claudePath;
  projectsFolder.value = s.projectsFolder;
  buildCap.value = String(s.buildCapMinutes);
  skipPermissions.checked = s.skipPermissions;
}

async function save(change: Partial<Settings>): Promise<void> {
  try {
    showSettings(await window.api.saveSettings(change));
    savedEl.textContent = 'Saved.';
  } catch (err) {
    savedEl.textContent = `Could not save settings: ${(err as Error).message}`;
  }
}

settingsToggle.addEventListener('click', () => {
  settingsPanel.hidden = !settingsPanel.hidden;
  settingsToggle.setAttribute('aria-expanded', String(!settingsPanel.hidden));
});

claudePath.addEventListener('change', () => save({ claudePath: claudePath.value }));
projectsFolder.addEventListener('change', () => save({ projectsFolder: projectsFolder.value }));
buildCap.addEventListener('change', () => save({ buildCapMinutes: Number(buildCap.value) }));
skipPermissions.addEventListener('change', () => save({ skipPermissions: skipPermissions.checked }));

$<HTMLButtonElement>('claude-detect').addEventListener('click', async () => {
  const found = await window.api.detectClaude();
  if (found) await save({ claudePath: found });
  else savedEl.textContent = 'No "claude" found on PATH. Use Browse to pick it.';
});

$<HTMLButtonElement>('claude-browse').addEventListener('click', async () => {
  const picked = await window.api.pickClaude();
  if (picked) await save({ claudePath: picked });
});

$<HTMLButtonElement>('projects-browse').addEventListener('click', async () => {
  const picked = await window.api.pickFolder(projectsFolder.value);
  if (picked) await save({ projectsFolder: picked });
});

// Go: estimate, then the confirm dialog. "Build it" hands over to the main process,
// which opens the folder dialog and starts the build.

const confirmDialog = $<HTMLDialogElement>('confirm-dialog');
const failedDialog = $<HTMLDialogElement>('failed-dialog');
let working = false;

/** Statuses that get the spinner and the elapsed seconds. */
const LONG_STEPS = new Set(['Estimating...', 'Building...']);
let elapsedTimer: number | undefined;
/** Set while a build runs: the elapsed time is shown against its estimate. */
let buildClock: { startedAt: number; estimateMinutes: number; capMinutes: number } | null = null;

function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60));
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${mm.padStart(2, '0')}:${ss}` : `${mm}:${ss}`;
}

function showStatus(status: string): void {
  statusText.textContent = status;
  clearInterval(elapsedTimer);
  elapsedEl.textContent = '';
  elapsedEl.classList.remove('over');
  spinner.hidden = !LONG_STEPS.has(status);
  if (spinner.hidden) return;
  const started = Date.now();
  const tick = () => {
    if (!buildClock) {
      elapsedEl.textContent = `${Math.floor((Date.now() - started) / 1000)} s`;
      return;
    }
    const ms = Date.now() - buildClock.startedAt;
    elapsedEl.textContent = `${clock(ms)} of about ${buildClock.estimateMinutes} min estimated (stops at ${buildClock.capMinutes} min)`;
    elapsedEl.classList.toggle('over', ms > buildClock.estimateMinutes * 60_000);
  };
  tick();
  elapsedTimer = window.setInterval(tick, 1000);
}

function setWorking(on: boolean): void {
  working = on;
  goButton.disabled = on;
}

async function go(): Promise<void> {
  if (working) return;
  if (!request.value.trim()) {
    appendLog({ kind: 'error', text: 'Type what you want first.' });
    request.focus();
    return;
  }
  setWorking(true);
  let outcome: EstimateOutcome;
  try {
    outcome = await window.api.estimate(request.value);
  } catch (err) {
    outcome = { status: 'error', error: (err as Error).message };
  } finally {
    setWorking(false);
  }
  if (outcome.status === 'ok') await showConfirm(outcome.estimate);
  else if (outcome.status !== 'stopped') showFailed(outcome.error, 'raw' in outcome ? outcome.raw : undefined);
}

function fillList(list: HTMLElement, items: string[]): void {
  list.replaceChildren(
    ...items.map((text) => {
      const li = document.createElement('li');
      li.textContent = text;
      return li;
    }),
  );
}

async function showConfirm(estimate: Estimate): Promise<void> {
  const s = await window.api.getSettings();
  $('confirm-summary').textContent = estimate.summary;
  $('confirm-minutes').textContent = `About ${estimate.minutes} minute${estimate.minutes === 1 ? '' : 's'}.`;
  $('confirm-stack').textContent = estimate.stack ? `Stack: ${estimate.stack}` : '';
  fillList($('confirm-steps'), estimate.steps);
  fillList($('confirm-risks'), estimate.risks);
  $('confirm-risks-box').hidden = estimate.risks.length === 0;
  $('confirm-cap').textContent = `The build is stopped after ${s.buildCapMinutes} minutes (build time cap in Settings).`;
  $('confirm-warning').hidden = !s.skipPermissions;
  $('confirm-limited').hidden = s.skipPermissions;
  confirmDialog.returnValue = '';
  confirmDialog.showModal();
}

// Closing the dialog any other way (Esc) counts as Cancel.
confirmDialog.addEventListener('close', async () => {
  if (confirmDialog.returnValue !== 'build') {
    window.api.cancel();
    return;
  }
  setWorking(true);
  try {
    const res = await window.api.confirm();
    if (res.status === 'error') appendLog({ kind: 'error', text: res.error });
  } finally {
    setWorking(false);
  }
});

function showFailed(message: string, raw?: string): void {
  $('failed-message').textContent = message;
  $('failed-raw').textContent = raw ?? '';
  $('failed-raw-box').hidden = !raw;
  failedDialog.returnValue = '';
  failedDialog.showModal();
}

failedDialog.addEventListener('close', () => {
  if (failedDialog.returnValue === 'retry') go();
});

form.addEventListener('submit', (e) => {
  e.preventDefault();
  go();
});

// Ctrl+Enter submits from the text box.
request.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.ctrlKey) form.requestSubmit();
});

$<HTMLButtonElement>('stop').addEventListener('click', () => window.api.stop());

// The build: its result when it ends, and the history of past builds.

const resultBox = $<HTMLElement>('result');
const historyList = $<HTMLUListElement>('history');
const RESULT_TITLES: Record<HistoryEntry['result'], string> = {
  done: 'Done',
  stopped: 'Stopped',
  failed: 'Failed',
  'timed out': 'Timed out',
};
let shownEntry: HistoryEntry | null = null;

function took(ms: number): string {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`;
}

function showResult(entry: HistoryEntry): void {
  shownEntry = entry;
  $('result-title').textContent = RESULT_TITLES[entry.result] ?? entry.result;
  resultBox.dataset.result = entry.result;
  $('result-meta').textContent =
    `${new Date(entry.startedAt).toLocaleString()}, took ${took(entry.durationMs)} (estimate ${entry.estimateMinutes} min)`;
  $('result-request').textContent = entry.request;
  $('result-folder').textContent = entry.folder;
  $('result-summary').textContent = entry.summary;
  const li = (text: string, hash?: string) => {
    const item = document.createElement('li');
    if (hash) {
      const code = document.createElement('code');
      code.textContent = hash;
      item.append(code, ' ');
    }
    item.append(text);
    return item;
  };
  $('result-commits').replaceChildren(
    ...(entry.commits.length ? entry.commits.map((c) => li(c.subject, c.hash)) : [li('No commits.')]),
  );
  $<HTMLButtonElement>('open-readme').disabled = !entry.hasReadme;
  resultBox.hidden = false;
}

function showHistory(entries: HistoryEntry[]): void {
  $('history-empty').hidden = entries.length > 0;
  historyList.replaceChildren(
    ...entries.map((entry) => {
      const span = (className: string, text: string) => {
        const el = document.createElement('span');
        el.className = className;
        el.textContent = text;
        return el;
      };
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'history-item';
      button.title = entry.folder;
      button.append(
        span(`badge ${entry.result.replace(' ', '-')}`, entry.result),
        span('history-request', entry.request),
        span('muted-inline', `${new Date(entry.startedAt).toLocaleString()}, ${took(entry.durationMs)}, ${entry.folder}`),
      );
      button.addEventListener('click', () => showResult(entry));
      const item = document.createElement('li');
      item.append(button);
      return item;
    }),
  );
}

async function refreshHistory(): Promise<void> {
  showHistory(await window.api.getHistory());
}

$<HTMLButtonElement>('result-close').addEventListener('click', () => {
  resultBox.hidden = true;
  shownEntry = null;
});
$<HTMLButtonElement>('open-folder').addEventListener('click', () => {
  if (shownEntry) window.api.openFolder(shownEntry.id);
});
$<HTMLButtonElement>('open-readme').addEventListener('click', () => {
  if (shownEntry) window.api.openReadme(shownEntry.id);
});

window.api.onBuild((event) => {
  if (event.type === 'started') {
    resultBox.hidden = true;
    buildClock = {
      startedAt: Date.parse(event.startedAt),
      estimateMinutes: event.estimateMinutes,
      capMinutes: event.capMinutes,
    };
    showStatus('Building...');
  } else {
    buildClock = null;
    showResult(event.entry);
    refreshHistory();
  }
});

refreshHistory();
window.api.allowedCommands().then((commands) => {
  const words = commands.length < 2 ? commands.join('') : `${commands.slice(0, -1).join(', ')} and ${commands.at(-1)}`;
  document.querySelectorAll('.allowed-commands').forEach((el) => {
    el.textContent = words;
  });
});
$<HTMLButtonElement>('clear-log').addEventListener('click', () => logEl.replaceChildren());

window.api.onLog(appendLog);
window.api.onStatus(showStatus);

window.api.getSettings().then((s) => {
  showSettings(s);
  if (!s.claudePath) {
    settingsPanel.hidden = false;
    settingsToggle.setAttribute('aria-expanded', 'true');
    savedEl.textContent = 'Could not find the claude CLI. Set its path above.';
  }
});
