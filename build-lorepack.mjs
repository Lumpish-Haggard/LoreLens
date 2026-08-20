#!/usr/bin/env node
/* =============================================================================
 * build-lorepack.mjs — turn a Fandom wiki into an offline LoreLens lorepack.
 *
 *   node build-lorepack.mjs --wiki imabadguy \
 *     --categories "Characters,Locations,Terminology" \
 *        --out fated-villain.lorepack.json
 *
 * Run it once, host the JSON anywhere raw (GitHub raw, gist, your own S3), or
 * paste it into INLINE_LOREPACK for a fully offline reader.
 * ========================================================================== */

import { writeFile } from 'node:fs/promises';

const API_DELAY_MS = 120;
const BATCH_SIZE = 20;

/* ------------------------------------------------------------------- args */

function parseArguments(argv) {
  const options = {
    wiki: '',
    categories: ['Characters'],
    out: 'lorepack.json',
    limit: 0,
    minAliasLength: 4,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === '--wiki') options.wiki = value;
    if (flag === '--categories') options.categories = value.split(',').map((item) => item.trim());
    if (flag === '--out') options.out = value;
    if (flag === '--limit') options.limit = Number(value) || 0;
  }

  if (!options.wiki) {
    console.error('Missing --wiki. Example: --wiki imabadguy');
    process.exit(1);
  }
  return options;
}

/* -------------------------------------------------------------- api layer */

class FandomApi {
  constructor(wikiSubdomain) {
    this.endpoint = `https://${wikiSubdomain}.fandom.com/api.php`;
    this.wikiSubdomain = wikiSubdomain;
  }

  async request(parameters) {
    const query = new URLSearchParams({ format: 'json', ...parameters });
    const response = await fetch(`${this.endpoint}?${query}`, {
      headers: { 'user-agent': 'LoreLens-lorepack-builder/1.0' },
    });
    if (!response.ok) throw new Error(`${response.status} on ${parameters.action}`);
    return response.json();
  }

  async listCategoryMembers(categoryName) {
    const titles = [];
    let continuation = null;

    do {
      const payload = await this.request({
        action: 'query',
        list: 'categorymembers',
        cmtitle: `Category:${categoryName}`,
        cmlimit: '500',
        cmnamespace: '0',
        ...(continuation ? { cmcontinue: continuation } : {}),
      });
      (payload?.query?.categorymembers ?? []).forEach((member) => titles.push(member.title));
      continuation = payload?.continue?.cmcontinue ?? null;
      await delay(API_DELAY_MS);
    } while (continuation);

    return titles;
  }

  async fetchSummaries(titles) {
    const payload = await this.request({
      action: 'query',
      prop: 'extracts|pageimages',
      exintro: '1',
      explaintext: '1',
      exsentences: '8',
      piprop: 'thumbnail',
      pithumbsize: '640',
      redirects: '1',
      titles: titles.join('|'),
    });
    return Object.values(payload?.query?.pages ?? {});
  }

  async fetchInfobox(title) {
    try {
      const payload = await this.request({
        action: 'parse',
        page: title,
        prop: 'text',
        redirects: '1',
      });
      return extractInfoboxFields(payload?.parse?.text?.['*'] ?? '');
    } catch (error) {
      return {};
    }
  }

  buildArticleUrl(title) {
    return `https://${this.wikiSubdomain}.fandom.com/wiki/${encodeURIComponent(
      title.replace(/\s+/g, '_'),
    )}`;
  }
}

/* --------------------------------------------------------------- parsing */

