// Renderer: the "build me" box and its Advanced panel, the live status line, the build result and the Settings sheet. A plain script (no imports); everything it can do goes through
// window.api from the preload. The full log is not shown here: it goes to a file per run.

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const form = $<HTMLFormElement>('request-form');
const request = $<HTMLTextAreaElement>('request');
const goButton = $<HTMLButtonElement>('go');
const noticeEl = $<HTMLParagraphElement>('notice');

const advToggle = $<HTMLButtonElement>('adv-toggle');
const advPanel = $<HTMLDivElement>('advanced');
const advChip = $<HTMLButtonElement>('adv-chip');
const advTime = $<HTMLInputElement>('adv-time');
const advStyle = $<HTMLInputElement>('adv-style');
const advError = $<HTMLParagraphElement>('adv-error');
const fileList = $<HTMLUListElement>('file-list');
const hintEl = $<HTMLSpanElement>('hint');

const settingsDialog = $<HTMLDialogElement>('settings-dialog');
const claudePath = $<HTMLInputElement>('claude-path');
const projectsFolder = $<HTMLInputElement>('projects-folder');
const buildCap = $<HTMLInputElement>('build-cap');
const skipPermissions = $<HTMLInputElement>('skip-permissions');
const savedEl = $<HTMLParagraphElement>('settings-saved');

// The title bar's window buttons (the window is frameless).

$<HTMLButtonElement>('win-min').addEventListener('click', () => window.api.windowControl('minimize'));
$<HTMLButtonElement>('win-max').addEventListener('click', () => window.api.windowControl('maximize'));
$<HTMLButtonElement>('win-close').addEventListener('click', () => window.api.windowControl('close'));
window.api.onWindowState((state) => {
  document.body.classList.toggle('maximized', state.maximized);
  const max = $<HTMLButtonElement>('win-max');
  max.title = state.maximized ? 'Restore' : 'Maximise';
  max.setAttribute('aria-label', max.title);
  backdrop.setMinimized(state.minimized);
});

// The placeholders cycle through a few examples while their boxes are empty: what to
// build after "build me", and a design style in the Advanced panel.

const EXAMPLES = [
  'a to-do list web page',
  'a pomodoro timer',
  'a markdown notes app',
  'a CSV to JSON converter for the command line',
  'a tiny expense tracker',
];
const STYLES = ['dark and minimal', 'playful, pastel colours', 'like a 90s website', 'clean, lots of white space'];
let example = 0;
setInterval(() => {
  if (document.hidden) return;
  const boxes = [request, advStyle].filter((box) => !box.value);
  boxes.forEach((box) => box.classList.add('placeholder-out'));
  setTimeout(() => {
    example++;
    request.placeholder = EXAMPLES[example % EXAMPLES.length];
    advStyle.placeholder = STYLES[example % STYLES.length];
    boxes.forEach((box) => box.classList.remove('placeholder-out'));
  }, 350);
}, 4000);

// Advanced: this run's max run time, a design style and files for the project. The panel
// is hidden whenever the app opens and nothing in it is saved. When anything is set, a
// chip in the box says so, open or closed, so nothing is hidden by surprise.

/** The same limits as RUN_TIME_MIN/MAX and MAX_TOTAL_BYTES in src/main/advanced.ts
 *  (the main process checks again). */
const RUN_TIME = { min: 5, max: 120 };
const MAX_FILES_BYTES = 200 * 1024 * 1024;
let userFiles: UserFile[] = [];

