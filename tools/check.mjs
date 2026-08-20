#!/usr/bin/env node
/**
 * check.mjs — enforce the properties that make dist/lorelens.js safe to paste
 * into someone's reader.
 *
 * These are checked rather than trusted because every one of them has a
 * plausible way of being broken by an otherwise reasonable pull request.
 */

import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const failures = [];
const notes = [];

function fail(rule, detail) {
  failures.push(`${rule}\n    ${detail}`);
}

const dist = await readFile(path.join(ROOT, 'dist', 'lorelens.js'), 'utf8');
const srcNames = (await readdir(path.join(ROOT, 'src'))).filter((n) => n.endsWith('.js')).sort();
const sources = await Promise.all(
  srcNames.map(async (name) => ({
    name,
    text: await readFile(path.join(ROOT, 'src', name), 'utf8'),
  })),
);

/* ---- 1. No module system. The file is pasted into a <script>, not imported. */

for (const { name, text } of sources) {
  const stripped = stripCommentsAndStrings(text);
  if (/(^|[\s;{)])import\s*[({'"*]/.test(stripped) || /\bexport\s+(default|const|function|class|\{)/.test(stripped)) {
    fail('ES module syntax in src/', `${name} uses import/export. src/ is concatenated, not bundled.`);
  }
  if (/\brequire\s*\(/.test(stripped)) {
    fail('CommonJS require() in src/', `${name} calls require(). There is no module loader in a WebView.`);
  }
}

/* ---- 2. Exactly one IIFE wrapper, so nothing leaks into the reader's scope. */

if (!/^\s*\/\*/.test(dist) || !dist.includes('(function')) {
  fail('Missing wrapper', 'dist/ must open with the banner comment and a single IIFE.');
}

/* ---- 3. Namespacing. We are a guest in someone else's page. */

// A single "=" only — "window.Foo === 'function'" is a feature test, not an assignment.
const globalAssignments = [...dist.matchAll(/\bwindow\.([A-Za-z_$][\w$]*)\s*=(?![=>])/g)].map((m) => m[1]);
for (const name of new Set(globalAssignments)) {
  if (!/^__?[Ll]ore[Ll]ens/.test(name) && !/^[Ll]ore[Ll]ens/.test(name)) {
    fail('Unnamespaced global', `window.${name} — every global must start with "lorelens" or "LoreLens".`);
  }
}

const cssClasses = new Set([...dist.matchAll(/\.(lorelens[\w-]*)/g)].map((m) => m[1]));
notes.push(`${cssClasses.size} lorelens-* CSS classes`);

const storageKeys = [...dist.matchAll(/localStorage\.(?:get|set|remove)Item\(\s*(['"`])([^'"`]*)/g)];
for (const [, , key] of storageKeys) {
  if (key && !key.startsWith('lorelens')) {
    fail('Unnamespaced storage key', `localStorage key "${key}" must start with "lorelens".`);
  }
}

/* ---- 4. No dependencies, no remote code loading. */

if (/\bimportScripts\s*\(|document\.write\s*\(/.test(dist)) {
  fail('Remote code loading', 'importScripts / document.write are not allowed.');
}
const scriptInjection = /createElement\(\s*['"]script['"]\s*\)/.test(dist);
if (scriptInjection) {
  fail('Script injection', 'The script must never inject another <script>. Users audit this file before pasting it.');
}

/* ---- 5. Network destinations are declared and limited. */

const urls = [...dist.matchAll(/https?:\/\/[^'"`\s)]+/g)].map((m) => m[0]);
const ALLOWED_HOSTS = [
  'fandom.com',
  'wikia.nocookie.net',
  'wikipedia.org',
  'github.com',
  'www.w3.org',
];
for (const url of new Set(urls)) {
  let host;
  try {
    host = new URL(url.replace(/\{[^}]*\}/g, 'x')).hostname;
  } catch {
    continue;
  }
  const isAllowed = ALLOWED_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
  if (!isAllowed) {
    fail('Undeclared network host', `${host} (${url}) — add it to ALLOWED_HOSTS in tools/check.mjs if intentional.`);
  }
}

/* ---- 6. Every fetch is anonymous. No cookies to third-party wikis, ever. */

const fetchCalls = [...dist.matchAll(/\bfetch\s*\(/g)];
const omitCount = (dist.match(/credentials:\s*'omit'/g) || []).length;
if (fetchCalls.length > 0 && omitCount === 0) {
  fail('Credentialed fetch', "fetch() must pass credentials: 'omit' so we never send a user's wiki cookies.");
}
notes.push(`${fetchCalls.length} fetch call sites, ${omitCount} with credentials: 'omit'`);

/* ---- 7. No innerHTML from wiki text without escaping. */

const rawInterpolation = [...dist.matchAll(/innerHTML\s*=\s*[^;]*\$\{(?!esc)/g)];
if (rawInterpolation.length > 0) {
  fail(
    'Unescaped interpolation into innerHTML',
    `${rawInterpolation.length} site(s) interpolate into innerHTML without an esc*() call. Wiki text is untrusted.`,
  );
}

/* ---- 8. Size. It has to be pasteable into a phone text box. */

const kb = Buffer.byteLength(dist, 'utf8') / 1024;
notes.push(`dist is ${kb.toFixed(1)} KB`);
if (kb > 200) {
  fail('Too large', `${kb.toFixed(1)} KB. Keep it under 200 KB — people paste this by hand.`);
}

/* ---- 9. Version is a single source of truth. */

const versions = new Set([...dist.matchAll(/VERSION\s*=\s*'([^']+)'/g)].map((m) => m[1]));
if (versions.size !== 1) {
  fail('Version', `Expected exactly one VERSION constant, found ${versions.size}.`);
} else {
  const pkg = JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf8'));
  const version = [...versions][0];
  if (pkg.version !== version) {
    fail('Version mismatch', `src says ${version}, package.json says ${pkg.version}.`);
  }
  notes.push(`version ${version}`);
}

/* -------------------------------------------------------------- reporting */

/** Crude but adequate: we only need to avoid matching inside comments/strings. */
function stripCommentsAndStrings(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
    .replace(/'[^'\n]*'/g, "''")
    .replace(/"[^"\n]*"/g, '""')
    .replace(/`[^`]*`/g, '``');
}

for (const note of notes) process.stderr.write(`  · ${note}\n`);

if (failures.length > 0) {
  process.stderr.write(`\n${failures.length} constraint(s) violated:\n\n`);
  for (const failure of failures) process.stderr.write(`  ✗ ${failure}\n\n`);
  process.exit(1);
}

process.stderr.write('\nAll source constraints hold.\n');
