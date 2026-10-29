// npm run shortcut: puts a "software(2);" shortcut on the Desktop that opens the app through
// scripts\launch.vbs (no terminal), with the app icon, starting in this project folder.
// Saving a shortcut of the same name overwrites it, so running this again never duplicates it.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { projectDir } from './launch.mjs';

const shortcutName = 'software(2);.lnk';

const launcher = join(projectDir, 'scripts', 'launch.vbs');
const icon = join(projectDir, 'assets', 'icon.ico');
for (const file of [launcher, icon]) {
  if (!existsSync(file)) {
    console.error(`Missing ${file}`);
    process.exit(1);
  }
}

// The paths travel as environment variables, so no quoting can break the script.
// GetFolderPath('Desktop') follows a Desktop that OneDrive or the user has moved.
const script = `
$ErrorActionPreference = 'Stop'
$path = Join-Path ([Environment]::GetFolderPath('Desktop')) $env:S2_NAME
$wscript = Join-Path ([Environment]::SystemDirectory) 'wscript.exe'
$link = (New-Object -ComObject WScript.Shell).CreateShortcut($path)
$link.TargetPath = $wscript
$link.Arguments = '"' + $env:S2_LAUNCHER + '"'
$link.WorkingDirectory = $env:S2_DIR
$link.IconLocation = $env:S2_ICON + ',0'
$link.Description = 'software(2); - type the software you want, Claude Code builds it'
$link.Save()
Write-Output $path
`;

// -EncodedCommand (UTF-16LE base64) sidesteps Windows PowerShell's argument quoting.
const encoded = Buffer.from(script, 'utf16le').toString('base64');
const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
  encoding: 'utf8',
  windowsHide: true,
  env: { ...process.env, S2_NAME: shortcutName, S2_LAUNCHER: launcher, S2_DIR: projectDir, S2_ICON: icon },
});
if (result.status !== 0) {
  console.error('Could not create the shortcut.');
  console.error((result.stderr || result.error?.message || '').trim());
  process.exit(1);
}
console.log(`Shortcut saved: ${result.stdout.trim()}`);
console.log(`It opens ${launcher} and starts in ${projectDir}.`);
