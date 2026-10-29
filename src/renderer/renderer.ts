// Renderer: the text box, the live status line, the build result, the History drawer and
// the Settings sheet. A plain script (no imports); everything it can do goes through
// window.api from the preload. The full log is not shown here: it goes to a file per run.

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const form = $<HTMLFormElement>('request-form');
const request = $<HTMLTextAreaElement>('request');
const goButton = $<HTMLButtonElement>('go');
const noticeEl = $<HTMLParagraphElement>('notice');

const settingsDialog = $<HTMLDialogElement>('settings-dialog');
const claudePath = $<HTMLInputElement>('claude-path');
const projectsFolder = $<HTMLInputElement>('projects-folder');
const buildCap = $<HTMLInputElement>('build-cap');
const skipPermissions = $<HTMLInputElement>('skip-permissions');
const savedEl = $<HTMLParagraphElement>('settings-saved');
const historyDrawer = $<HTMLDialogElement>('history-drawer');

/** A short message under the text box, for things that went wrong outside a run. */
function showNotice(text: string): void {
  noticeEl.textContent = text;
  noticeEl.hidden = !text;
}

// Settings (behind the gear) and History (behind the clock).

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

$<HTMLButtonElement>('settings-open').addEventListener('click', () => {
  savedEl.textContent = '';
  settingsDialog.showModal();
});
$<HTMLButtonElement>('history-open').addEventListener('click', async () => {
  await refreshHistory();
  historyDrawer.showModal();
});

// Close buttons, and a click on the dimmed backdrop, close the sheet or drawer.
for (const dialog of [settingsDialog, historyDrawer]) {
  dialog.querySelector('[data-close]')?.addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) {
      const r = dialog.getBoundingClientRect();
      const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      if (!inside) dialog.close();
    }
  });
}

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

// The live status line: a spinner, one sentence for what is happening now, the elapsed
// time (against the estimate while building), a thin progress bar and Stop.

const statusBox = $<HTMLDivElement>('status');
const statusText = $<HTMLSpanElement>('status-text');
const spinner = $<HTMLSpanElement>('spinner');
const elapsedEl = $<HTMLSpanElement>('elapsed');
const progressBar = $<HTMLDivElement>('progress-bar');
const stopButton = $<HTMLButtonElement>('stop');

type Phase = 'idle' | 'estimating' | 'folder' | 'building';
let phase: Phase = 'idle';
let phaseStarted = 0;
let elapsedTimer: number | undefined;
/** Set while a build runs: the elapsed time is shown against its estimate. */
let buildClock: { startedAt: number; estimateMinutes: number; capMinutes: number } | null = null;

/** Activity updates are shown at most this often, so the line does not flicker. */
const ACTIVITY_MS = 700;
let activityShownAt = 0;
let pendingActivity = '';
let activityTimer: number | undefined;

function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60));
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${mm.padStart(2, '0')}:${ss}` : `${mm}:${ss}`;
}

function tick(): void {
  if (phase === 'estimating') {
    elapsedEl.textContent = clock(Date.now() - phaseStarted);
  } else if (phase === 'building' && buildClock) {
    const ms = Date.now() - buildClock.startedAt;
    const estimateMs = Math.max(1, buildClock.estimateMinutes) * 60_000;
    const over = ms > estimateMs;
    elapsedEl.textContent = over
      ? `${clock(ms)} · taking longer than estimated`
      : `${clock(ms)} of ~${buildClock.estimateMinutes} min`;
    elapsedEl.title = `Stops at ${buildClock.capMinutes} min (the build time cap in Settings).`;
    statusBox.classList.toggle('over', over);
    progressBar.style.width = `${Math.min(100, (ms / estimateMs) * 100)}%`;
  }
}

function setPhase(next: Phase, text = ''): void {
  phase = next;
  phaseStarted = Date.now();
  clearInterval(elapsedTimer);
  clearTimeout(activityTimer);
  activityTimer = undefined;
  pendingActivity = '';
  statusBox.hidden = next === 'idle';
  statusBox.dataset.phase = next;
  statusBox.classList.remove('over');
  spinner.hidden = next === 'folder';
  stopButton.hidden = next === 'folder';
  stopButton.disabled = false;
  statusText.textContent = text;
  elapsedEl.textContent = '';
  elapsedEl.title = '';
  progressBar.style.width = '0%';
  if (next === 'estimating' || next === 'building') {
    tick();
    elapsedTimer = window.setInterval(tick, 1000);
  }
}

function showActivity(text: string): void {
  if (phase !== 'building' || stopButton.disabled) return; // stopButton.disabled: "Stopping..." stays
  pendingActivity = text;
  if (activityTimer !== undefined) return;
  const show = () => {
    activityTimer = undefined;
    activityShownAt = Date.now();
    if (phase === 'building' && !stopButton.disabled && pendingActivity) statusText.textContent = pendingActivity;
  };
  const wait = activityShownAt + ACTIVITY_MS - Date.now();
  if (wait <= 0) show();
  else activityTimer = window.setTimeout(show, wait);
}

/** The flow's status words, mapped onto the status line. */
function onStatus(status: string): void {
  if (status === 'Estimating...') setPhase('estimating', 'Estimating how long it will take...');
  else if (status === 'Choose a folder for the project') setPhase('folder', 'Choose or create an empty folder for the project');
  else if (status === 'Building...') {
    if (phase !== 'building') setPhase('building', 'Starting the build...');
  } else setPhase('idle');
}

stopButton.addEventListener('click', () => {
  window.api.stop();
  stopButton.disabled = true;
  clearTimeout(activityTimer);
  activityTimer = undefined;
  statusText.textContent = 'Stopping...';
});

// Go: estimate, then the confirm card. "Build it" hands over to the main process,
// which opens the folder dialog and starts the build.

const confirmDialog = $<HTMLDialogElement>('confirm-dialog');
const failedDialog = $<HTMLDialogElement>('failed-dialog');
let working = false;

function setWorking(on: boolean): void {
  working = on;
  goButton.disabled = on;
}

async function go(): Promise<void> {
  if (working) return;
  if (!request.value.trim()) {
    showNotice('Type what you want first.');
    request.focus();
    return;
  }
  showNotice('');
  resultBox.hidden = true;
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
  $('confirm-minutes').textContent = `About ${estimate.minutes} minute${estimate.minutes === 1 ? '' : 's'}`;
  $('confirm-stack').textContent = estimate.stack;
  $('confirm-stack').hidden = !estimate.stack;
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
    request.focus();
    return;
  }
  setWorking(true);
  try {
    const res = await window.api.confirm();
    if (res.status === 'error') showNotice(res.error);
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

// Enter submits; Shift+Enter is a new line.
request.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    form.requestSubmit();
  }
});

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
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min${s % 60 ? ` ${s % 60} s` : ''}`;
}

