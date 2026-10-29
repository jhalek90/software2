// Renderer: the text box, the log and the settings panel. A plain script (no imports);
// everything it can do goes through window.api from the preload.

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const form = $<HTMLFormElement>('request-form');
const request = $<HTMLTextAreaElement>('request');
const statusEl = $<HTMLParagraphElement>('status');
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

form.addEventListener('submit', (e) => {
  e.preventDefault();
  window.api.go(request.value);
});

// Ctrl+Enter submits from the text box.
request.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.ctrlKey) form.requestSubmit();
});

$<HTMLButtonElement>('stop').addEventListener('click', () => window.api.stop());
$<HTMLButtonElement>('clear-log').addEventListener('click', () => logEl.replaceChildren());

window.api.onLog(appendLog);
window.api.onStatus((s) => {
  statusEl.textContent = s;
});

window.api.getSettings().then((s) => {
  showSettings(s);
  if (!s.claudePath) {
    settingsPanel.hidden = false;
    settingsToggle.setAttribute('aria-expanded', 'true');
    savedEl.textContent = 'Could not find the claude CLI. Set its path above.';
  }
});