function sizeText(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  const mb = kb / 1024;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** The run time typed in Advanced, kept in range; null when empty (Settings' cap then). */
function runTime(): number | null {
  const n = Number(advTime.value);
  if (!advTime.value.trim() || !Number.isFinite(n) || n <= 0) return null;
  return Math.min(Math.max(Math.round(n), RUN_TIME.min), RUN_TIME.max);
}

function advancedOptions(): AdvancedOptions {
  return { capMinutes: runTime(), style: advStyle.value.trim(), files: userFiles.map((f) => f.path) };
}

function setAdvancedOpen(open: boolean): void {
  const opening = open && advPanel.hidden !== false;
  advPanel.hidden = !open;
  advToggle.setAttribute('aria-expanded', String(open));
  advToggle.classList.toggle('on', open);
  // In a small window the panel can open below the fold: bring it into view once it is in.
  if (opening) setTimeout(() => advPanel.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 300);
}

function showAdvError(text: string): void {
  advError.textContent = text;
  advError.hidden = !text;
}

/** Redraws the file list and the summary chip ("30 min · dark and minimal · 3 files"). */
function renderAdvanced(): void {
  fileList.replaceChildren(
    ...userFiles.map((f, i) => {
      const li = document.createElement('li');
      const name = document.createElement('span');
      name.className = 'file-name';
      name.textContent = f.name;
      name.title = f.path;
      const size = document.createElement('span');
      size.className = 'file-size';
      size.textContent = sizeText(f.size);
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'icon-button file-remove';
      remove.title = `Remove ${f.name}`;
      remove.setAttribute('aria-label', remove.title);
      remove.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17"/></svg>';
      remove.addEventListener('click', () => {
        userFiles.splice(i, 1);
        showAdvError('');
        renderAdvanced();
      });
      li.append(name, size, remove);
      return li;
    }),
  );
  if (userFiles.length > 1) {
    const total = document.createElement('li');
    total.className = 'file-total';
    total.textContent = `${plural(userFiles.length, 'file')}, ${sizeText(userFiles.reduce((s, f) => s + f.size, 0))} of 200 MB`;
    fileList.append(total);
  }

  const time = runTime();
  const style = advStyle.value.trim();
  const parts = [
    ...(time ? [`${time} min`] : []),
    ...(style ? [style.length > 32 ? `${style.slice(0, 30)}...` : style] : []),
    ...(userFiles.length ? [plural(userFiles.length, 'file')] : []),
  ];
  advChip.textContent = parts.join(' · ');
  advChip.hidden = parts.length === 0;
  hintEl.hidden = parts.length > 0;
  advToggle.classList.toggle('set', parts.length > 0);
}

/** Adds files the main process has looked at: no doubles, folders refused, and the total
 *  kept under the size cap (the ones that would go over are left out, with a message). */
function addFiles(found: InspectedFiles): void {
  const messages = [...found.refused];
  const have = new Set(userFiles.map((f) => f.path.toLowerCase()));
  let total = userFiles.reduce((s, f) => s + f.size, 0);
  const tooBig: string[] = [];
  for (const f of found.files) {
    if (have.has(f.path.toLowerCase())) continue;
    if (total + f.size > MAX_FILES_BYTES) {
      tooBig.push(f.name);
      continue;
    }
    have.add(f.path.toLowerCase());
    total += f.size;
    userFiles.push(f);
  }
  if (tooBig.length) {
    messages.push(`Left out ${tooBig.map((n) => `"${n}"`).join(', ')}: the files can add up to 200 MB at most.`);
  }
  showAdvError(messages.join(' '));
  if (messages.length || found.files.length) setAdvancedOpen(true);
  renderAdvanced();
}

/** Clears the panel (for "Build something else"). */
function resetAdvanced(): void {
  advTime.value = '';
  advStyle.value = '';
  userFiles = [];
  showAdvError('');
  setAdvancedOpen(false);
  renderAdvanced();
}

advToggle.addEventListener('click', () => setAdvancedOpen(advPanel.hidden !== false));
advChip.addEventListener('click', () => {
  setAdvancedOpen(true);
  advTime.focus();
});
advStyle.addEventListener('input', renderAdvanced);
advTime.addEventListener('input', renderAdvanced);
// Out of range when leaving the box: show the value that will be used.
advTime.addEventListener('change', () => {
  const t = runTime();
  advTime.value = t === null ? '' : String(t);
  renderAdvanced();
});
$<HTMLButtonElement>('add-files').addEventListener('click', async () => addFiles(await window.api.pickFiles()));

// Files can be dropped anywhere on the window (the panel opens to show them). Without
// this, Chromium would open a dropped file in the window instead.
const dropzone = $<HTMLDivElement>('dropzone');
let dragDepth = 0;
const hasFiles = (e: DragEvent) => !!e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files');
document.addEventListener('dragenter', (e) => {
  if (!hasFiles(e)) return;
  dragDepth++;
  document.body.classList.add('dragging');
});
document.addEventListener('dragleave', (e) => {
  if (!hasFiles(e)) return;
  if (--dragDepth <= 0) {
    dragDepth = 0;
    document.body.classList.remove('dragging');
  }
});
document.addEventListener('dragover', (e) => {
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = hasFiles(e) && !working ? 'copy' : 'none';
  dropzone.classList.toggle('over', e.target instanceof Node && dropzone.contains(e.target));
});
document.addEventListener('drop', async (e) => {
  e.preventDefault();
  dragDepth = 0;
  document.body.classList.remove('dragging');
  dropzone.classList.remove('over');
  if (working || !e.dataTransfer?.files.length) return;
  const dropped = Array.from(e.dataTransfer.files);
  const paths = dropped.map((f) => window.api.pathForFile(f)).filter(Boolean);
  const found = await window.api.inspectFiles(paths);
  if (paths.length < dropped.length) found.refused.unshift('Some of what was dropped is not a file on this PC.');
  addFiles(found);
});

/** A short message under the text box, for things that went wrong outside a run. */
function showNotice(text: string): void {
  noticeEl.textContent = text;
  noticeEl.hidden = !text;
}

// Settings (behind the gear).

function showSettings(s: Settings): void {
  claudePath.value = s.claudePath;
  projectsFolder.value = s.projectsFolder;
  buildCap.value = String(s.buildCapMinutes);
  advTime.placeholder = String(s.buildCapMinutes);
  advTime.title = `Empty: ${s.buildCapMinutes} min, the build time cap in Settings. ${RUN_TIME.min} to ${RUN_TIME.max} min.`;
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
// The close button, and a click on the dimmed backdrop, close the sheet.
settingsDialog.querySelector('[data-close]')?.addEventListener('click', () => settingsDialog.close());
settingsDialog.addEventListener('click', (e) => {
  if (e.target === settingsDialog) {
    const r = settingsDialog.getBoundingClientRect();
    const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    if (!inside) settingsDialog.close();
  }
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
    backdrop.setProgress(ms / estimateMs);
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
  // Idle keeps a result's or a dialog's look ("Ready" comes after the build's result).
  if (next !== 'idle') backdrop.setScene(next === 'folder' ? 'confirm' : next);
  else if (resultBox.hidden && !confirmDialog.open && !failedDialog.open) backdrop.setScene('idle');
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
  else if (status === 'Copying your files') setPhase('folder', 'Copying your files into assets/...');
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
    outcome = await window.api.estimate(request.value, advancedOptions());
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
  const time = runTime();
  $('confirm-cap').textContent = time
    ? `The build is stopped after ${time} minutes (max run time for this build, set in Advanced).`
    : `The build is stopped after ${s.buildCapMinutes} minutes (build time cap in Settings).`;
  const style = advStyle.value.trim();
  $('confirm-style').textContent = `Style: ${style}`;
  $('confirm-style').hidden = !style;
  $('confirm-files').textContent = `${plural(userFiles.length, 'file')} for assets/`;
  $('confirm-files').title = userFiles.map((f) => f.name).join(', ');
  $('confirm-files').hidden = userFiles.length === 0;
  $('confirm-warning').hidden = !s.skipPermissions;
  $('confirm-limited').hidden = s.skipPermissions;
  confirmDialog.returnValue = '';
  backdrop.setScene('confirm');
  confirmDialog.showModal();
}

// Closing the dialog any other way (Esc) counts as Cancel.
confirmDialog.addEventListener('close', async () => {
  if (confirmDialog.returnValue !== 'build') {
    backdrop.setScene('idle');
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
  backdrop.setScene('failed');
  failedDialog.showModal();
}

failedDialog.addEventListener('close', () => {
  backdrop.setScene('idle');
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

// The build: its result when it ends.

const resultBox = $<HTMLElement>('result');
const RESULT_TITLES: Record<BuildOutcome['result'], string> = {
  done: 'Done',
  stopped: 'Stopped',
  failed: 'Failed',
  'timed out': 'Timed out',
};

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

function showResult(entry: BuildOutcome): void {
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
  $('open-log').hidden = !entry.logFile;
  showNotice('');
  resultBox.hidden = false;
  backdrop.setScene(entry.result === 'done' ? 'done' : entry.result === 'stopped' ? 'stopped' : 'failed');
}

$<HTMLButtonElement>('result-close').addEventListener('click', () => {
  resultBox.hidden = true;
  backdrop.setScene('idle');
  request.value = '';
  resetAdvanced();
  request.focus();
});
$<HTMLButtonElement>('open-folder').addEventListener('click', () => window.api.openFolder());
$<HTMLButtonElement>('open-readme').addEventListener('click', () => window.api.openReadme());
$<HTMLButtonElement>('open-log').addEventListener('click', () => window.api.openLog());

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
    showResult(event.outcome);
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