function when(iso: string): string {
  const d = new Date(iso);
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const days = Math.round((new Date().setHours(0, 0, 0, 0) - new Date(iso).setHours(0, 0, 0, 0)) / 86_400_000);
  if (days === 0) return `Today ${time}`;
  if (days === 1) return `Yesterday ${time}`;
  return `${d.toLocaleDateString([], { day: 'numeric', month: 'short', year: days > 300 ? 'numeric' : undefined })} ${time}`;
}

function showResult(entry: HistoryEntry): void {
  shownEntry = entry;
  $('result-title').textContent = RESULT_TITLES[entry.result] ?? entry.result;
  resultBox.dataset.result = entry.result.replace(' ', '-');
  $('result-meta').textContent = `${when(entry.startedAt)} · took ${took(entry.durationMs)} · estimate ${entry.estimateMinutes} min`;
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
  showNotice('');
  resultBox.hidden = false;
}

function showHistory(entries: HistoryEntry[]): void {
  $('history-empty').hidden = entries.length > 0;
  historyList.replaceChildren(
    ...entries.map((entry) => {
      const el = (tag: string, className: string, text: string) => {
        const e = document.createElement(tag);
        e.className = className;
        e.textContent = text;
        return e;
      };
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'history-item';
      button.title = entry.folder;
      button.append(
        el('span', 'history-request', entry.request),
        el('span', 'history-meta', `${when(entry.startedAt)} · ${took(entry.durationMs)}`),
      );
      button.addEventListener('click', () => {
        showResult(entry);
        historyDrawer.close();
      });
      const head = document.createElement('div');
      head.className = 'history-side';
      head.append(el('span', `badge ${entry.result.replace(' ', '-')}`, RESULT_TITLES[entry.result] ?? entry.result));
      if (entry.logFile) {
        const log = el('button', 'link small', 'Open full log') as HTMLButtonElement;
        log.type = 'button';
        log.addEventListener('click', () => window.api.openLog(entry.id));
        head.append(log);
      }
      const item = document.createElement('li');
      item.append(button, head);
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
  request.value = '';
  request.focus();
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
    setPhase('building', 'Starting the build...');
  } else {
    buildClock = null;
    setPhase('idle');
    showResult(event.entry);
    refreshHistory();
  }
});

window.api.allowedCommands().then((commands) => {
  const words = commands.length < 2 ? commands.join('') : `${commands.slice(0, -1).join(', ')} and ${commands.at(-1)}`;
  document.querySelectorAll('.allowed-commands').forEach((el) => {
    el.textContent = words;
  });
});

// The log itself goes to a file; only errors outside a run are worth a line here
// (during a run they show up in the result).
window.api.onLog((entry) => {
  if (entry.kind === 'error' && phase === 'idle' && !working) showNotice(entry.text);
});
window.api.onStatus(onStatus);
window.api.onActivity(showActivity);

window.api.getSettings().then((s) => {
  showSettings(s);
  if (!s.claudePath) {
    savedEl.textContent = 'Could not find the claude CLI. Set its path above.';
    settingsDialog.showModal();
  }
});
