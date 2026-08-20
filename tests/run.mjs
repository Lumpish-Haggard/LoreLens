#!/usr/bin/env node
/**
 * run.mjs — run tests/harness.html in headless Chrome and report the result.
 *
 * The suite runs in a real Chromium rather than a simulated DOM because the
 * target is an Android WebView, and the things most likely to break there —
 * the CSS Custom Highlight API, caretRangeFromPoint, computed-style colour
 * reading, Range behaviour — either do not exist or do not behave the same way
 * under a DOM simulation. A green run against a fake DOM would tell us very
 * little about the thing people actually paste into their reader.
 *
 * No dependencies: it drives the browser that is already on the machine.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HARNESS = path.join(ROOT, 'tests', 'harness.html');

/** Everywhere a Chromium might be, across the platforms contributors use. */
function findBrowser() {
  if (process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH)) {
    return process.env.CHROME_PATH;
  }

  const candidates = {
    win32: [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
    ],
    darwin: [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    ],
    linux: [
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/snap/bin/chromium',
      '/usr/bin/microsoft-edge',
    ],
  };

  for (const candidate of candidates[process.platform] || []) {
    if (candidate && existsSync(candidate)) return candidate;
  }
  return null;
}

const browser = findBrowser();
if (!browser) {
  process.stderr.write(
    'No Chrome, Chromium or Edge found.\n' +
      'Install one, or set CHROME_PATH to its executable.\n' +
      'You can also just open tests/harness.html in any browser and read the result at the bottom.\n',
  );
  process.exit(1);
}

if (!existsSync(path.join(ROOT, 'dist', 'lorelens.js'))) {
  process.stderr.write('dist/lorelens.js is missing. Run: node tools/build.mjs\n');
  process.exit(1);
}

const profileDir = mkdtempSync(path.join(tmpdir(), 'lorelens-test-'));

process.stderr.write(`Running suite in ${path.basename(browser)}…\n`);

const result = spawnSync(
  browser,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--allow-file-access-from-files',
    '--virtual-time-budget=8000',
    `--user-data-dir=${profileDir}`,
    '--dump-dom',
    pathToFileURL(HARNESS).href,
  ],
  { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 90000 },
);

try {
  rmSync(profileDir, { recursive: true, force: true });
} catch {
  /* a locked profile directory is not worth failing a test run over */
}

const dom = result.stdout || '';

if (!dom) {
  process.stderr.write('The browser produced no output.\n');
  if (result.error) process.stderr.write(String(result.error.message) + '\n');
  if (result.stderr) process.stderr.write(result.stderr.slice(0, 2000) + '\n');
  process.exit(1);
}

/* Pull the readable test log back out of the dumped DOM. */
function extract(tagPattern) {
  const match = dom.match(tagPattern);
  if (!match) return '';
  return match[1]
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

const log = extract(/<pre id="out"[^>]*>([\s\S]*?)<\/pre>/);
const summary = extract(/<div class="summary[^"]*" id="summary"[^>]*>([\s\S]*?)<\/div>/);

process.stdout.write(log.trim() + '\n\n');
process.stdout.write(summary.trim() + '\n');

const match = summary.match(/RESULT\s+(\d+)\s+passed,\s+(\d+)\s+failed/);
if (!match) {
  process.stderr.write('\nCould not find a result line — the suite did not finish.\n');
  process.stderr.write('Open tests/harness.html in a browser to see what happened.\n');
  process.exit(1);
}

process.exit(Number(match[2]) === 0 ? 0 : 1);