function stripHtml(html) {
  return html
    .replace(/<sup[^>]*>[\s\S]*?<\/sup>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/** Pulls label/value pairs out of a Fandom portable infobox. */
function extractInfoboxFields(html) {
  const fields = {};
  const rowPattern =
    /<h3[^>]*class="[^"]*pi-data-label[^"]*"[^>]*>([\s\S]*?)<\/h3>\s*<div[^>]*class="[^"]*pi-data-value[^"]*"[^>]*>([\s\S]*?)<\/div>/gi;

  let match = rowPattern.exec(html);
  while (match !== null) {
    const label = stripHtml(match[1]);
    const value = stripHtml(match[2]);
    if (label && value) fields[label] = value;
    match = rowPattern.exec(html);
  }
  return fields;
}

const CHIP_FIELDS = [
  { label: 'Status', tone: (value) => (/alive/i.test(value) ? 'good' : 'bad') },
  { label: 'Race', tone: () => 'neutral' },
  { label: 'Gender', tone: () => 'neutral' },
  { label: 'Occupation', tone: () => 'accent' },
  { label: 'Affiliation', tone: () => 'accent' },
  { label: 'Title', tone: () => 'accent' },
  { label: 'Cultivation', tone: () => 'accent' },
];

function buildChips(fields) {
  return CHIP_FIELDS.flatMap(({ label, tone }) => {
    const value = fields[label];
    if (!value) return [];
    return value
      .split(/[,;/]| and /i)
      .map((part) => part.trim())
      .filter((part) => part.length > 0 && part.length <= 34)
      .slice(0, 2)
      .map((part) => ({ label: part, tone: tone(part) }));
  }).slice(0, 6);
}

const ALIAS_FIELDS = ['Alias', 'Aliases', 'Other names', 'Also known as', 'Nickname', 'Nicknames'];

function buildAliases(fields, canonicalName, minAliasLength) {
  const rawAliases = ALIAS_FIELDS.flatMap((field) =>
    (fields[field] ?? '').split(/[,;]| and /i),
  );
  return rawAliases
    .map((alias) => alias.replace(/\([^)]*\)/g, '').trim())
    .filter(
      (alias) =>
        alias.length >= minAliasLength &&
        alias.length <= 40 &&
        alias.toLowerCase() !== canonicalName.toLowerCase() &&
        /^[\p{L}\p{N}][\p{L}\p{N}\s'’.-]*$/u.test(alias),
    )
    .filter((alias, index, all) => all.indexOf(alias) === index)
    .slice(0, 6);
}

const NATIVE_FIELDS = ['Chinese', 'Korean', 'Japanese', 'Kanji', 'Hanzi', 'Hangul', 'Native name'];
const ROMANIZED_FIELDS = ['Pinyin', 'Romaji', 'Romanized', 'Romanization'];

function pickFirstField(fields, candidateLabels) {
  for (const label of candidateLabels) {
    if (fields[label]) return fields[label];
  }
  return '';
}

/* ----------------------------------------------------------------- build */

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function chunk(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

async function buildLorepack(options) {
  const api = new FandomApi(options.wiki);
  const titleSet = new Set();

  for (const category of options.categories) {
    process.stderr.write(`Listing Category:${category}… `);
    const titles = await api.listCategoryMembers(category);
    titles.forEach((title) => titleSet.add(title));
    process.stderr.write(`${titles.length} pages\n`);
  }

  let allTitles = Array.from(titleSet);
  if (options.limit > 0) allTitles = allTitles.slice(0, options.limit);
  process.stderr.write(`Fetching ${allTitles.length} articles…\n`);

  const entities = [];

  for (const titleBatch of chunk(allTitles, BATCH_SIZE)) {
    const pages = await api.fetchSummaries(titleBatch);

    for (const page of pages) {
      if (page.missing !== undefined || !page.extract) continue;

      const fields = await api.fetchInfobox(page.title);
      await delay(API_DELAY_MS);

      entities.push({
        id: page.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
        name: page.title,
        aliases: buildAliases(fields, page.title, options.minAliasLength),
        type: 'entity',
        native: pickFirstField(fields, NATIVE_FIELDS),
        romanized: pickFirstField(fields, ROMANIZED_FIELDS),
        image: page.thumbnail?.source ?? '',
        chips: buildChips(fields),
        sections: [{ title: 'Background & context', body: page.extract, isSpoiler: false }],
        wikiUrl: api.buildArticleUrl(page.title),
      });
    }

    process.stderr.write(`  ${entities.length}/${allTitles.length}\n`);
    await delay(API_DELAY_MS);
  }

  return {
    schemaVersion: 1,
    source: `${options.wiki}.fandom.com`,
    generatedAt: new Date().toISOString(),
    entities,
  };
}

const options = parseArguments(process.argv.slice(2));
const lorepack = await buildLorepack(options);
await writeFile(options.out, JSON.stringify(lorepack, null, 2), 'utf8');
process.stderr.write(`\nWrote ${lorepack.entities.length} entities to ${options.out}\n`);
