#!/usr/bin/env node
/**
 * build.mjs — concatenate src/*.js into dist/lorelens.js.
 *
 * That is the whole build. No transpiling, no minifying, no bundler, no
 * dependencies. The output is pasted by hand into a text box in a phone app,
 * and someone doing that deserves to be able to read what they are pasting and
 * match it line-for-line against this repository.
 *
 *   node tools/build.mjs [--check]
 *
 * --check exits non-zero if dist/ is out of date instead of writing it.
 */

import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC_DIR = path.join(ROOT, 'src');
const OUT_FILE = path.join(ROOT, 'dist', 'lorelens.js');

/** Files concatenate in filename order, which is why they are numbered. */
async function readSourceModules() {
  const names = (await readdir(SRC_DIR))
    .filter((name) => name.endsWith('.js'))
    .sort();

  if (names.length === 0) throw new Error('src/ contains no .js files');

  const duplicatePrefixes = findDuplicatePrefixes(names);
  if (duplicatePrefixes.length > 0) {
    throw new Error(
      `Two source files share a numeric prefix, so their order is not stable: ${duplicatePrefixes.join(', ')}`,
    );
  }

  return Promise.all(
    names.map(async (name) => ({
      name,
      text: await readFile(path.join(SRC_DIR, name), 'utf8'),
    })),
  );
}

function findDuplicatePrefixes(names) {
  const seen = new Map();
  const duplicates = [];
  for (const name of names) {
    const prefix = name.slice(0, 2);
    if (!/^\d\d$/.test(prefix)) continue;
    if (seen.has(prefix)) duplicates.push(`${seen.get(prefix)} + ${name}`);
    else seen.set(prefix, name);
  }
  return duplicates;
}

function concatenate(modules) {
  return modules
    .map((module) => {
      const body = module.text.replace(/\s*$/, '');
      // A per-module marker so a stack trace or a bug report that quotes a line
      // of dist/ can be traced back to the file it came from.
      return `/* ── src/${module.name} ${'─'.repeat(Math.max(0, 62 - module.name.length))} */\n${body}\n`;
    })
    .join('\n');
}

const modules = await readSourceModules();
const output = concatenate(modules);

const isCheckOnly = process.argv.includes('--check');
let previous = null;
try {
  previous = await readFile(OUT_FILE, 'utf8');
} catch {
  /* first build */
}

if (isCheckOnly) {
  if (previous !== output) {
    process.stderr.write('dist/lorelens.js is out of date. Run: npm run build\n');
    process.exit(1);
  }
  process.stderr.write('dist/lorelens.js is up to date.\n');
  process.exit(0);
}

await mkdir(path.dirname(OUT_FILE), { recursive: true });
await writeFile(OUT_FILE, output, 'utf8');

const lines = output.split('\n').length;
const kilobytes = (Buffer.byteLength(output, 'utf8') / 1024).toFixed(1);
process.stderr.write(
  `Built dist/lorelens.js from ${modules.length} modules — ${lines} lines, ${kilobytes} KB\n`,
);
if (previous === output) process.stderr.write('(unchanged)\n');
