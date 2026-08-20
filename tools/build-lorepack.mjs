#!/usr/bin/env node
/**
 * build-lorepack.mjs — turn a Fandom wiki into a LoreLens glossary file.
 *
 * You almost certainly do not need this.
 *
 * LoreLens fetches from the wiki live and caches what it finds, so the normal
 * path needs no preparation at all. This exists for the cases live lookup
 * cannot serve well:
 *
 *   · a novel whose wiki is thin, where you want to hand-write better entries
 *   · a fan translation using names the wiki does not use
 *   · a translation group publishing a spoiler-safe glossary for readers
 *   · reading somewhere with no usable connection
 *
 * Usage:
 *   node tools/build-lorepack.mjs --wiki shadowslave --out shadowslave.json
 *   node tools/build-lorepack.mjs --wiki shadowslave --categories "Characters,Locations" --limit 40
 *
 * Then host the JSON anywhere that serves it over https — a GitHub Gist raw
 * URL works — and paste that URL into LoreLens settings under
 * "Custom glossary".
 *
 * The output is plain JSON and is meant to be edited by hand afterwards. That
 * is the point: the generator gets you 90% of the way and you fix the rest.
 *
 * Node 18+. No dependencies.
 */

import { writeFile } from 'node:fs/promises';

const POLITE_DELAY_MS = 150;
const TITLES_PER_REQUEST = 20;

/* ------------------------------------------------------------------- args */

function parseArguments(argv) {
  const options = {
    wiki: '',
    categories: ['Characters'],
    out: '',
    limit: 0,
    minSentences: 2,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === '--wiki') options.wiki = String(value || '').replace(/^https?:\/\//, '').replace(/\.fandom\.com.*$/, '');
    else if (flag === '--categories') options.categories = String(value || '').split(',').map((s) => s.trim()).filter(Boolean);
    else if (flag === '--out') options.out = value;
    else if (flag === '--limit') options.limit = Number(value) || 0;
    else if (flag === '--help' || flag === '-h') options.help = true;
  }

  if (options.help || !options.wiki) {
    process.stderr.write(
      'Usage: node tools/build-lorepack.mjs --wiki <subdomain> [--categories "A,B"] [--limit N] [--out file.json]\n\n' +
        '  --wiki        the part before .fandom.com, e.g. "shadowslave"\n' +
        '  --categories  wiki categories to walk (default: Characters)\n' +
        '  --limit       stop after N articles, useful for a trial run\n' +
        '  --out         output path (default: <wiki>.lorepack.json)\n',
    );
    process.exit(options.help ? 0 : 1);
  }

  if (!options.out) options.out = `${options.wiki}.lorepack.json`;
  return options;
}

/* -------------------------------------------------------------- api layer */

class Fandom {
  constructor(subdomain) {
    this.subdomain = subdomain;
    this.endpoint = `https://${subdomain}.fandom.com/api.php`;
  }

