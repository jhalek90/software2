// Builds the app, then starts Electron's own exe detached and exits, so no console window
// stays tied to the app and closing a terminal can't close it.
//   npm run launch                       build output goes to the terminal
//   node scripts/launch.mjs --log <file> build output goes to <file> (used by launch.vbs,
//                                        which runs this hidden and shows a message on failure)
// Exit code: 0 started, 1 build failed, 2 Electron missing or could not start.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, openSync, closeSync, writeSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const projectDir = dirname(dirname(fileURLToPath(import.meta.url)));

export function electronExe(dir = projectDir) {
  return join(dir, 'node_modules', 'electron', 'dist', 'electron.exe');
}

// ELECTRON_RUN_AS_NODE (set when started from an Electron-based tool) would run main.js as
// plain Node with no window.
export function electronEnv(env = process.env) {
  const out = { ...env };
  for (const key of Object.keys(out)) {
    if (key.toUpperCase() === 'ELECTRON_RUN_AS_NODE') delete out[key];
  }
  return out;
}

function main(args) {
  const logIndex = args.indexOf('--log');
  const logFile = logIndex >= 0 ? args[logIndex + 1] : undefined;
  const logFd = logFile ? openSync(logFile, 'w') : undefined;
  const say = (text) => {
    if (logFd !== undefined) writeSync(logFd, text + '\r\n');
    else console.log(text);
  };

  say(`software2 launch, ${new Date().toISOString()}, in ${projectDir}`);
  const build = spawnSync('npm run build', {
    cwd: projectDir,
    shell: true,
    windowsHide: true,
    stdio: logFd !== undefined ? ['ignore', logFd, logFd] : 'inherit',
  });
  if (build.status !== 0) {
    say(`Build failed (${build.error ? build.error.message : `exit code ${build.status}`}).`);
    return finish(1);
  }

  const exe = electronExe();
  if (!existsSync(exe)) {
    say(`Electron is missing: ${exe}`);
    say('Run "npm install", or "node node_modules/electron/install.js" if npm skipped its download.');
    return finish(2);
  }
  try {
    const child = spawn(exe, [projectDir], {
      cwd: projectDir,
      env: electronEnv(),
      detached: true,
      stdio: 'ignore',
    });
    child.on('error', (err) => {
      say(`Could not start Electron: ${err.message}`);
      finish(2);
    });
    child.on('spawn', () => {
      say(`Started software2 (Electron pid ${child.pid}).`);
      child.unref();
      finish(0);
    });
  } catch (err) {
    say(`Could not start Electron: ${err.message}`);
    return finish(2);
  }

  function finish(code) {
    if (logFd !== undefined) closeSync(logFd);
    process.exit(code);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main(process.argv.slice(2));