  async request(params) {
    const query = new URLSearchParams({ format: 'json', formatversion: '2', ...params });
    const response = await fetch(`${this.endpoint}?${query}`, {
      headers: {
        // Identifying the tool is the polite thing to do and is what the
        // MediaWiki API etiquette guidelines ask for.
        'user-agent': 'LoreLens-lorepack-builder/2.0 (https://github.com/OWNER/LoreLens)',
      },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} on ${params.action}`);
    return response.json();
  }

  async listCategory(category) {
    const titles = [];
    let cursor = null;

    do {
      const payload = await this.request({
        action: 'query',
        list: 'categorymembers',
        cmtitle: `Category:${category}`,
        cmlimit: '500',
        cmnamespace: '0',
        ...(cursor ? { cmcontinue: cursor } : {}),
      });
      for (const member of payload?.query?.categorymembers ?? []) titles.push(member.title);
      cursor = payload?.continue?.cmcontinue ?? null;
      await delay(POLITE_DELAY_MS);
    } while (cursor);

    return titles;
  }

  async fetchSummaries(titles) {
    const payload = await this.request({
      action: 'query',
      prop: 'extracts|pageimages|info',
      inprop: 'url',
      exintro: '1',
      explaintext: '1',
      exsentences: '10',
      piprop: 'thumbnail',
      pithumbsize: '480',
      redirects: '1',
      titles: titles.join('|'),
    });
    return payload?.query?.pages ?? [];
  }

  async fetchRendered(title) {
    try {
      const payload = await this.request({ action: 'parse', page: title, prop: 'text', redirects: '1' });
      const text = payload?.parse?.text;
      return typeof text === 'string' ? text : (text?.['*'] ?? '');
    } catch {
      return '';
    }
  }
}

/* ---------------------------------------------------------------- parsing */

/*
 * These mirror the tables in src/10-constants.js. They are duplicated rather
 * than shared because this script runs in Node and that file is written for a
 * WebView with no module system — and because a glossary generated today
 * should not change its meaning when the reader script is updated later.
 */
const FIELD_ALIASES = {
  status: ['status', 'state', 'standing', 'condition', 'vital status'],
  race: ['race', 'species', 'kind', 'bloodline'],
  gender: ['gender', 'sex'],
  affiliation: ['affiliation', 'affiliations', 'organization', 'organisation', 'faction', 'sect', 'clan', 'family', 'guild', 'occupation'],
  rank: ['rank', 'title', 'titles', 'cultivation', 'cultivation level', 'realm', 'class', 'grade', 'tier', 'stage'],
  alias: ['alias', 'aliases', 'other names', 'also known as', 'aka', 'nickname', 'nicknames', 'epithet', 'known as', 'true name', 'real name'],
  native: ['chinese', 'korean', 'japanese', 'kanji', 'hanzi', 'hangul', 'native name', 'original name'],
  romanized: ['pinyin', 'romaji', 'romanized', 'romanised', 'romanization'],
  firstSeen: ['first appearance', 'debut', 'first seen', 'introduced'],
};

const FATE_WORDS = /\b(dead|deceased|died|killed|alive|living|active|inactive|imprisoned|sealed|revived|resurrected)\b/i;

function decodeEntities(text) {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function stripHtml(html) {
  return decodeEntities(
    String(html)
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<sup[\s\S]*?<\/sup>/gi, ' ')
      .replace(/<br\s*\/?>/gi, ' · ')
      .replace(/<\/li>/gi, ' · ')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/\[\d+\]/g, '')
    .replace(/\s*·\s*/g, ' · ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s·]+|[\s·]+$/g, '')
    .trim();
}

/** Label/value pairs from a Fandom portable infobox. */
function parseInfobox(html) {
  const fields = {};
  const pattern =
    /<h3[^>]*class="[^"]*pi-data-label[^"]*"[^>]*>([\s\S]*?)<\/h3>[\s\S]{0,200}?<div[^>]*class="[^"]*pi-data-value[^"]*"[^>]*>([\s\S]*?)<\/div>/gi;

  let match = pattern.exec(html);
  while (match !== null) {
    const label = stripHtml(match[1]);
    const value = stripHtml(match[2]);
    if (label && value) fields[label] = value.slice(0, 240);
    match = pattern.exec(html);
  }
  return fields;
}

function classify(label) {
  const key = label.toLowerCase().replace(/[:：]\s*$/, '').trim();
  for (const [meaning, aliases] of Object.entries(FIELD_ALIASES)) {
    if (aliases.includes(key)) return meaning;
  }
  for (const [meaning, aliases] of Object.entries(FIELD_ALIASES)) {
    if (aliases.some((alias) => alias.length >= 5 && key.includes(alias))) return meaning;
  }
  return null;
}

function splitValues(value) {
  return String(value)
    .split(/\s+·\s+|[,;]|\s+\/\s+/)
    .map((part) => part.replace(/\([^)]*\)/g, '').trim())
    .filter(Boolean);
}

function buildTags(byMeaning) {
  const tags = [];
  const add = (meaning, tone, kind) => {
    const value = byMeaning[meaning];
    if (!value) return;
    for (const part of splitValues(value).slice(0, 2)) {
      if (part.length > 28) continue;
      tags.push({
        label: part,
        tone: typeof tone === 'function' ? tone(part) : tone,
        kind,
        ...(kind === 'fate' && FATE_WORDS.test(part) ? { isFateReveal: true } : {}),
      });
    }
  };

  add('status', (v) => (/\b(alive|living|active)\b/i.test(v) ? 'good' : /\b(dead|deceased|died|killed)\b/i.test(v) ? 'bad' : 'neutral'), 'fate');
  add('race', 'neutral', 'plain');
  add('rank', 'accent', 'progress');
  add('affiliation', 'accent', 'plain');
  return tags.slice(0, 6);
}

function buildAliases(byMeaning, canonical) {
  if (!byMeaning.alias) return [];
  const seen = new Set();
  return splitValues(byMeaning.alias)
    .map((alias) => alias.replace(/["“”]/g, '').trim())
    .filter((alias) => {
      const key = alias.toLowerCase();
      if (alias.length < 4 || alias.length > 40) return false;
      if (key === canonical.toLowerCase()) return false;
      if (seen.has(key)) return false;
      seen.add(key);
      return /^[\p{L}][\p{L}\p{N}\s'.-]*$/u.test(alias);
    })
    .slice(0, 8);
}

function splitSentences(text) {
  const parts = String(text).replace(/\s+/g, ' ').trim().match(/[^.!?]+[.!?]+["'”’)]*\s*|[^.!?]+$/g);
  return (parts ?? []).map((part) => part.trim()).filter(Boolean);
}

function buildSections(extract, minSentences) {
  const sentences = splitSentences(extract);
  if (sentences.length === 0) return [];

  const introCount = Math.min(minSentences, sentences.length);
  const sections = [{ title: 'Who this is', body: sentences.slice(0, introCount).join(' '), alwaysSafe: true }];
  if (sentences.length > introCount) {
    sections.push({ title: 'More', body: sentences.slice(introCount).join(' '), alwaysSafe: false });
  }
  return sections;
}

function parseChapterNumber(text) {
  const match = String(text).match(/(?:chapter|chap\.?|ch\.?|episode)\s*#?\s*(\d{1,5})/i);
  return match ? Number(match[1]) : 0;
}

function scaleImage(url, width) {
  if (!url || !url.includes('wikia.nocookie.net')) return url ?? '';
  return `${url.split('/revision/')[0].split('?')[0]}/revision/latest/scale-to-width-down/${width}`;
}

/* ------------------------------------------------------------------ build */

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function chunk(items, size) {
  const out = [];
  for (let index = 0; index < items.length; index += size) out.push(items.slice(index, index + size));
  return out;
}

async function build(options) {
  const api = new Fandom(options.wiki);
  const titles = new Set();

  for (const category of options.categories) {
    process.stderr.write(`Listing Category:${category} … `);
    try {
      const found = await api.listCategory(category);
      found.forEach((title) => titles.add(title));
      process.stderr.write(`${found.length} pages\n`);
    } catch (error) {
      process.stderr.write(`failed (${error.message})\n`);
    }
  }

  let all = [...titles];
  if (options.limit > 0) all = all.slice(0, options.limit);

  if (all.length === 0) {
    process.stderr.write('\nNo articles found. Check the wiki name and category names.\n');
    process.exit(1);
  }

  process.stderr.write(`\nFetching ${all.length} articles…\n`);
  const entities = [];

  for (const batch of chunk(all, TITLES_PER_REQUEST)) {
    let pages = [];
    try {
      pages = await api.fetchSummaries(batch);
    } catch (error) {
      process.stderr.write(`  batch failed: ${error.message}\n`);
      continue;
    }

    for (const page of pages) {
      if (page.missing || !page.extract) continue;

      const rendered = await api.fetchRendered(page.title);
      await delay(POLITE_DELAY_MS);

      const raw = parseInfobox(rendered);
      const byMeaning = {};
      for (const [label, value] of Object.entries(raw)) {
        const meaning = classify(label);
        if (meaning && !byMeaning[meaning]) byMeaning[meaning] = value;
      }

      entities.push({
        name: page.title,
        aliases: buildAliases(byMeaning, page.title),
        native: byMeaning.native ?? '',
        romanized: byMeaning.romanized ?? '',
        image: scaleImage(page.thumbnail?.source, 480),
        url: page.fullurl ?? '',
        tags: buildTags(byMeaning),
        sections: buildSections(page.extract, options.minSentences),
        firstSeen: parseChapterNumber(byMeaning.firstSeen ?? ''),
      });
    }

    process.stderr.write(`  ${entities.length}/${all.length}\n`);
    await delay(POLITE_DELAY_MS);
  }

  return {
    schemaVersion: 2,
    source: `${options.wiki}.fandom.com`,
    generatedAt: new Date().toISOString(),
    entities,
  };
}

const options = parseArguments(process.argv.slice(2));
const pack = await build(options);
await writeFile(options.out, `${JSON.stringify(pack, null, 2)}\n`, 'utf8');

process.stderr.write(
  `\nWrote ${pack.entities.length} entries to ${options.out}\n\n` +
    'Next: read through it and fix what the wiki got wrong — that is the part\n' +
    'a script cannot do. Then host it over https and paste the URL into\n' +
    'LoreLens settings under "Custom glossary".\n',
);
