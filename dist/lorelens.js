/* ── src/00-prologue.js ──────────────────────────────────────────────── */
/* =============================================================================
 *  LoreLens — tap a name, get the wiki entry, without leaving the chapter.
 *
 *  You are reading the whole program. It is one file on purpose: you are about
 *  to paste it into your reader, and you should be able to see everything it
 *  does before you do.
 *
 *  What it does
 *    · Finds character, place and technique names in the chapter you are reading
 *    · Tapping one opens a panel with the portrait, tags and summary from the
 *      novel's Fandom wiki
 *    · Hides anything that reads like a spoiler for a chapter you have not
 *      reached yet, behind a tap
 *
 *  What it needs from you
 *    Nothing. Paste it in and open a chapter. It works out which wiki your
 *    novel uses on its own; if it guesses wrong, tap the LoreLens button and
 *    tell it. There is no config to edit, no account, and no API key.
 *
 *  What it sends anywhere
 *    Only the name you tapped, only to that novel's Fandom wiki, and only when
 *    you tap it. No cookies are sent. Nothing about you is sent.
 *
 *  Install, docs, and how to report a bug
 *    https://github.com/Lumpish-Haggard/LoreLens
 *
 *  MIT licensed. Built by people who got tired of googling "who is <name>" and
 *  being spoiled by the first result.
 * ========================================================================== */

(function lorelensMain() {
  'use strict';

  /* Readers re-inject custom scripts on every chapter, and some do it more than
   * once per chapter. A second run should pick up the new text, not build a
   * second copy of the whole UI on top of the first. */
  if (window.lorelens && typeof window.lorelens.rescan === 'function') {
    window.lorelens.rescan();
    return;
  }

/* ── src/10-constants.js ─────────────────────────────────────────────── */

  /* ------------------------------------------------------------- constants */

  const VERSION = '2.0.0';

  const NS = 'lorelens';
  const STORAGE_PREFIX = 'lorelens:v2:';

  /**
   * Where the chapter text lives, most specific first. Readers differ and they
   * change between releases, so this is a list rather than one selector, and
   * ReaderContext has a heuristic fallback for when none of them hit.
   */
  const CHAPTER_SELECTORS = [
    '#LNReader-chapter',
    '#chapter',
    '.chapter-content',
    '#chapter-container',
    '.chapterCtn',
    'chapter',
    '#reader-container',
    '.reader-content',
    '#novel-content',
    'main article',
  ];

  /** Never highlight inside these — they are not prose. */
  const SKIP_SELECTOR = [
    'a',
    'code',
    'pre',
    'script',
    'style',
    'textarea',
    'input',
    'button',
    'select',
    'svg',
    'sup',
    'sub',
    '[contenteditable]',
    '[data-lorelens-skip]',
    '.lorelens-ui',
  ].join(',');

  /** The Custom Highlight API registration name, and the DOM-fallback class. */
  const HIGHLIGHT_NAME = 'lorelens-term';
  const MARK_CLASS = 'lorelens-term';

  /**
   * Colours a marked name can be painted in, per theme.
   *
   * Deliberately not the reader's own accent colour by default. A reader's
   * accent is almost always blue, and blue underlined text means "link" to
   * everyone who has ever used a browser — which is wrong here twice over: it
   * does not navigate anywhere, and the reader's own footnote and source links
   * genuinely are links. A marked name should read as a highlighter stroke over
   * the page, not as something to click through.
   *
   * Note that a highlight can only be styled with properties that do not affect
   * layout — colour, background, text-decoration, text-shadow. font-weight is
   * ignored by the browser here, so weight is simulated with a tight
   * text-shadow instead, which thickens the glyphs without reflowing the line.
   */
  const MARK_COLORS = {
    violet: { dark: { r: 201, g: 184, b: 255 }, light: { r: 106, g: 42, b: 200 } },
    amber: { dark: { r: 252, g: 211, b: 120 }, light: { r: 163, g: 88, b: 10 } },
    teal: { dark: { r: 110, g: 231, b: 213 }, light: { r: 13, g: 110, b: 120 } },
    rose: { dark: { r: 253, g: 168, b: 190 }, light: { r: 188, g: 30, b: 96 } },
  };

  const MAX_TERM_WORDS = 5;
  const MIN_TERM_LENGTH = 3;

  /** Text-node batch size per frame while highlighting. Tuned for long chapters. */
  const NODES_PER_BATCH = 150;

  /** Hard ceiling on indexed terms, to bound regex compile and match cost. */
  const MAX_INDEXED_TERMS = 1200;

  /** How long a looked-up wiki entry stays good, in days. */
  const ENTRY_TTL_DAYS = 45;

  /** How long a which-wiki-is-this-novel decision stays good, in days. */
  const WIKI_TTL_DAYS = 180;

  /** Concurrent wiki requests. Fandom is fine with more; phone radios are not. */
  const MAX_CONCURRENT_REQUESTS = 3;

  /** Requests time out rather than leaving the panel spinning forever. */
  const REQUEST_TIMEOUT_MS = 12000;

  /** Diagnostics ring buffer size, surfaced by "Copy diagnostics". */
  const LOG_CAPACITY = 120;

  /**
   * Words that commonly start sentences. A capitalised word here is capitalised
   * because of punctuation, not because it is a name, so auto-detect skips it.
   */
  const STOPWORDS = new Set(
    ('a an and as at after all also although am are around before but by been being ' +
      'can could did do does down during each even every for from finally further ' +
      'had has have he her here hers him his how however i if in into is it its ' +
      'just like me more most my never no nor not now of off on once one only or ' +
      'other our out over perhaps she should since so some still such suddenly than ' +
      'that the their them then there these they this those though through thus to ' +
      'too under until up upon us very was we were what when where whether which ' +
      'while who whom why will with within without would yes yet you your ' +
      'chapter volume book part prologue epilogue arc translator editor note ' +
      'meanwhile afterwards nevertheless besides instead otherwise moreover'
    ).split(' '),
  );

  /**
   * Infobox labels, grouped by meaning. Wikis label the same field a dozen ways
   * and in several languages; this table is the whole compatibility layer for
   * that, and it is deliberately just data, so supporting another wiki needs no
   * new logic.
   *
   * Adding entries here is the most welcome kind of pull request there is.
   */
  const FIELD_ALIASES = {
    status: ['status', 'state', 'standing', 'condition', 'vital status', 'estado', 'statut'],
    race: ['race', 'species', 'kind', 'type', 'bloodline', 'raza'],
    gender: ['gender', 'sex'],
    affiliation: [
      'affiliation', 'affiliations', 'organization', 'organisation', 'faction',
      'sect', 'clan', 'family', 'house', 'guild', 'team', 'group', 'allegiance',
      'occupation', 'profession', 'position', 'role',
    ],
    rank: [
      'rank', 'title', 'titles', 'cultivation', 'cultivation level', 'realm',
      'level', 'class', 'grade', 'tier', 'stage', 'power level',
    ],
    alias: [
      'alias', 'aliases', 'other names', 'other name', 'also known as', 'aka',
      'nickname', 'nicknames', 'epithet', 'epithets', 'known as',
      'alternate names', 'true name', 'birth name', 'real name',
    ],
    native: [
      'chinese', 'korean', 'japanese', 'kanji', 'hanzi', 'hangul', 'hanja',
      'native name', 'original name', 'simplified chinese', 'traditional chinese',
    ],
    romanized: [
      'pinyin', 'romaji', 'romanized', 'romanised', 'romanization',
      'revised romanization',
    ],
    firstSeen: [
      'first appearance', 'debut', 'first seen', 'introduced', 'first mentioned',
      'novel debut',
    ],
  };

  /**
   * Phrases that mean a sentence is probably about how something ends. Used by
   * the spoiler guard when the text gives no chapter number to compare against.
   * Erring toward hiding is right here: an unnecessary tap costs a second, an
   * unnecessary reveal costs the book.
   */
  /*
   * These are matched as plain substrings against folded text, so each entry
   * should be the shortest phrase that still carries the meaning: "revealed to
   * be" catches "is revealed to be" and "is later revealed to be", where the
   * longer form catches only the first. Adverbs get inserted mid-phrase far
   * more often than you would expect.
   */
  const SPOILER_PHRASES = [
    'is killed', 'was killed', 'killed by', 'is slain', 'dies', 'died',
    'death of', 'his death', 'her death', 'their death',
    'revealed to be', 'turns out to be',
    'reveals himself', 'reveals herself', 'true identity', 'betrays', 'betrayed',
    'is actually', 'later becomes', 'eventually becomes', 'goes on to',
    'in the end', 'at the end of', 'final battle', 'ultimately',
    'sacrifices himself', 'sacrifices herself', 'is resurrected', 'reincarnates as',
    'ascends to', 'becomes the new', 'is defeated by', 'defeats', 'kills',
    'murdered', 'assassinated', 'marries', 'falls in love with',
    'is the son of', 'is the daughter of', 'is the reincarnation of',
    'secretly', 'unbeknownst',
  ];

  /** Status values that give away a character's fate on sight. */
  const FATE_WORDS =
    /\b(dead|deceased|died|killed|alive|living|active|inactive|retired|imprisoned|sealed|revived|resurrected)\b/i;

  /** Sections of a wiki article that are almost always spoilers wholesale. */
  const SPOILER_SECTION_TITLES =
    /^(plot|story|history|synopsis|biography|events|timeline|death|fate|later|epilogue|ending|relationships)/i;

/* ── src/15-utils.js ─────────────────────────────────────────────────── */

  /* ------------------------------------------------------------- utilities */

  /**
   * Diagnostics ring buffer. Everything interesting that happens gets a line
   * here, and the settings panel can copy the whole thing to the clipboard.
   * Bug reports from inside a phone reader are otherwise almost content-free,
   * so this is the difference between a fixable report and a guess.
   */
  const logLines = [];
  const startedAt = Date.now();

  function log() {
    const parts = Array.prototype.slice.call(arguments).map(function (part) {
      if (typeof part === 'string') return part;
      try {
        return JSON.stringify(part);
      } catch (error) {
        return String(part);
      }
    });
    const elapsed = String(Date.now() - startedAt).padStart(6, ' ');
    logLines.push(elapsed + 'ms  ' + parts.join(' '));
    if (logLines.length > LOG_CAPACITY) logLines.shift();
  }

  /**
   * Wrap anything that the reader will call into. A LoreLens bug must never be
   * able to take the chapter down with it — a reader that will not scroll is a
   * far worse outcome than a reader with no highlights.
   */
  function guard(label, fn) {
    return function guarded() {
      try {
        return fn.apply(this, arguments);
      } catch (error) {
        log('ERROR in ' + label + ':', (error && error.message) || String(error));
        return undefined;
      }
    };
  }

  /** The async twin of guard(). Rejections become undefined, never unhandled. */
  function guardAsync(label, fn) {
    return function guardedAsync() {
      try {
        return Promise.resolve(fn.apply(this, arguments)).catch(function (error) {
          log('ERROR in ' + label + ':', (error && error.message) || String(error));
          return undefined;
        });
      } catch (error) {
        log('ERROR in ' + label + ':', (error && error.message) || String(error));
        return Promise.resolve(undefined);
      }
    };
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /**
   * For anything going into an href or src. Wiki data is untrusted input, and
   * "untrusted" includes a page whose infobox image field somebody set to a
   * javascript: URL.
   */
  function escapeUrl(value) {
    const text = String(value == null ? '' : value).trim();
    if (!/^https?:\/\//i.test(text)) return '';
    return escapeHtml(text);
  }

  function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Case- and accent-insensitive key for looking a term up. Normalising width
   * and diacritics matters more than it looks: translated novels mix "Lu Yu",
   * "Lú Yǔ" and full-width punctuation inside a single chapter.
   */
  function foldKey(value) {
    let text = String(value == null ? '' : value);
    if (typeof text.normalize === 'function') {
      try {
        text = text.normalize('NFKD').replace(/[̀-ͯ]/g, '');
      } catch (error) {
        /* older engines: fall through with the unnormalised string */
      }
    }
    return text
      .toLowerCase()
      .replace(/[‘’ʼ]/g, "'")
      .replace(/[‐-―]/g, '-')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function slugify(value) {
    return foldKey(value)
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  function titleToWikiPath(title) {
    return encodeURIComponent(String(title).replace(/\s+/g, '_'));
  }

  function clamp(value, low, high) {
    return Math.min(high, Math.max(low, value));
  }

  function unique(items) {
    const seen = new Set();
    const out = [];
    for (const item of items) {
      const key = foldKey(item);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(item);
    }
    return out;
  }

  function debounce(fn, waitMs) {
    let timer = null;
    return function debounced() {
      const args = arguments;
      const self = this;
      window.clearTimeout(timer);
      timer = window.setTimeout(function () {
        fn.apply(self, args);
      }, waitMs);
    };
  }

  /** Yield to the reader. Highlighting must never win a fight with scrolling. */
  function whenIdle(fn) {
    if (typeof window.requestIdleCallback === 'function') {
      window.requestIdleCallback(fn, { timeout: 500 });
    } else if (typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(function () {
        window.setTimeout(fn, 0);
      });
    } else {
      window.setTimeout(fn, 0);
    }
  }

  function sleep(ms) {
    return new Promise(function (resolve) {
      window.setTimeout(resolve, ms);
    });
  }

  /**
   * Split prose into sentences. Not linguistically perfect and does not need to
   * be — it feeds the spoiler guard, where the cost of a bad split is that one
   * extra clause gets hidden.
   */
  function splitSentences(text) {
    const cleaned = String(text || '').replace(/\s+/g, ' ').trim();
    if (!cleaned) return [];
    const parts = cleaned.match(/[^.!?]+[.!?]+(?:["'”’)]+)?\s*|[^.!?]+$/g);
    return (parts || [cleaned]).map(function (part) {
      return part.trim();
    }).filter(Boolean);
  }

  /* ------------------------------------------------------------- colours -- */

  /**
   * The panel has to sit inside whatever theme the reader is using, including
   * themes that did not exist when this was written. Rather than hardcode the
   * reader's CSS variable names — which differ between apps and change between
   * releases — we read the colours the page is actually painting and build a
   * matching palette from them. That works everywhere and cannot go stale.
   */

  function parseColor(value) {
    const text = String(value || '').trim();
    if (!text) return null;

    let match = text.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.%]+))?\s*\)$/i);
    if (match) {
      let alpha = 1;
      if (match[4] != null) {
        alpha = match[4].indexOf('%') >= 0 ? parseFloat(match[4]) / 100 : parseFloat(match[4]);
      }
      return {
        r: clamp(parseFloat(match[1]), 0, 255),
        g: clamp(parseFloat(match[2]), 0, 255),
        b: clamp(parseFloat(match[3]), 0, 255),
        a: clamp(alpha, 0, 1),
      };
    }

    match = text.match(/^#([0-9a-f]{3,8})$/i);
    if (match) {
      const hex = match[1];
      const expand = function (part) {
        return parseInt(part.length === 1 ? part + part : part, 16);
      };
      if (hex.length === 3 || hex.length === 4) {
        return {
          r: expand(hex[0]),
          g: expand(hex[1]),
          b: expand(hex[2]),
          a: hex.length === 4 ? expand(hex[3]) / 255 : 1,
        };
      }
      if (hex.length === 6 || hex.length === 8) {
        return {
          r: expand(hex.slice(0, 2)),
          g: expand(hex.slice(2, 4)),
          b: expand(hex.slice(4, 6)),
          a: hex.length === 8 ? expand(hex.slice(6, 8)) / 255 : 1,
        };
      }
    }

    return null;
  }

  /** Perceived brightness, 0 (black) to 1 (white). Good enough for theme choice. */
  function luminance(color) {
    if (!color) return 0;
    const channel = function (value) {
      const scaled = value / 255;
      return scaled <= 0.03928 ? scaled / 12.92 : Math.pow((scaled + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
  }

  function mixColors(from, to, amount) {
    return {
      r: Math.round(from.r + (to.r - from.r) * amount),
      g: Math.round(from.g + (to.g - from.g) * amount),
      b: Math.round(from.b + (to.b - from.b) * amount),
      a: 1,
    };
  }

  function toCss(color, alpha) {
    const a = alpha == null ? (color.a == null ? 1 : color.a) : alpha;
    return 'rgba(' + Math.round(color.r) + ',' + Math.round(color.g) + ',' + Math.round(color.b) + ',' + a + ')';
  }

  /** Is this colour actually painted, or is it a transparent placeholder? */
  function isOpaqueEnough(color) {
    return Boolean(color) && color.a > 0.5;
  }

/* ── src/20-storage.js ───────────────────────────────────────────────── */

  /* --------------------------------------------------------------- storage */

  /**
   * localStorage, but it never throws and it never grows without bound.
   *
   * A reader WebView may have storage disabled, may be in a private context, or
   * may hand us a quota of nothing at all. In every one of those cases LoreLens
   * has to keep working for the current session, so an in-memory map always
   * backs the persistent store rather than replacing it.
   */
  class Store {
    constructor() {
      this.memory = new Map();
      this.backend = Store.probeBackend();
      log('storage backend:', this.backend ? 'localStorage' : 'memory only');
    }

    static probeBackend() {
      try {
        const key = STORAGE_PREFIX + 'probe';
        window.localStorage.setItem(key, '1');
        window.localStorage.removeItem(key);
        return window.localStorage;
      } catch (error) {
        return null;
      }
    }

    /**
     * @returns the stored value, or null if absent or expired.
     *
     * The memory layer carries its own expiry rather than being a plain value
     * cache. Without that, a time-to-live would only ever take effect after a
     * reload — the in-memory copy would keep answering with stale data for as
     * long as the reader stayed open, which for a reading session is hours.
     */
    read(key) {
      const cached = this.memory.get(key);
      if (cached) {
        if (cached.expiresAt && Date.now() > cached.expiresAt) {
          this.remove(key);
          return null;
        }
        return cached.value;
      }

      if (!this.backend) return null;
      try {
        const raw = this.backend.getItem(STORAGE_PREFIX + key);
        if (!raw) return null;
        const record = JSON.parse(raw);
        if (record.expiresAt && Date.now() > record.expiresAt) {
          this.remove(key);
          return null;
        }
        this.memory.set(key, { value: record.value, expiresAt: record.expiresAt || 0 });
        return record.value;
      } catch (error) {
        return null;
      }
    }

    write(key, value, ttlDays) {
      const expiresAt = ttlDays ? Date.now() + ttlDays * 86400000 : 0;
      this.memory.set(key, { value: value, expiresAt: expiresAt });
      if (!this.backend) return;
      const record = {
        savedAt: Date.now(),
        expiresAt: expiresAt,
        value: value,
      };
      try {
        this.backend.setItem(STORAGE_PREFIX + key, JSON.stringify(record));
      } catch (error) {
        /* Almost certainly the quota. Drop the oldest half of our own cached
         * entries and try once more; if it still fails, memory carries the
         * session and we simply re-fetch next time. */
        if (this.evictOldest()) {
          try {
            this.backend.setItem(STORAGE_PREFIX + key, JSON.stringify(record));
          } catch (retryError) {
            log('storage write failed after eviction');
          }
        }
      }
    }

    remove(key) {
      this.memory.delete(key);
      if (!this.backend) return;
      try {
        this.backend.removeItem(STORAGE_PREFIX + key);
      } catch (error) {
        /* nothing useful to do */
      }
    }

    /** Only ever touches keys under our own prefix. */
    ownKeys() {
      if (!this.backend) return [];
      const keys = [];
      try {
        for (let index = 0; index < this.backend.length; index += 1) {
          const key = this.backend.key(index);
          if (key && key.indexOf(STORAGE_PREFIX) === 0) keys.push(key);
        }
      } catch (error) {
        return [];
      }
      return keys;
    }

    evictOldest() {
      const entries = [];
      for (const fullKey of this.ownKeys()) {
        if (fullKey.indexOf(STORAGE_PREFIX + 'settings') === 0) continue; // never evict settings
        try {
          const record = JSON.parse(this.backend.getItem(fullKey));
          entries.push({ key: fullKey, savedAt: (record && record.savedAt) || 0 });
        } catch (error) {
          entries.push({ key: fullKey, savedAt: 0 });
        }
      }
      if (entries.length === 0) return false;
      entries.sort(function (left, right) {
        return left.savedAt - right.savedAt;
      });
      const doomed = entries.slice(0, Math.max(1, Math.floor(entries.length / 2)));
      for (const entry of doomed) {
        try {
          this.backend.removeItem(entry.key);
        } catch (error) {
          /* keep going */
        }
      }
      log('evicted', String(doomed.length), 'cached entries to free space');
      return true;
    }

    clearCache() {
      let removed = 0;
      for (const fullKey of this.ownKeys()) {
        if (fullKey.indexOf(STORAGE_PREFIX + 'settings') === 0) continue;
        try {
          this.backend.removeItem(fullKey);
          removed += 1;
        } catch (error) {
          /* keep going */
        }
      }
      this.memory.clear();
      return removed;
    }

    /** Rough size of what we are occupying, for the settings panel. */
    describeUsage() {
      let bytes = 0;
      let count = 0;
      for (const fullKey of this.ownKeys()) {
        try {
          bytes += (this.backend.getItem(fullKey) || '').length;
          count += 1;
        } catch (error) {
          /* keep going */
        }
      }
      return { count: count, kilobytes: Math.round(bytes / 1024) };
    }
  }

/* ── src/25-settings.js ──────────────────────────────────────────────── */

  /* -------------------------------------------------------------- settings */

  /**
   * Every setting lives here and every one of them is editable from the panel
   * inside the reader. Nothing in this file is meant to be hand-edited before
   * pasting — that was the old way, it meant re-pasting the whole script to
   * change one thing, and it is why the defaults below are chosen to be
   * correct for someone who never opens the settings at all.
   */
  const DEFAULT_SETTINGS = {
    /** Master switch. Off means no highlights, no panel, no requests. */
    enabled: true,

    /**
     * 'balanced' underlines names we are confident about and dims maybes.
     * 'generous' highlights anything name-shaped. 'strict' only highlights
     * names confirmed to exist on the wiki.
     */
    detection: 'balanced',

    /** Highlight only the first mention of a name in each paragraph. */
    firstMentionOnly: true,

    /**
     * How a marked name is painted.
     *   'marker' — a coloured wash behind the word, like a highlighter pen
     *   'bold'   — coloured and thickened, no background
     *   'underline' — a coloured underline, for people who prefer it quiet
     */
    highlightStyle: 'marker',

    /** Which colour to mark in: violet, amber, teal, rose, or the reader's own accent. */
    highlightColor: 'violet',

    /**
     * How much of a wiki entry to hide.
     *   'chapter' — hide anything the wiki ties to a chapter past where you are
     *   'strong'  — the above, plus fate tags and anything that reads final
     *   'off'     — show everything
     */
    spoilerGuard: 'chapter',

    /** Your position in the book. Auto-filled from the chapter title. */
    chapterProgress: 0,

    /** Fandom subdomain override for this novel, e.g. 'shadowslave'. */
    wiki: '',

    /** Look names up on the wiki when tapped. Off makes LoreLens fully offline. */
    liveLookup: true,

    /** Quietly fetch the most common names after a chapter loads, so taps are instant. */
    prefetch: true,

    /** Show a floating button to open settings. Off leaves only the long-press path. */
    showButton: true,

    /** Show the button that opens this world's cultivation / rank ladder. */
    showRealmsButton: true,

    /** Select any text and get a "Look up" button, even on names we did not highlight. */
    selectionLookup: true,

    /** Optional offline lorepack, for people who want zero network at read time. */
    lorepackUrl: '',
  };

  const SETTINGS_KEY = 'settings';

  class Settings {
    constructor(store) {
      this.store = store;
      this.values = Object.assign({}, DEFAULT_SETTINGS);
      this.perNovel = {};
      this.novelKey = '';
      this.listeners = [];
      this.load();
    }

    load() {
      const saved = this.store.read(SETTINGS_KEY);
      if (saved && typeof saved === 'object') {
        /* Only adopt keys we still know about, so a setting removed in a later
         * version cannot resurrect itself out of someone's storage. */
        for (const key of Object.keys(DEFAULT_SETTINGS)) {
          if (Object.prototype.hasOwnProperty.call(saved, key)) {
            this.values[key] = saved[key];
          }
        }
        this.perNovel = (saved.perNovel && typeof saved.perNovel === 'object') ? saved.perNovel : {};
      }
    }

    save() {
      const payload = Object.assign({}, this.values, { perNovel: this.perNovel });
      this.store.write(SETTINGS_KEY, payload, 0);
    }

    /**
     * Bind to a novel. Anything set from here on is remembered for this novel
     * specifically — which wiki it uses and how far in you are — because those
     * two are meaningless globally.
     */
    useNovel(novelKey) {
      this.novelKey = novelKey || '';
      const scoped = this.perNovel[this.novelKey];
      if (scoped) {
        if (scoped.wiki) this.values.wiki = scoped.wiki;
        if (scoped.chapterProgress) this.values.chapterProgress = scoped.chapterProgress;
      } else {
        this.values.wiki = '';
        this.values.chapterProgress = 0;
      }
    }

    get(key) {
      return this.values[key];
    }

    set(key, value) {
      if (!Object.prototype.hasOwnProperty.call(DEFAULT_SETTINGS, key)) return;
      this.values[key] = value;

      if ((key === 'wiki' || key === 'chapterProgress') && this.novelKey) {
        if (!this.perNovel[this.novelKey]) this.perNovel[this.novelKey] = {};
        this.perNovel[this.novelKey][key] = value;
      }

      this.save();
      this.emit(key, value);
    }

    /** Update progress only upward — flicking back a chapter should not re-hide. */
    advanceProgress(chapterNumber) {
      if (!chapterNumber || chapterNumber <= this.values.chapterProgress) return;
      this.set('chapterProgress', chapterNumber);
    }

    onChange(listener) {
      this.listeners.push(listener);
    }

    emit(key, value) {
      for (const listener of this.listeners) {
        try {
          listener(key, value);
        } catch (error) {
          log('settings listener failed:', (error && error.message) || 'unknown');
        }
      }
    }

    reset() {
      this.values = Object.assign({}, DEFAULT_SETTINGS);
      this.perNovel = {};
      this.save();
      this.emit('*', null);
    }
  }

/* ── src/30-context.js ───────────────────────────────────────────────── */

  /* -------------------------------------------------------- reader context */

  /**
   * Everything LoreLens knows about the page it landed in: where the prose is,
   * what novel this is, how far in we are, and what colours to paint with.
   *
   * All of it is discovered at runtime by looking at the page. None of it is a
   * hardcoded assumption about a particular reader app's markup, because that
   * kind of assumption is exactly what breaks silently when the app ships a new
   * version and nobody notices for a month.
   */
  class ReaderContext {
    constructor() {
      this.root = null;
      this.novelTitle = '';
      this.chapterTitle = '';
      this.chapterNumber = 0;
      this.palette = null;
    }

    detect() {
      this.root = this.findChapterRoot();
      this.novelTitle = this.findNovelTitle();
      this.chapterTitle = this.findChapterTitle();
      this.chapterNumber = ReaderContext.parseChapterNumber(this.chapterTitle);
      this.palette = this.buildPalette();

      log(
        'context:',
        'root=' + (this.root ? this.describeElement(this.root) : 'NONE'),
        'novel=' + (this.novelTitle || '?'),
        'chapter=' + (this.chapterTitle || '?'),
        'number=' + this.chapterNumber,
      );
      return this.root != null;
    }

    describeElement(element) {
      return (
        element.tagName.toLowerCase() +
        (element.id ? '#' + element.id : '') +
        (element.className && typeof element.className === 'string'
          ? '.' + element.className.trim().split(/\s+/).slice(0, 2).join('.')
          : '')
      );
    }

    /**
     * Try the known containers first, then fall back to finding the element
     * that actually holds the prose. The fallback is what keeps this working in
     * a reader nobody has told us about yet.
     */
    findChapterRoot() {
      for (const selector of CHAPTER_SELECTORS) {
        let element = null;
        try {
          element = document.querySelector(selector);
        } catch (error) {
          continue; // a selector this browser will not parse
        }
        if (element && ReaderContext.textLengthOf(element) > 200) {
          return element;
        }
      }
      return this.findDensestTextBlock();
    }

    /**
     * The chapter is the smallest element that still contains most of the
     * page's text. Walking down from body and stopping when a child no longer
     * holds the bulk of it lands on the prose container in essentially any
     * reader layout.
     */
    findDensestTextBlock() {
      const body = document.body;
      if (!body) return null;

      const totalLength = ReaderContext.textLengthOf(body);
      if (totalLength < 200) return null;

      let best = body;
      let madeProgress = true;

      while (madeProgress) {
        madeProgress = false;
        const children = Array.prototype.slice.call(best.children || []);
        for (const child of children) {
          if (child.classList && child.classList.contains('lorelens-ui')) continue;
          if (ReaderContext.textLengthOf(child) > totalLength * 0.6) {
            best = child;
            madeProgress = true;
            break;
          }
        }
      }

      log('fell back to densest text block:', this.describeElement(best));
      return best === body ? body : best;
    }

    static textLengthOf(element) {
      const text = element && (element.textContent || '');
      return text.replace(/\s+/g, ' ').trim().length;
    }

    /**
     * Novel title, in descending order of how much we trust the source. Readers
     * vary wildly in what they expose, so we take the first thing that looks
     * like a title and is not obviously the chapter heading.
     */
    findNovelTitle() {
      const candidates = [];

      /* Some readers hand the page a data object. If one exists, believe it. */
      const bridge = window.reader || window.novel || null;
      if (bridge) {
        if (bridge.novel && bridge.novel.name) candidates.push(bridge.novel.name);
        if (bridge.novelName) candidates.push(bridge.novelName);
        if (typeof bridge.name === 'string') candidates.push(bridge.name);
      }

      /* Data attributes are the next most reliable signal. */
      const attributeNames = ['data-novel-name', 'data-novel', 'data-novel-title', 'data-title'];
      for (const attribute of attributeNames) {
        const element = document.querySelector('[' + attribute + ']');
        if (element) candidates.push(element.getAttribute(attribute));
      }

      /* Then the document title, minus any chapter suffix. */
      if (document.title) {
        candidates.push(
          document.title
            .replace(/[-–—|:]\s*(chapter|ch\.?|episode|ep\.?)\s*[\d.]+.*$/i, '')
            .replace(/\s*[-–—|]\s*(LNReader|Reader)\s*$/i, ''),
        );
      }

      for (const candidate of candidates) {
        const cleaned = String(candidate || '').replace(/\s+/g, ' ').trim();
        if (cleaned.length >= 2 && cleaned.length <= 120 && !/^chapter\b/i.test(cleaned)) {
          return cleaned;
        }
      }
      return '';
    }

    findChapterTitle() {
      const bridge = window.reader || null;
      if (bridge && bridge.chapter && bridge.chapter.name) {
        return String(bridge.chapter.name).trim();
      }

      const attributeElement = document.querySelector('[data-chapter-name],[data-chapter-title]');
      if (attributeElement) {
        const value =
          attributeElement.getAttribute('data-chapter-name') ||
          attributeElement.getAttribute('data-chapter-title');
        if (value) return String(value).trim();
      }

      /* Otherwise the first heading inside or just above the prose. */
      const scope = this.root || document.body;
      const heading = scope && scope.querySelector('h1, h2, h3, .chapter-title, #chapter-title');
      if (heading) {
        const text = (heading.textContent || '').replace(/\s+/g, ' ').trim();
        if (text && text.length <= 160) return text;
      }

      if (document.title) return document.title.trim();
      return '';
    }

    /**
     * Pull a chapter number out of a title. This drives the spoiler guard, so
     * it deliberately refuses ambiguous cases rather than guessing: a wrong
     * number here means either hiding everything or hiding nothing.
     */
    static parseChapterNumber(title) {
      const text = String(title || '');
      const labelled = text.match(/(?:chapter|chap\.?|ch\.?|episode|ep\.?)\s*#?\s*(\d{1,5})(?:\.(\d+))?/i);
      if (labelled) return parseFloat(labelled[1] + (labelled[2] ? '.' + labelled[2] : ''));

      /* A bare leading number, as in "0862 - The River of Time". */
      const leading = text.match(/^\s*#?(\d{1,5})(?:\s*[-–—:.]|\s)/);
      if (leading) return parseInt(leading[1], 10);

      return 0;
    }

    /**
     * Read the colours the reader is actually painting and derive a palette
     * from them, so the panel matches themes that did not exist when this was
     * written. Reading computed style beats reading CSS variables here: the
     * variable names differ per app and change between releases, but the
     * painted background is always the painted background.
     */
    buildPalette() {
      const background = this.findPaintedBackground();
      const foreground = this.findPaintedForeground(background);
      const isDark = luminance(background) < 0.45;
      const contrastPole = isDark ? { r: 255, g: 255, b: 255, a: 1 } : { r: 0, g: 0, b: 0, a: 1 };

      const accent = this.findAccent(isDark);

      return {
        isDark: isDark,
        background: background,
        foreground: foreground,
        surface: mixColors(background, contrastPole, isDark ? 0.07 : 0.04),
        surfaceRaised: mixColors(background, contrastPole, isDark ? 0.12 : 0.07),
        outline: toCss(foreground, 0.16),
        outlineStrong: toCss(foreground, 0.28),
        muted: toCss(foreground, 0.62),
        accent: accent,
        scrim: isDark ? 'rgba(0,0,0,.62)' : 'rgba(0,0,0,.38)',
      };
    }

    findPaintedBackground() {
      const candidates = [this.root, document.body, document.documentElement];
      for (const element of candidates) {
        if (!element) continue;
        const color = parseColor(ReaderContext.computed(element, 'background-color'));
        if (isOpaqueEnough(color)) return color;
      }
      /* Nothing opaque anywhere — infer from the text colour instead. */
      const text = parseColor(ReaderContext.computed(document.body, 'color'));
      return luminance(text) > 0.5 ? { r: 18, g: 18, b: 18, a: 1 } : { r: 250, g: 250, b: 250, a: 1 };
    }

    findPaintedForeground(background) {
      const candidates = [this.root, document.body, document.documentElement];
      for (const element of candidates) {
        if (!element) continue;
        const color = parseColor(ReaderContext.computed(element, 'color'));
        if (isOpaqueEnough(color)) return color;
      }
      return luminance(background) < 0.45
        ? { r: 235, g: 235, b: 235, a: 1 }
        : { r: 26, g: 26, b: 26, a: 1 };
    }

    /**
     * An accent for links and highlights. If the reader exposes a theme colour
     * we will happily use it; the variable names below are tried on the chance
     * that one hits, and a readable default is used when none do.
     */
    findAccent(isDark) {
      const variableNames = [
        '--theme-primary',
        '--theme-accent',
        '--readerSettings-theme-primary',
        '--primary',
        '--accent-color',
      ];
      const rootStyle = window.getComputedStyle(document.documentElement);
      for (const name of variableNames) {
        const raw = rootStyle.getPropertyValue(name);
        const color = parseColor(raw && raw.trim());
        if (isOpaqueEnough(color)) return color;
      }
      return isDark ? { r: 130, g: 170, b: 255, a: 1 } : { r: 33, g: 99, b: 216, a: 1 };
    }

    static computed(element, property) {
      try {
        return window.getComputedStyle(element).getPropertyValue(property);
      } catch (error) {
        return '';
      }
    }

    /** Stable key for remembering per-novel settings. */
    get novelKey() {
      return slugify(this.novelTitle) || 'unknown-novel';
    }
  }

/* ── src/40-wiki.js ──────────────────────────────────────────────────── */

  /* ------------------------------------------------------------ wiki client */

  /**
   * A small request queue. Phones drop to one usable connection often enough
   * that firing twenty lookups at once turns a chapter into a stall, so
   * everything outbound goes through here.
   */
  class RequestQueue {
    constructor(limit) {
      this.limit = limit;
      this.active = 0;
      this.waiting = [];
    }

    run(task) {
      const self = this;
      return new Promise(function (resolve) {
        self.waiting.push({ task: task, resolve: resolve });
        self.pump();
      });
    }

    pump() {
      while (this.active < this.limit && this.waiting.length > 0) {
        const job = this.waiting.shift();
        this.active += 1;
        const self = this;
        Promise.resolve()
          .then(job.task)
          .catch(function () {
            return null;
          })
          .then(function (result) {
            self.active -= 1;
            job.resolve(result);
            self.pump();
          });
      }
    }
  }

  /**
   * Talks to a Fandom wiki over the MediaWiki Action API.
   *
   * Requests are anonymous (`credentials: 'omit'`) and carry `origin=*`, which
   * is how MediaWiki is asked to answer a cross-origin request from a page that
   * is not logged in. Nothing identifying is ever sent — the wiki sees a
   * request for an article title and nothing else.
   */
  class WikiClient {
    constructor(store) {
      this.store = store;
      this.subdomain = '';
      this.queue = new RequestQueue(MAX_CONCURRENT_REQUESTS);
      this.inFlight = new Map();
      this.failures = 0;
      this.disabled = false;
    }

    use(subdomain) {
      if (this.subdomain === subdomain) return;
      this.subdomain = subdomain || '';
      this.failures = 0;
      this.disabled = false;
      log('wiki set to:', this.subdomain || '(none)');
    }

    get isReady() {
      return Boolean(this.subdomain) && !this.disabled;
    }

    host(subdomain) {
      return 'https://' + (subdomain || this.subdomain) + '.fandom.com';
    }

    articleUrl(title, subdomain) {
      return this.host(subdomain) + '/wiki/' + titleToWikiPath(title);
    }

    /* --------------------------------------------------------- transport -- */

    /**
     * One GET against api.php. Returns parsed JSON, or null for anything that
     * went wrong — callers decide what a null means in their context, and none
     * of them treat it as fatal.
     */
    request(params, subdomain) {
      const self = this;
      const query = new URLSearchParams(
        Object.assign({ format: 'json', formatversion: '2', origin: '*' }, params),
      );
      const url = this.host(subdomain) + '/api.php?' + query.toString();

      return this.queue.run(function () {
        return self.fetchJson(url);
      });
    }

    fetchJson(url) {
      const self = this;
      let signal;
      let timer = null;

      if (typeof window.AbortController === 'function') {
        const controller = new window.AbortController();
        signal = controller.signal;
        timer = window.setTimeout(function () {
          controller.abort();
        }, REQUEST_TIMEOUT_MS);
      }

      return fetch(url, {
        credentials: 'omit',
        redirect: 'follow',
        signal: signal,
      })
        .then(function (response) {
          if (!response.ok) throw new Error('HTTP ' + response.status);
          return response.json();
        })
        .then(function (payload) {
          if (timer) window.clearTimeout(timer);
          self.failures = 0;
          return payload;
        })
        .catch(function (error) {
          if (timer) window.clearTimeout(timer);
          self.noteFailure(error);
          return null;
        });
    }

    /**
     * Give up after enough consecutive failures. If the WebView blocks
     * cross-origin requests outright — which some do, depending on how the
     * reader loads the page — then every request will fail, and continuing to
     * try just burns battery and makes every tap feel broken. Better to fall
     * silent and say so in the panel.
     */
    noteFailure(error) {
      this.failures += 1;
      const message = (error && error.message) || String(error);
      log('wiki request failed (' + this.failures + '):', message);
      if (this.failures >= 5) {
        this.disabled = true;
        log('wiki lookups disabled after repeated failures');
      }
    }

    /** Collapse duplicate concurrent lookups for the same thing. */
    dedupe(key, factory) {
      if (this.inFlight.has(key)) return this.inFlight.get(key);
      const self = this;
      const promise = Promise.resolve()
        .then(factory)
        .then(function (value) {
          self.inFlight.delete(key);
          return value;
        })
        .catch(function () {
          self.inFlight.delete(key);
          return null;
        });
      this.inFlight.set(key, promise);
      return promise;
    }

    /* ------------------------------------------------------------ lookups -- */

    /**
     * Fetch an article by title: summary, portrait, canonical URL, redirects
     * resolved. One request covers all of it.
     */
    fetchArticle(title, subdomain) {
      const self = this;
      return this.request(
        {
          action: 'query',
          prop: 'extracts|pageimages|info',
          inprop: 'url',
          redirects: '1',
          exintro: '1',
          explaintext: '1',
          exsentences: '10',
          piprop: 'thumbnail',
          pithumbsize: '480',
          titles: title,
        },
        subdomain,
      ).then(function (payload) {
        const page = WikiClient.firstPage(payload);
        if (!page || page.missing) return null;
        /* Some wikis do not have the extracts extension enabled. Fall back to
         * parsing the lead section out of the rendered article instead. */
        if (!page.extract) {
          return self.fetchLeadSection(page.title, subdomain).then(function (text) {
            if (!text) return null;
            page.extract = text;
            return page;
          });
        }
        return page;
      });
    }

    /** Rendered lead section, stripped to text. The fallback for no extracts. */
    fetchLeadSection(title, subdomain) {
      return this.request(
        { action: 'parse', page: title, prop: 'text', section: '0', redirects: '1' },
        subdomain,
      ).then(function (payload) {
        const html = payload && payload.parse && payload.parse.text;
        if (!html) return '';
        return stripWikiHtml(typeof html === 'string' ? html : html['*'] || '');
      });
    }

    /** The rendered article, for infobox fields. Costlier, so it is a separate call. */
    fetchRenderedArticle(title, subdomain) {
      return this.request(
        { action: 'parse', page: title, prop: 'text', redirects: '1' },
        subdomain,
      ).then(function (payload) {
        const html = payload && payload.parse && payload.parse.text;
        if (!html) return '';
        return typeof html === 'string' ? html : html['*'] || '';
      });
    }

    /**
     * Find the article a name refers to when the name is not the exact title.
     * Tried in order: exact title, near match, full-text search. Readers write
     * "Young Master Gu" where the wiki says "Gu Changge", so this matters more
     * than it might look.
     */
    searchTitle(term, subdomain) {
      const self = this;
      return this.request(
        {
          action: 'query',
          list: 'search',
          srsearch: term,
          srlimit: '5',
          srnamespace: '0',
          srinfo: '',
          srprop: 'snippet',
        },
        subdomain,
      ).then(function (payload) {
        const results = (payload && payload.query && payload.query.search) || [];
        if (results.length === 0) return [];
        return results.map(function (result) {
          return {
            title: result.title,
            snippet: stripWikiHtml(result.snippet || ''),
            score: WikiClient.matchScore(term, result.title),
          };
        }).sort(function (left, right) {
          return right.score - left.score;
        });
      }).then(function (results) {
        if (results.length > 0) return results;
        /* Full-text found nothing; try a prefix search, which catches names the
         * search index has not picked up on small or new wikis. */
        return self.request(
          { action: 'query', list: 'prefixsearch', pssearch: term, pslimit: '5' },
          subdomain,
        ).then(function (payload) {
          const results2 = (payload && payload.query && payload.query.prefixsearch) || [];
          return results2.map(function (result) {
            return {
              title: result.title,
              snippet: '',
              score: WikiClient.matchScore(term, result.title),
            };
          });
        });
      });
    }

    /**
     * How well a result title matches what the reader tapped. An exact match
     * wins outright; a title that contains the term beats one that merely
     * mentions it; everything else is ranked by length so that "Gu Changge"
     * beats "List of characters in ...".
     */
    static matchScore(term, title) {
      const termKey = foldKey(term);
      const titleKey = foldKey(title);
      if (termKey === titleKey) return 100;
      if (titleKey.indexOf(termKey) === 0) return 80 - Math.min(20, titleKey.length - termKey.length);
      if (titleKey.indexOf(termKey) >= 0) return 60 - Math.min(20, titleKey.length - termKey.length);
      if (termKey.indexOf(titleKey) >= 0) return 40;
      if (/^list of|^category:|disambiguation/i.test(title)) return -50;
      return 10;
    }

    static firstPage(payload) {
      const pages = payload && payload.query && payload.query.pages;
      if (!pages) return null;
      if (Array.isArray(pages)) return pages[0] || null;
      const values = Object.keys(pages).map(function (key) {
        return pages[key];
      });
      return values[0] || null;
    }

    /* --------------------------------------------------- wiki discovery --- */

    /**
     * Work out which Fandom wiki a novel belongs to, with no input from the
     * reader. Fandom subdomains are overwhelmingly the novel's title with the
     * spaces taken out, so we generate the handful of shapes that convention
     * produces and ask each one whether it exists. The first that answers, and
     * whose name resembles the novel, wins.
     *
     * This is the whole of the "zero setup" promise, so it caches hard: a
     * decision is remembered per novel for months, and a failure is remembered
     * too, so we do not re-probe six dead subdomains on every chapter.
     */
    discoverWiki(novelTitle) {
      const self = this;
      const key = 'wiki-for:' + slugify(novelTitle);
      const cached = this.store.read(key);
      if (cached != null) {
        log('wiki for "' + novelTitle + '" from cache:', cached || '(none found)');
        return Promise.resolve(cached || '');
      }

      const candidates = WikiClient.candidateSubdomains(novelTitle);
      if (candidates.length === 0) return Promise.resolve('');
      log('probing subdomains:', candidates.join(', '));

      let index = 0;
      function tryNext() {
        if (index >= candidates.length) {
          /* Remember the miss, but for a shorter time than a hit: a wiki may
           * well be created later for a novel that is currently airing. */
          self.store.write(key, '', 14);
          return Promise.resolve('');
        }
        const candidate = candidates[index];
        index += 1;
        return self.probeWiki(candidate, novelTitle).then(function (isMatch) {
          if (!isMatch) return tryNext();
          self.store.write(key, candidate, WIKI_TTL_DAYS);
          log('matched wiki:', candidate);
          return candidate;
        });
      }

      return tryNext();
    }

    /**
     * Does this subdomain exist, and is it about this novel? The sitename check
     * stops us binding to an unrelated wiki that happens to own a short slug.
     */
    probeWiki(subdomain, novelTitle) {
      return this.request({ action: 'query', meta: 'siteinfo', siprop: 'general' }, subdomain).then(
        function (payload) {
          const general = payload && payload.query && payload.query.general;
          if (!general) return false;
          const siteName = String(general.sitename || '');
          const novelWords = foldKey(novelTitle).split(' ').filter(function (word) {
            return word.length > 2;
          });
          if (novelWords.length === 0) return true;
          const siteKey = foldKey(siteName);
          const matched = novelWords.filter(function (word) {
            return siteKey.indexOf(word) >= 0;
          });
          const isMatch = matched.length >= Math.ceil(novelWords.length / 2);
          log('probe ' + subdomain + ': sitename="' + siteName + '" match=' + isMatch);
          return isMatch;
        },
      );
    }

    /**
     * The shapes a Fandom subdomain takes for a given novel title. Ordered by
     * how often each convention is the right one.
     */
    static candidateSubdomains(novelTitle) {
      const folded = foldKey(novelTitle).replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
      if (!folded) return [];

      const words = folded.split(' ').filter(Boolean);
      if (words.length === 0) return [];

      const joined = words.join('');
      const hyphenated = words.join('-');
      /* Novel titles routinely carry an article the wiki drops. */
      const withoutArticle = words.filter(function (word, position) {
        return !(position === 0 && (word === 'the' || word === 'a' || word === 'an'));
      });

      const candidates = [
        joined,
        hyphenated,
        withoutArticle.join(''),
        withoutArticle.join('-'),
        joined + 'novel',
        hyphenated + '-novel',
      ];

      /* Initialisms work surprisingly often for long titles. */
      if (words.length >= 3) {
        candidates.push(words.map(function (word) {
          return word[0];
        }).join(''));
      }

      return unique(candidates).filter(function (candidate) {
        return candidate.length >= 3 && candidate.length <= 40;
      }).slice(0, 6);
    }
  }

/* ── src/45-entity.js ────────────────────────────────────────────────── */

  /* --------------------------------------------------------------- entities */

  /**
   * Strip rendered wiki HTML down to readable prose.
   *
   * Declared as a function so it is hoisted across the whole script — the wiki
   * client above calls it, and lives in an earlier file.
   */
  function stripWikiHtml(html) {
    const text = String(html || '');

    if (typeof window.DOMParser === 'function') {
      try {
        const parsed = new window.DOMParser().parseFromString(text, 'text/html');
        const body = parsed && parsed.body;
        if (body) {
          /* Reference markers, edit links and navigation boxes are noise in a
           * summary, and citation numbers in particular read as gibberish once
           * the superscript formatting is gone. */
          const noise = body.querySelectorAll(
            'sup.reference, .reference, .mw-editsection, .navbox, .toc, ' +
              'style, script, .portable-infobox, table, .mw-empty-elt',
          );
          for (const element of Array.prototype.slice.call(noise)) {
            if (element.parentNode) element.parentNode.removeChild(element);
          }
          return (body.textContent || '').replace(/\s+/g, ' ').trim();
        }
      } catch (error) {
        /* fall through to the regex path */
      }
    }

    return text
      .replace(/<(script|style|table)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<sup[\s\S]*?<\/sup>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#0?39;|&apos;/g, "'")
      .replace(/\[\d+\]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /** Which meaning, if any, an infobox label carries. */
  function classifyFieldLabel(label) {
    const key = foldKey(label).replace(/[:：]\s*$/, '');
    if (!key) return null;
    for (const meaning of Object.keys(FIELD_ALIASES)) {
      const aliases = FIELD_ALIASES[meaning];
      for (const alias of aliases) {
        if (key === alias) return meaning;
      }
    }
    /* Loosen to a contains-match only after exact matching fails, so that
     * "Cultivation Realm" lands on rank without "Realm of Origin" hijacking it. */
    for (const meaning of Object.keys(FIELD_ALIASES)) {
      for (const alias of FIELD_ALIASES[meaning]) {
        if (alias.length >= 5 && key.indexOf(alias) >= 0) return meaning;
      }
    }
    return null;
  }

  /**
   * Pull label/value pairs out of a Fandom portable infobox.
   *
   * Parsed as a document rather than with regexes: infobox markup nests, and a
   * regex that copes with the nesting is a regex nobody can safely change later.
   */
  function parseInfobox(html) {
    const fields = {};
    if (!html || typeof window.DOMParser !== 'function') return fields;

    let document_;
    try {
      document_ = new window.DOMParser().parseFromString(html, 'text/html');
    } catch (error) {
      return fields;
    }
    if (!document_ || !document_.body) return fields;

    const infobox = document_.querySelector('.portable-infobox, .infobox, .infoboxtable');
    if (!infobox) return fields;

    /* The modern portable infobox: paired label and value elements. */
    const rows = infobox.querySelectorAll('.pi-item.pi-data, .pi-data');
    for (const row of Array.prototype.slice.call(rows)) {
      const labelElement = row.querySelector('.pi-data-label');
      const valueElement = row.querySelector('.pi-data-value');
      if (!labelElement || !valueElement) continue;
      const label = (labelElement.textContent || '').replace(/\s+/g, ' ').trim();
      const value = cleanFieldValue(valueElement);
      if (label && value) fields[label] = value;
    }

    /* Older table-shaped infoboxes, still common on long-running wikis. */
    if (Object.keys(fields).length === 0) {
      const cells = infobox.querySelectorAll('tr');
      for (const cell of Array.prototype.slice.call(cells)) {
        const header = cell.querySelector('th');
        const data = cell.querySelector('td');
        if (!header || !data) continue;
        const label = (header.textContent || '').replace(/\s+/g, ' ').trim();
        const value = cleanFieldValue(data);
        if (label && value) fields[label] = value;
      }
    }

    const image = infobox.querySelector('.pi-image img, img');
    if (image) {
      const source = image.getAttribute('src') || image.getAttribute('data-src') || '';
      if (source) fields.__image = source;
    }

    return fields;
  }

  /** A field value as text, with list items separated rather than run together. */
  function cleanFieldValue(element) {
    const clone = element.cloneNode(true);
    const noise = clone.querySelectorAll('sup, .reference, style, script, .pi-data-label');
    for (const item of Array.prototype.slice.call(noise)) {
      if (item.parentNode) item.parentNode.removeChild(item);
    }
    /* A list of affiliations would otherwise run together into one word soup. */
    for (const breakElement of Array.prototype.slice.call(clone.querySelectorAll('br, li'))) {
      if (typeof breakElement.insertAdjacentText === 'function') {
        breakElement.insertAdjacentText('afterend', ' · ');
      }
    }
    return (clone.textContent || '')
      .replace(/\s*·\s*$/, '')
      .replace(/\s+/g, ' ')
      .replace(/\s*·\s*/g, ' · ')
      .trim()
      .slice(0, 240);
  }

  /**
   * Fandom serves images through a resizing proxy. Asking for a smaller one
   * saves a meaningful amount of data on a phone, and the panel never shows a
   * portrait larger than a few hundred pixels anyway.
   */
  function scaleWikiImage(url, width) {
    const text = String(url || '');
    if (!text) return '';
    if (text.indexOf('wikia.nocookie.net') < 0) return text;
    /* Drop any existing transform, then request our own. */
    const base = text.split('/revision/')[0].split('?')[0];
    return base + '/revision/latest/scale-to-width-down/' + width;
  }

  const TAG_RULES = [
    {
      meaning: 'status',
      kind: 'fate',
      tone: function (value) {
        if (/\b(alive|living|active)\b/i.test(value)) return 'good';
        if (/\b(dead|deceased|died|killed|destroyed)\b/i.test(value)) return 'bad';
        return 'neutral';
      },
    },
    { meaning: 'race', kind: 'plain', tone: function () { return 'neutral'; } },
    { meaning: 'gender', kind: 'plain', tone: function () { return 'neutral'; } },
    { meaning: 'rank', kind: 'progress', tone: function () { return 'accent'; } },
    { meaning: 'affiliation', kind: 'plain', tone: function () { return 'accent'; } },
  ];

  /** Turn infobox fields into the little capsules along the top of the panel. */
  function buildTags(fieldsByMeaning) {
    const tags = [];
    for (const rule of TAG_RULES) {
      const value = fieldsByMeaning[rule.meaning];
      if (!value) continue;
      const parts = String(value)
        .split(/\s+·\s+|[,;]|\s+\/\s+/)
        .map(function (part) {
          return part.replace(/\([^)]*\)/g, '').trim();
        })
        .filter(function (part) {
          return part.length > 0 && part.length <= 28;
        })
        .slice(0, 2);

      for (const part of parts) {
        tags.push({
          label: part,
          tone: rule.tone(part),
          kind: rule.kind,
          /* A status of "deceased" is the single most common way a wiki spoils
           * a book in one word, so it is flagged for the spoiler guard here. */
          isFateReveal: rule.kind === 'fate' && FATE_WORDS.test(part),
        });
      }
      if (tags.length >= 6) break;
    }
    return tags.slice(0, 6);
  }

  function buildAliases(fieldsByMeaning, canonicalName) {
    const raw = String(fieldsByMeaning.alias || '');
    if (!raw) return [];
    return unique(
      raw
        .split(/\s+·\s+|[,;]|\s+\/\s+/)
        .map(function (part) {
          return part.replace(/\([^)]*\)/g, '').replace(/["“”]/g, '').trim();
        })
        .filter(function (part) {
          return (
            part.length >= 4 &&
            part.length <= 40 &&
            foldKey(part) !== foldKey(canonicalName) &&
            /^[A-Za-zÀ-￿][A-Za-z0-9À-￿\s'.-]*$/.test(part) &&
            !STOPWORDS.has(foldKey(part))
          );
        }),
    ).slice(0, 8);
  }

  /**
   * Split the summary into sections the spoiler guard can reason about, rather
   * than one opaque blob. The first couple of sentences of a wiki lead are
   * nearly always a safe "who is this", and the rest is where the trouble is.
   */
  function buildSections(extract) {
    const sentences = splitSentences(extract);
    if (sentences.length === 0) return [];

    const introCount = Math.min(2, sentences.length);
    const sections = [
      {
        title: 'Who this is',
        body: sentences.slice(0, introCount).join(' '),
        alwaysSafe: true,
      },
    ];

    if (sentences.length > introCount) {
      sections.push({
        title: 'More',
        body: sentences.slice(introCount).join(' '),
        alwaysSafe: false,
      });
    }
    return sections;
  }

  /** Wiki page + rendered article → the thing the panel renders. */
  function buildEntity(page, renderedHtml, subdomain) {
    const rawFields = parseInfobox(renderedHtml);

    const byMeaning = {};
    for (const label of Object.keys(rawFields)) {
      if (label === '__image') continue;
      const meaning = classifyFieldLabel(label);
      if (meaning && !byMeaning[meaning]) byMeaning[meaning] = rawFields[label];
    }

    const image =
      (page.thumbnail && page.thumbnail.source) ||
      rawFields.__image ||
      '';

    return {
      id: 'wiki:' + subdomain + ':' + slugify(page.title),
      name: page.title,
      title: page.title,
      aliases: buildAliases(byMeaning, page.title),
      native: byMeaning.native || '',
      romanized: byMeaning.romanized || '',
      image: scaleWikiImage(image, 480),
      url: page.fullurl || page.canonicalurl || '',
      tags: buildTags(byMeaning),
      sections: buildSections(page.extract || ''),
      firstSeen: ReaderContext.parseChapterNumber(byMeaning.firstSeen || ''),
      source: 'wiki',
      fetchedAt: Date.now(),
    };
  }

/* ── src/50-spoilers.js ──────────────────────────────────────────────── */

  /* --------------------------------------------------------- spoiler guard */

  /**
   * The reason this project exists in the shape it does.
   *
   * Looking a character up on a wiki mid-book is genuinely useful and also the
   * fastest way to have the ending handed to you: the first thing a Fandom
   * character page shows is usually an infobox with a Status field reading
   * "Deceased", and the lead paragraph tends to summarise the character's whole
   * arc including how it finishes.
   *
   * So nothing from a wiki reaches the panel without passing through here.
   * The guard works at sentence granularity, and it is deliberately biased
   * toward hiding: revealing something takes one tap and costs a second,
   * while hiding nothing costs the book.
   */
  class SpoilerGuard {
    constructor(settings) {
      this.settings = settings;
    }

    get mode() {
      return this.settings.get('spoilerGuard');
    }

    get progress() {
      return this.settings.get('chapterProgress') || 0;
    }

    get isOff() {
      return this.mode === 'off';
    }

    /**
     * Chapter, volume and book references inside wiki prose. A sentence that
     * says "In Chapter 812 he ..." is safe to show to someone past 812 and is
     * exactly what someone at chapter 300 came here to avoid.
     */
    static findReferencedChapter(sentence) {
      const patterns = [
        /\bchapters?\s*#?\s*(\d{1,5})/i,
        /\bch\.?\s*(\d{2,5})\b/i,
        /\bepisodes?\s*(\d{1,4})/i,
      ];
      let highest = 0;
      for (const pattern of patterns) {
        const match = sentence.match(pattern);
        if (match) highest = Math.max(highest, parseInt(match[1], 10));
      }
      return highest;
    }

    static readsLikeAnEnding(sentence) {
      const key = foldKey(sentence);
      for (const phrase of SPOILER_PHRASES) {
        if (key.indexOf(phrase) >= 0) return phrase;
      }
      return '';
    }

    /**
     * @returns {{hide: boolean, reason: string}}
     */
    judgeSentence(sentence, isAlwaysSafeSection) {
      if (this.isOff) return { hide: false, reason: '' };

      const referenced = SpoilerGuard.findReferencedChapter(sentence);
      if (referenced > 0) {
        if (this.progress > 0 && referenced > this.progress) {
          return { hide: true, reason: 'chapter ' + referenced };
        }
        if (this.progress === 0) {
          /* We do not know where the reader is, and the sentence is explicitly
           * about a specific chapter. Hiding is the safe half of that guess. */
          return { hide: true, reason: 'chapter ' + referenced };
        }
        return { hide: false, reason: '' };
      }

      /* The opening "who is this" lines stay visible unless they name a
       * chapter — that is the whole point of having them. */
      if (isAlwaysSafeSection) return { hide: false, reason: '' };

      if (this.mode === 'strong') {
        const phrase = SpoilerGuard.readsLikeAnEnding(sentence);
        if (phrase) return { hide: true, reason: 'plot' };
      }

      return { hide: false, reason: '' };
    }

    /**
     * Turn a section's prose into runs of visible and hidden text. Consecutive
     * hidden sentences collapse into one blurred block, so the panel does not
     * end up looking like a redacted document.
     */
    planSection(section) {
      const sentences = splitSentences(section.body);
      const runs = [];

      for (const sentence of sentences) {
        const verdict = this.judgeSentence(sentence, section.alwaysSafe);
        const previous = runs[runs.length - 1];
        if (previous && previous.hidden === verdict.hide) {
          previous.text += ' ' + sentence;
          if (verdict.reason && previous.reasons.indexOf(verdict.reason) < 0) {
            previous.reasons.push(verdict.reason);
          }
        } else {
          runs.push({
            hidden: verdict.hide,
            text: sentence,
            reasons: verdict.reason ? [verdict.reason] : [],
          });
        }
      }

      return { title: section.title, runs: runs };
    }

    /** Should this tag be masked until tapped? */
    shouldMaskTag(tag) {
      if (this.isOff) return false;
      return Boolean(tag.isFateReveal);
    }

    /**
     * A short, honest explanation of why something is hidden. Vague is better
     * than specific here — "hidden: chapter 812" already tells you the
     * character is still relevant at 812, so the reasons are summarised rather
     * than listed.
     */
    describeReasons(reasons) {
      if (!reasons || reasons.length === 0) return 'Tap to show';
      const chapterReasons = reasons.filter(function (reason) {
        return reason.indexOf('chapter ') === 0;
      });
      if (chapterReasons.length > 0) {
        const numbers = chapterReasons.map(function (reason) {
          return parseInt(reason.slice(8), 10);
        });
        const earliest = Math.min.apply(null, numbers);
        return 'From beyond chapter ' + earliest;
      }
      return 'Possible spoiler';
    }

    /** The whole entity, as the panel should draw it right now. */
    plan(entity) {
      const self = this;
      return {
        tags: (entity.tags || []).map(function (tag) {
          return Object.assign({}, tag, { masked: self.shouldMaskTag(tag) });
        }),
        sections: (entity.sections || []).map(function (section) {
          return self.planSection(section);
        }),
        /* If the wiki told us where a character debuts and the reader has not
         * got there yet, the honest thing is to say so and show nothing else. */
        isAheadOfReader:
          !this.isOff &&
          this.progress > 0 &&
          entity.firstSeen > 0 &&
          entity.firstSeen > this.progress,
      };
    }
  }

/* ── src/60-index.js ─────────────────────────────────────────────────── */

  /* ---------------------------------------------------------- entity index */

  /**
   * The term → entity map, plus the single regex used to find every known term
   * in one pass over the chapter.
   *
   * Entries arrive from three places and are ranked accordingly: a wiki article
   * we have actually fetched is certain, a name the reader has previously
   * tapped is likely, and a capitalised phrase we guessed at is a maybe. The
   * highlighter draws those three differently, so that a guess never looks like
   * a promise.
   */
  const CONFIDENCE = { CONFIRMED: 3, LIKELY: 2, GUESSED: 1 };

  class EntityIndex {
    constructor() {
      this.byKey = new Map();
      this.matcher = null;
      this.isStale = true;
    }

    get size() {
      return this.byKey.size;
    }

    get isEmpty() {
      return this.byKey.size === 0;
    }

    /**
     * @param {object} record  { name, aliases, entity, confidence }
     */
    add(record) {
      const terms = [record.name].concat(record.aliases || []);
      let added = false;

      for (const term of terms) {
        const key = foldKey(term);
        if (!key || key.length < MIN_TERM_LENGTH) continue;
        if (this.byKey.size >= MAX_INDEXED_TERMS) break;

        const existing = this.byKey.get(key);
        if (existing && existing.confidence >= record.confidence) continue;

        this.byKey.set(key, {
          term: term,
          display: term,
          entity: record.entity || null,
          confidence: record.confidence,
        });
        added = true;
      }

      if (added) this.isStale = true;
      return added;
    }

    /** Attach a fetched entity to a term that was previously only a guess. */
    resolve(term, entity) {
      const key = foldKey(term);
      const existing = this.byKey.get(key);
      if (existing) {
        existing.entity = entity;
        existing.confidence = CONFIDENCE.CONFIRMED;
      } else {
        this.add({ name: term, aliases: [], entity: entity, confidence: CONFIDENCE.CONFIRMED });
      }

      /* Index the article's real title and aliases too, so the next chapter
       * that says "Gu Changge" lights up because you once tapped "Young Master
       * Gu". This is what makes the tool get better the more you read. */
      if (entity) {
        this.add({
          name: entity.name,
          aliases: entity.aliases || [],
          entity: entity,
          confidence: CONFIDENCE.LIKELY,
        });
      }
    }

    /** Remember that a term has no article, so we stop offering it. */
    reject(term) {
      const key = foldKey(term);
      const existing = this.byKey.get(key);
      if (existing) existing.isRejected = true;
    }

    lookup(term) {
      return this.byKey.get(foldKey(term)) || null;
    }

    confidenceOf(term) {
      const record = this.lookup(term);
      return record ? record.confidence : 0;
    }

    /**
     * One regex, alternation ordered longest-first so that "Young Master Gu"
     * wins over "Gu" at the same position. Word boundaries are expressed with
     * lookaround over letters and digits rather than \b, because \b does not
     * understand non-Latin scripts and these names are frequently not Latin.
     */
    buildMatcher() {
      if (!this.isStale && this.matcher !== undefined) return this.matcher;

      const terms = [];
      for (const record of this.byKey.values()) {
        if (record.isRejected) continue;
        terms.push(record.display);
      }

      if (terms.length === 0) {
        this.matcher = null;
        this.isStale = false;
        return null;
      }

      terms.sort(function (left, right) {
        return right.length - left.length;
      });

      const alternation = terms.map(escapeRegExp).join('|');
      this.matcher = EntityIndex.compile(alternation);
      this.isStale = false;
      log('matcher built over', String(terms.length), 'terms');
      return this.matcher;
    }

    static compile(alternation) {
      try {
        return new RegExp(
          '(?<![\\p{L}\\p{N}_])(?:' + alternation + ')(?![\\p{L}\\p{N}_])',
          'giu',
        );
      } catch (error) {
        /* Lookbehind or Unicode property escapes unsupported — older WebViews.
         * \b is a worse boundary but a working one. */
        try {
          return new RegExp('\\b(?:' + alternation + ')\\b', 'gi');
        } catch (fallbackError) {
          log('could not compile matcher:', (fallbackError && fallbackError.message) || '');
          return null;
        }
      }
    }
  }

/* ── src/65-detect.js ────────────────────────────────────────────────── */

  /* ------------------------------------------------------- name detection */

  /**
   * Find the names in a chapter without being told any of them in advance.
   *
   * This is what lets LoreLens work the moment it is pasted in, before it knows
   * anything about the book. It is a heuristic and it is wrong sometimes, which
   * is why what it produces is marked as a guess and drawn more quietly than a
   * name we have confirmed against the wiki.
   *
   * The core signal is simple and holds up well across translated web fiction:
   * a capitalised phrase that appears more than once, is not sitting at the
   * start of a sentence, and is not a common word, is almost always a name, a
   * place, a sect, or a technique — in other words, exactly the set of things
   * a reader loses track of.
   */
  class NameDetector {
    constructor(settings) {
      this.settings = settings;
    }

    get minOccurrences() {
      const detection = this.settings.get('detection');
      if (detection === 'generous') return 1;
      if (detection === 'strict') return 3;
      return 2;
    }

    /**
     * @returns {Array<{phrase: string, count: number, score: number}>}
     */
    detect(text) {
      const candidates = this.collectCandidates(text);
      const minimum = this.minOccurrences;

      const results = [];
      for (const [phrase, record] of candidates) {
        if (record.count < minimum) continue;
        /* A phrase that only ever appears at the start of a sentence is
         * capitalised by grammar, not because it names anything. */
        if (record.midSentenceCount === 0 && phrase.indexOf(' ') === -1) continue;
        results.push({
          phrase: record.display,
          count: record.count,
          score: NameDetector.score(record),
        });
      }

      results.sort(function (left, right) {
        return right.score - left.score;
      });

      log('detected', String(results.length), 'candidate names');
      return results;
    }

    collectCandidates(text) {
      const found = new Map();

      /* A run of capitalised words, allowing the lowercase connectors that
       * appear inside real names — "Sect of the Azure Cloud", "Lord of Death". */
      const pattern = new RegExp(
        '[A-Z\\u00C0-\\u024F][\\w\\u00C0-\\u024F\'-]*' +
          '(?:\\s+(?:of|the|de|van|der|du|di|el|al)\\s+[A-Z\\u00C0-\\u024F][\\w\\u00C0-\\u024F\'-]*' +
          '|\\s+[A-Z\\u00C0-\\u024F][\\w\\u00C0-\\u024F\'-]*){0,' + (MAX_TERM_WORDS - 1) + '}',
        'g',
      );

      let match = pattern.exec(text);
      while (match !== null) {
        const raw = match[0].replace(/[\s'-]+$/, '').trim();

        /* "The Immortal Ascension Ritual" at the start of a sentence matches
         * with its capitalised article attached. Rejecting the whole phrase
         * because it opens with a stopword loses that occurrence entirely, and
         * a name that only ever appears after "The" then never reaches the
         * occurrence threshold. Strip the article and keep the name. */
        const phrase = NameDetector.stripLeadingStopwords(raw);

        if (this.isPlausible(phrase)) {
          const key = foldKey(phrase);
          const record = found.get(key) || {
            display: phrase,
            count: 0,
            midSentenceCount: 0,
            words: phrase.split(/\s+/).length,
          };
          record.count += 1;
          /* Having stripped a leading word, the name itself is not at the start
           * of the sentence, whatever the match offset says. */
          if (phrase !== raw || !NameDetector.isSentenceInitial(text, match.index)) {
            record.midSentenceCount += 1;
          }
          found.set(key, record);
        }
        match = pattern.exec(text);
        /* Zero-length match guard: a malformed pattern must not spin forever. */
        if (match && match.index === pattern.lastIndex) pattern.lastIndex += 1;
      }

      return found;
    }

    /** Drop leading articles and conjunctions, but never everything. */
    static stripLeadingStopwords(phrase) {
      const words = phrase.split(/\s+/);
      while (words.length > 1 && STOPWORDS.has(foldKey(words[0]))) {
        words.shift();
      }
      return words.join(' ');
    }

    isPlausible(phrase) {
      if (phrase.length < MIN_TERM_LENGTH || phrase.length > 60) return false;

      const words = phrase.split(/\s+/);
      if (words.length > MAX_TERM_WORDS) return false;

      /* Every word being a stopword means this is a sentence fragment. */
      const meaningful = words.filter(function (word) {
        return !STOPWORDS.has(foldKey(word));
      });
      if (meaningful.length === 0) return false;

      /* A leading stopword means the capital came from punctuation. */
      if (STOPWORDS.has(foldKey(words[0]))) return false;

      /* Roman numerals, ordinals and bare numbers are chapter furniture. */
      if (/^[IVXLCDM]+$/.test(phrase)) return false;
      if (/^\d/.test(phrase)) return false;

      /* ALL CAPS is shouting, not a name. */
      if (phrase === phrase.toUpperCase() && phrase.length > 3) return false;

      return true;
    }

    /** Is the character at this offset the first word of a sentence? */
    static isSentenceInitial(text, offset) {
      if (offset === 0) return true;
      const before = text.slice(Math.max(0, offset - 30), offset);
      return /(?:^|[.!?:;“”"’]\s*|\n\s*)$/.test(before);
    }

    /**
     * Rank candidates so that prefetching spends its budget on the names the
     * reader is most likely to tap.
     */
    static score(record) {
      let score = record.count * 10;
      /* Appearing mid-sentence is the strongest single signal of a real name. */
      score += record.midSentenceCount * 6;
      /* Two- and three-word phrases are more often real entities than one word. */
      if (record.words === 2) score += 12;
      else if (record.words === 3) score += 8;
      else if (record.words === 1) score -= 6;
      return score;
    }
  }

/* ── src/70-highlighter.js ───────────────────────────────────────────── */

  /* ---------------------------------------------------------- highlighting */

  /**
   * Marks known names in the chapter.
   *
   * There are two ways to do this and the difference matters a great deal.
   *
   * The obvious way is to wrap each match in a <span>. It works everywhere, and
   * it quietly wrecks the reading experience: selecting a sentence that
   * contains a highlight produces fragmented selection, text-to-speech engines
   * treat the span boundary as a pause or skip it entirely, and the reader's
   * own scripts get a DOM that no longer matches what they rendered. People
   * notice. They just cannot always say why the app got worse.
   *
   * The better way is the CSS Custom Highlight API: ranges are registered with
   * the browser and painted, and the DOM is never touched at all. Selection,
   * speech and every other consumer of the text see exactly what the reader
   * rendered. Taps are resolved by hit-testing the caret position against the
   * stored ranges.
   *
   * So: Custom Highlight API where it exists, span wrapping where it does not,
   * and the rest of the program does not care which one ran.
   */
  class Highlighter {
    constructor(index, settings) {
      this.index = index;
      this.settings = settings;
      this.ranges = [];
      this.wrappedElements = [];
      this.mode = Highlighter.pickMode();
      log('highlight mode:', this.mode);
    }

    static pickMode() {
      const hasHighlightApi =
        typeof window.CSS !== 'undefined' &&
        window.CSS.highlights &&
        typeof window.Highlight === 'function' &&
        typeof document.createRange === 'function';

      if (!hasHighlightApi) return 'wrap';

      /* The API is useless to us without a way to work out what was tapped. */
      const canHitTest =
        typeof document.caretRangeFromPoint === 'function' ||
        typeof document.caretPositionFromPoint === 'function';

      return canHitTest ? 'highlight' : 'wrap';
    }

    clear() {
      if (this.mode === 'highlight') {
        try {
          window.CSS.highlights.delete(HIGHLIGHT_NAME);
          window.CSS.highlights.delete(HIGHLIGHT_NAME + '-guess');
        } catch (error) {
          /* nothing registered yet */
        }
      } else {
        for (const element of this.wrappedElements) {
          Highlighter.unwrap(element);
        }
      }
      this.ranges = [];
      this.wrappedElements = [];
    }

    static unwrap(element) {
      const parent = element.parentNode;
      if (!parent) return;
      while (element.firstChild) parent.insertBefore(element.firstChild, element);
      parent.removeChild(element);
      if (parent.normalize) parent.normalize();
    }

    /**
     * Walk the chapter and mark every match. Work is spread across frames so
     * that a very long chapter cannot make the first scroll stutter — the
     * reader always wins a fight with the highlighter.
     */
    run(root, onComplete) {
      const matcher = this.index.buildMatcher();
      if (!matcher) {
        if (onComplete) onComplete(0);
        return;
      }

      this.clear();
      const textNodes = this.collectTextNodes(root);
      const self = this;
      const seenInBlock = new Map();
      let cursor = 0;
      let matchCount = 0;

      function processBatch() {
        const end = Math.min(cursor + NODES_PER_BATCH, textNodes.length);
        for (; cursor < end; cursor += 1) {
          matchCount += self.markNode(textNodes[cursor], matcher, seenInBlock);
        }

        if (cursor < textNodes.length) {
          whenIdle(processBatch);
          return;
        }

        self.commit();
        log('highlighted', String(matchCount), 'mentions');
        if (onComplete) onComplete(matchCount);
      }

      processBatch();
    }

    collectTextNodes(root) {
      const nodes = [];
      if (!root || typeof document.createTreeWalker !== 'function') return nodes;

      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode: function (node) {
          const value = node.nodeValue;
          if (!value || value.trim().length < MIN_TERM_LENGTH) return NodeFilter.FILTER_REJECT;
          const parent = node.parentElement;
          if (!parent) return NodeFilter.FILTER_REJECT;
          try {
            if (parent.closest(SKIP_SELECTOR)) return NodeFilter.FILTER_REJECT;
          } catch (error) {
            /* closest() with a selector this engine dislikes — keep the node */
          }
          return NodeFilter.FILTER_ACCEPT;
        },
      });

      let node = walker.nextNode();
      while (node !== null) {
        nodes.push(node);
        node = walker.nextNode();
      }
      return nodes;
    }

    /** @returns the number of mentions marked in this node. */
    markNode(node, matcher, seenInBlock) {
      if (!node.parentNode) return 0;
      const text = node.nodeValue;
      matcher.lastIndex = 0;

      const firstOnly = this.settings.get('firstMentionOnly');
      const block = firstOnly ? Highlighter.blockAncestor(node) : null;

      const hits = [];
      let match = matcher.exec(text);
      while (match !== null) {
        const term = match[0];
        const record = this.index.lookup(term);

        if (record && !record.isRejected) {
          let allow = true;
          if (firstOnly && block) {
            let seen = seenInBlock.get(block);
            if (!seen) {
              seen = new Set();
              seenInBlock.set(block, seen);
            }
            const key = foldKey(term);
            if (seen.has(key)) allow = false;
            else seen.add(key);
          }

          if (allow) {
            hits.push({ start: match.index, end: match.index + term.length, term: term, record: record });
          }
        }

        if (match.index === matcher.lastIndex) matcher.lastIndex += 1;
        match = matcher.exec(text);
      }

      if (hits.length === 0) return 0;

      if (this.mode === 'highlight') this.addRanges(node, hits);
      else this.wrapHits(node, hits);

      return hits.length;
    }

    /** The paragraph-ish element a node sits in, for first-mention-only. */
    static blockAncestor(node) {
      let element = node.parentElement;
      while (element) {
        const display = ReaderContext.computed(element, 'display');
        if (display && display.indexOf('inline') !== 0) return element;
        element = element.parentElement;
      }
      return null;
    }

    /* ---------------------------------------------- Custom Highlight path */

    addRanges(node, hits) {
      for (const hit of hits) {
        try {
          const range = document.createRange();
          range.setStart(node, hit.start);
          range.setEnd(node, hit.end);
          this.ranges.push({
            range: range,
            term: hit.term,
            confidence: hit.record.confidence,
          });
        } catch (error) {
          /* A node that moved under us mid-walk. Skip it. */
        }
      }
    }

    /**
     * Register the collected ranges in two buckets so that confirmed names and
     * guesses can be painted differently — a guess should look like an offer,
     * not a fact.
     */
    commit() {
      if (this.mode !== 'highlight' || this.ranges.length === 0) return;
      try {
        const confirmed = [];
        const guessed = [];
        for (const entry of this.ranges) {
          (entry.confidence >= CONFIDENCE.LIKELY ? confirmed : guessed).push(entry.range);
        }
        if (confirmed.length > 0) {
          window.CSS.highlights.set(HIGHLIGHT_NAME, Highlighter.makeHighlight(confirmed));
        }
        if (guessed.length > 0) {
          window.CSS.highlights.set(HIGHLIGHT_NAME + '-guess', Highlighter.makeHighlight(guessed));
        }
      } catch (error) {
        log('could not register highlights, falling back to wrapping:', (error && error.message) || '');
        this.mode = 'wrap';
      }
    }

    static makeHighlight(ranges) {
      const highlight = new window.Highlight();
      for (const range of ranges) highlight.add(range);
      return highlight;
    }

    /**
     * Which term is under this point? Used because a registered highlight is
     * painted, not clickable — the browser gives it no identity in the event
     * stream, so we resolve the tap ourselves.
     */
    termAtPoint(x, y) {
      if (this.mode !== 'highlight') return null;

      let caret = null;
      try {
        if (typeof document.caretRangeFromPoint === 'function') {
          caret = document.caretRangeFromPoint(x, y);
        } else if (typeof document.caretPositionFromPoint === 'function') {
          const position = document.caretPositionFromPoint(x, y);
          if (position) {
            caret = document.createRange();
            caret.setStart(position.offsetNode, position.offset);
          }
        }
      } catch (error) {
        return null;
      }
      if (!caret) return null;

      for (const entry of this.ranges) {
        try {
          if (entry.range.isPointInRange(caret.startContainer, caret.startOffset)) {
            return entry.term;
          }
        } catch (error) {
          /* range detached by a DOM change; ignore it */
        }
      }
      return null;
    }

    /* ------------------------------------------------------- wrapping path */

    wrapHits(node, hits) {
      const text = node.nodeValue;
      const fragment = document.createDocumentFragment();
      let cursor = 0;

      for (const hit of hits) {
        if (hit.start > cursor) {
          fragment.appendChild(document.createTextNode(text.slice(cursor, hit.start)));
        }
        const span = document.createElement('span');
        span.className =
          MARK_CLASS + (hit.record.confidence >= CONFIDENCE.LIKELY ? '' : ' ' + MARK_CLASS + '--guess');
        span.setAttribute('data-lorelens-term', hit.term);
        span.textContent = text.slice(hit.start, hit.end);
        fragment.appendChild(span);
        this.wrappedElements.push(span);
        cursor = hit.end;
      }

      if (cursor < text.length) {
        fragment.appendChild(document.createTextNode(text.slice(cursor)));
      }

      if (node.parentNode) node.parentNode.replaceChild(fragment, node);
    }
  }

/* ── src/80-styles.js ────────────────────────────────────────────────── */

  /* ------------------------------------------------------------- styling */

  /**
   * All of LoreLens's CSS, generated from the palette we read off the page so
   * that the panel belongs to whatever theme the reader is using rather than
   * fighting it.
   *
   * Everything is scoped under .lorelens-ui or a lorelens- prefix. Nothing here
   * may style a bare element selector: this stylesheet is a guest in someone
   * else's document and a rule on `p` or `button` would leak into the chapter.
   */
  /**
   * The declarations a marked name is painted with.
   *
   * Split out because the same rules have to serve both the painted path and
   * the wrapping fallback, and because only a subset of CSS applies inside
   * ::highlight() — anything that would move text is ignored there. That is why
   * weight is faked with a tight text-shadow rather than set with font-weight,
   * which the browser silently drops. The shadow also avoids reflowing the
   * paragraph, which real bold would do on the wrapping path.
   */
  function buildMarkRules(palette, settings) {
    const choice = settings ? settings.get('highlightColor') : 'violet';
    const entry = MARK_COLORS[choice];
    const color = choice === 'theme' || !entry
      ? palette.accent
      : (palette.isDark ? entry.dark : entry.light);

    const solid = toCss(color);
    const wash = toCss(color, palette.isDark ? 0.26 : 0.17);
    const washFaint = toCss(color, palette.isDark ? 0.13 : 0.08);
    const fauxBold = 'text-shadow:0 0 .5px ' + solid + ',0 0 .5px ' + solid + ';';
    const style = (settings && settings.get('highlightStyle')) || 'marker';

    if (style === 'underline') {
      return {
        confirmed:
          'color:' + solid + ';text-decoration:underline;text-decoration-color:' +
          toCss(color, 0.7) + ';text-decoration-thickness:2px;text-underline-offset:3px;',
        guessed:
          'color:' + toCss(color, 0.75) + ';text-decoration:underline dotted;' +
          'text-decoration-color:' + toCss(color, 0.45) + ';text-underline-offset:3px;',
        pressed: wash,
      };
    }

    if (style === 'bold') {
      return {
        confirmed: 'color:' + solid + ';' + fauxBold,
        guessed: 'color:' + toCss(color, 0.72) + ';',
        pressed: wash,
      };
    }

    /* 'marker' — a wash behind the word, the way a highlighter pen reads.
     * No solid underline anywhere, so it cannot be mistaken for a link.
     *
     * A guess gets a dotted underline rather than just a fainter wash. A wash
     * alone at low enough opacity to read as "unsure" is too faint to notice at
     * all on a phone, which makes the marking pointless — dotted reads as
     * tentative while staying visible, and dotted-and-violet is nobody's idea
     * of a hyperlink. */
    return {
      confirmed: 'color:' + solid + ';background-color:' + wash + ';' + fauxBold,
      guessed:
        'color:' + toCss(color, 0.92) + ';background-color:' + washFaint + ';' +
        'text-decoration:underline dotted;text-decoration-color:' + toCss(color, 0.6) +
        ';text-underline-offset:3px;',
      pressed: toCss(color, palette.isDark ? 0.42 : 0.3),
    };
  }

  function buildStyleSheet(palette, settings) {
    const mark = buildMarkRules(palette, settings);
    const accent = toCss(palette.accent);
    const accentSoft = toCss(palette.accent, 0.16);
    const surface = toCss(palette.surface);
    const surfaceRaised = toCss(palette.surfaceRaised);
    const text = toCss(palette.foreground);
    const muted = palette.muted;
    const outline = palette.outline;
    const outlineStrong = palette.outlineStrong;

    return [
      /* ---- how a known name looks in the prose ---- */

      '::highlight(' + HIGHLIGHT_NAME + '){' + mark.confirmed + '}',
      '::highlight(' + HIGHLIGHT_NAME + '-guess){' + mark.guessed + '}',

      /* The wrapping fallback must look the same as the painted version, so it
       * uses the same declarations plus the few a real element can carry. */
      '.' + MARK_CLASS + '{' + mark.confirmed +
      'cursor:pointer;border-radius:3px;padding:0 1px;margin:0 -1px;',
      '-webkit-tap-highlight-color:transparent;}',
      '.' + MARK_CLASS + '--guess{' + mark.guessed + '}',
      '.' + MARK_CLASS + ':active{background-color:' + mark.pressed + ';}',

      /* ---- shared shell ---- */

      '.lorelens-ui{',
      'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;',
      'font-size:15px;line-height:1.5;color:' + text + ';',
      'box-sizing:border-box;-webkit-tap-highlight-color:transparent;}',
      '.lorelens-ui *{box-sizing:border-box;}',

      '.lorelens-scrim{',
      'position:fixed;inset:0;z-index:2147483000;',
      'background:' + palette.scrim + ';',
      'opacity:0;pointer-events:none;transition:opacity .2s ease;}',
      '.lorelens-scrim.is-open{opacity:1;pointer-events:auto;}',

      '.lorelens-panel{',
      'position:fixed;left:0;right:0;bottom:0;z-index:2147483001;',
      'max-height:82vh;display:flex;flex-direction:column;',
      'background:' + surface + ';',
      'border-top:1px solid ' + outline + ';',
      'border-radius:18px 18px 0 0;',
      'box-shadow:0 -10px 40px rgba(0,0,0,.35);',
      'transform:translateY(101%);',
      'transition:transform .28s cubic-bezier(.22,1,.36,1);',
      'padding-bottom:env(safe-area-inset-bottom,0px);}',
      '.lorelens-panel.is-open{transform:translateY(0);}',

      /* Wider screens get a card rather than a sheet that swallows the page. */
      '@media (min-width:760px){.lorelens-panel{',
      'left:auto;right:20px;bottom:20px;width:400px;max-height:78vh;',
      'border-radius:16px;border:1px solid ' + outline + ';',
      'transform:translateY(calc(100% + 24px));}}',

      '@media (prefers-reduced-motion:reduce){',
      '.lorelens-panel,.lorelens-scrim{transition:none;}}',

      /* ---- panel chrome ---- */

      '.lorelens-grip{flex:none;width:38px;height:4px;border-radius:99px;',
      'margin:9px auto 2px;background:' + outlineStrong + ';}',

      '.lorelens-scroll{overflow-y:auto;-webkit-overflow-scrolling:touch;',
      'padding:6px 18px 18px;overscroll-behavior:contain;}',

      '.lorelens-head{display:flex;align-items:flex-start;gap:12px;padding:8px 0 0;}',
      '.lorelens-portrait{flex:none;width:74px;height:74px;border-radius:12px;',
      'overflow:hidden;background:' + surfaceRaised + ';}',
      '.lorelens-portrait img{width:100%;height:100%;object-fit:cover;display:block;}',
      '.lorelens-titles{flex:1;min-width:0;}',
      '.lorelens-name{margin:0;font-size:19px;font-weight:650;line-height:1.25;',
      'letter-spacing:-.01em;word-break:break-word;}',
      '.lorelens-native{margin:3px 0 0;font-size:13px;color:' + muted + ';}',
      '.lorelens-alsoknown{margin:5px 0 0;font-size:12.5px;color:' + muted + ';}',

      /* ---- tags ---- */

      '.lorelens-tags{display:flex;flex-wrap:wrap;gap:6px;margin:12px 0 0;}',
      '.lorelens-tag{font-size:11.5px;font-weight:600;letter-spacing:.02em;',
      'padding:4px 9px;border-radius:99px;white-space:nowrap;',
      'background:' + surfaceRaised + ';color:' + muted + ';}',
      '.lorelens-tag--accent{background:' + accentSoft + ';color:' + accent + ';}',
      '.lorelens-tag--good{background:rgba(52,168,110,.18);color:#3fae7a;}',
      '.lorelens-tag--bad{background:rgba(206,74,74,.18);color:#d76b6b;}',
      /* A masked tag must not leak its content through its own width. */
      '.lorelens-tag--masked{background:' + surfaceRaised + ';color:' + muted + ';',
      'cursor:pointer;font-style:italic;}',

      /* ---- body sections ---- */

      '.lorelens-section{margin:16px 0 0;}',
      '.lorelens-section-title{margin:0 0 5px;font-size:11px;font-weight:700;',
      'letter-spacing:.1em;text-transform:uppercase;color:' + muted + ';}',
      '.lorelens-text{margin:0;font-size:14.5px;line-height:1.6;}',
      '.lorelens-run{}',

      '.lorelens-hidden{position:relative;display:block;margin:6px 0;',
      'padding:10px 12px;border-radius:10px;cursor:pointer;',
      'background:' + surfaceRaised + ';border:1px dashed ' + outlineStrong + ';}',
      '.lorelens-hidden-label{display:flex;align-items:center;gap:7px;',
      'font-size:12.5px;font-weight:600;color:' + muted + ';}',
      '.lorelens-hidden-label::before{content:"";width:13px;height:13px;flex:none;',
      'border-radius:3px;background:' + outlineStrong + ';}',
      '.lorelens-hidden-hint{margin:3px 0 0;font-size:11.5px;color:' + muted + ';',
      'opacity:.85;}',

      /* ---- footer ---- */

      '.lorelens-foot{display:flex;gap:8px;align-items:center;flex-wrap:wrap;',
      'margin:18px 0 0;padding-top:13px;border-top:1px solid ' + outline + ';}',
      '.lorelens-btn{font:inherit;font-size:13px;font-weight:600;cursor:pointer;',
      'padding:8px 13px;border-radius:9px;border:1px solid ' + outline + ';',
      'background:transparent;color:' + text + ';text-decoration:none;',
      'display:inline-flex;align-items:center;gap:6px;}',
      '.lorelens-btn--primary{background:' + accentSoft + ';color:' + accent + ';',
      'border-color:transparent;}',
      '.lorelens-btn:active{background:' + surfaceRaised + ';}',
      '.lorelens-spacer{flex:1;}',

      /* ---- states ---- */

      '.lorelens-state{padding:22px 4px 12px;text-align:center;}',
      '.lorelens-state-title{margin:0 0 6px;font-size:16px;font-weight:650;}',
      '.lorelens-state-body{margin:0;font-size:13.5px;color:' + muted + ';line-height:1.55;}',
      '.lorelens-spinner{width:20px;height:20px;margin:0 auto 12px;border-radius:50%;',
      'border:2px solid ' + outline + ';border-top-color:' + accent + ';',
      'animation:lorelens-spin .7s linear infinite;}',
      '@keyframes lorelens-spin{to{transform:rotate(360deg);}}',
      '@media (prefers-reduced-motion:reduce){.lorelens-spinner{animation-duration:2s;}}',

      /* ---- choices (disambiguation) ---- */

      '.lorelens-choice{display:block;width:100%;text-align:left;font:inherit;',
      'font-size:14px;padding:11px 12px;margin:6px 0 0;cursor:pointer;',
      'border-radius:10px;border:1px solid ' + outline + ';',
      'background:transparent;color:' + text + ';}',
      '.lorelens-choice-sub{display:block;margin-top:3px;font-size:12px;color:' + muted + ';}',

      /* ---- floating buttons ---- */

      '.lorelens-fabs{position:fixed;z-index:2147482999;right:14px;',
      'bottom:calc(16px + env(safe-area-inset-bottom,0px));',
      'display:flex;flex-direction:column;gap:8px;}',
      '.lorelens-fab{',
      'width:38px;height:38px;border-radius:50%;cursor:pointer;padding:0;',
      'display:flex;align-items:center;justify-content:center;',
      'font-size:15px;font-weight:700;letter-spacing:-.02em;',
      'border:1px solid ' + outline + ';background:' + surface + ';color:' + accent + ';',
      'box-shadow:0 3px 12px rgba(0,0,0,.22);opacity:.5;transition:opacity .2s ease;}',
      '.lorelens-fab:active{opacity:1;}',

      /* ---- the power-system ladder ---- */

      '.lorelens-ladder{list-style:none;margin:14px 0 0;padding:0;',
      'counter-reset:lorelens-rung;}',
      '.lorelens-rung{display:flex;align-items:baseline;gap:10px;',
      'padding:7px 9px;border-radius:8px;font-size:14.5px;}',
      '.lorelens-rung+.lorelens-rung{margin-top:2px;}',
      '.lorelens-rung-n{flex:none;min-width:1.4em;font-size:11.5px;font-weight:700;',
      'font-variant-numeric:tabular-nums;color:' + muted + ';}',
      '.lorelens-rung-name{flex:1;min-width:0;}',
      '.lorelens-rung-tag{flex:none;font-size:10.5px;font-weight:700;',
      'letter-spacing:.04em;text-transform:uppercase;padding:2px 7px;border-radius:99px;',
      'background:' + accentSoft + ';color:' + accent + ';}',
      /* The rung the chapter is actually talking about, so the ladder answers
       * "where am I" as well as "what is the order". */
      '.lorelens-rung.is-here{background:' + toCss(palette.accent, 0.09) + ';',
      'box-shadow:inset 2px 0 0 ' + accent + ';}',
      '.lorelens-rung.is-here .lorelens-rung-name{font-weight:650;}',

      /* ---- selection lookup bubble ---- */

      '.lorelens-bubble{position:absolute;z-index:2147483002;',
      'padding:7px 12px;border-radius:9px;cursor:pointer;font-size:13px;font-weight:600;',
      'background:' + surfaceRaised + ';color:' + accent + ';',
      'border:1px solid ' + outline + ';box-shadow:0 3px 14px rgba(0,0,0,.3);',
      'transform:translate(-50%,-100%);white-space:nowrap;}',

      /* ---- settings form ---- */

      '.lorelens-field{margin:14px 0 0;}',
      '.lorelens-label{display:block;font-size:13px;font-weight:600;margin-bottom:5px;}',
      '.lorelens-help{margin:4px 0 0;font-size:12px;color:' + muted + ';line-height:1.45;}',
      '.lorelens-input,.lorelens-select{width:100%;font:inherit;font-size:14px;',
      'padding:9px 11px;border-radius:9px;color:' + text + ';',
      'border:1px solid ' + outline + ';background:' + surfaceRaised + ';}',
      '.lorelens-row{display:flex;align-items:center;justify-content:space-between;',
      'gap:12px;padding:11px 0;border-bottom:1px solid ' + outline + ';}',
      '.lorelens-row:last-child{border-bottom:none;}',
      '.lorelens-row-text{flex:1;min-width:0;}',
      '.lorelens-toggle{flex:none;width:44px;height:26px;border-radius:99px;',
      'cursor:pointer;position:relative;border:none;padding:0;',
      'background:' + outlineStrong + ';transition:background .18s ease;}',
      '.lorelens-toggle::after{content:"";position:absolute;top:3px;left:3px;',
      'width:20px;height:20px;border-radius:50%;background:' + surface + ';',
      'transition:transform .18s ease;}',
      '.lorelens-toggle.is-on{background:' + accent + ';}',
      '.lorelens-toggle.is-on::after{transform:translateX(18px);}',
      '@media (prefers-reduced-motion:reduce){',
      '.lorelens-toggle,.lorelens-toggle::after{transition:none;}}',

      '.lorelens-meta{margin:16px 0 0;font-size:11.5px;color:' + muted + ';',
      'text-align:center;line-height:1.6;}',
    ].join('');
  }

  /** Install or replace the stylesheet. Called again whenever the theme moves. */
  function applyStyleSheet(palette, settings) {
    let style = document.getElementById('lorelens-styles');
    if (!style) {
      style = document.createElement('style');
      style.id = 'lorelens-styles';
      (document.head || document.documentElement).appendChild(style);
    }
    style.textContent = buildStyleSheet(palette, settings);
  }

/* ── src/82-panel.js ─────────────────────────────────────────────────── */

  /* ----------------------------------------------------------------- panel */

  /**
   * The sheet that slides up when you tap a name.
   *
   * Every string that comes from a wiki goes through escapeHtml or escapeUrl on
   * the way in. Wiki content is user-generated content from a site we do not
   * control, rendered inside the reader's own page — treating it as trusted
   * would mean any wiki editor could run code in someone's reader.
   */
  class Panel {
    constructor(options) {
      this.guard = options.spoilerGuard;
      this.onAction = options.onAction || function () {};
      this.isOpen = false;
      this.lastFocused = null;
      this.build();
    }

    build() {
      this.scrim = document.createElement('div');
      this.scrim.className = 'lorelens-ui lorelens-scrim';

      this.panel = document.createElement('div');
      this.panel.className = 'lorelens-ui lorelens-panel';
      this.panel.setAttribute('role', 'dialog');
      this.panel.setAttribute('aria-modal', 'true');
      this.panel.setAttribute('aria-label', 'LoreLens');

      this.grip = document.createElement('div');
      this.grip.className = 'lorelens-grip';

      this.scroll = document.createElement('div');
      this.scroll.className = 'lorelens-scroll';

      this.panel.appendChild(this.grip);
      this.panel.appendChild(this.scroll);

      const body = document.body || document.documentElement;
      body.appendChild(this.scrim);
      body.appendChild(this.panel);

      this.bindEvents();
    }

    bindEvents() {
      const self = this;

      this.scrim.addEventListener('click', guard('panel.scrim', function () {
        self.close();
      }));

      document.addEventListener('keydown', guard('panel.key', function (event) {
        if (event.key === 'Escape' && self.isOpen) {
          event.preventDefault();
          self.close();
        }
      }));

      /* One delegated handler for everything inside the panel, so that
       * re-rendering the contents never leaves stale listeners behind. */
      this.panel.addEventListener('click', guard('panel.click', function (event) {
        /* closest() is missing on some nodes in older engines, and on SVG
         * elements in a few of them. A missing handler is better than a throw. */
        if (!event.target || typeof event.target.closest !== 'function') return;
        const target = event.target.closest('[data-lorelens-action]');
        if (!target) return;
        const action = target.getAttribute('data-lorelens-action');
        const value = target.getAttribute('data-lorelens-value') || '';

        if (action === 'close') {
          self.close();
          return;
        }
        if (action === 'reveal') {
          Panel.revealHidden(target);
          return;
        }
        if (action === 'reveal-tag') {
          target.textContent = target.getAttribute('data-lorelens-label') || '';
          target.className = 'lorelens-tag lorelens-tag--' + (target.getAttribute('data-lorelens-tone') || 'neutral');
          target.removeAttribute('data-lorelens-action');
          return;
        }
        self.onAction(action, value, event);
      }));

      /* Swipe the sheet down to dismiss — the gesture people already expect. */
      let startY = 0;
      let isDragging = false;

      this.grip.addEventListener('touchstart', guard('panel.dragstart', function (event) {
        startY = event.touches[0].clientY;
        isDragging = true;
      }), { passive: true });

      this.panel.addEventListener('touchmove', guard('panel.drag', function (event) {
        if (!isDragging) return;
        const delta = event.touches[0].clientY - startY;
        if (delta > 0) self.panel.style.transform = 'translateY(' + delta + 'px)';
      }), { passive: true });

      this.panel.addEventListener('touchend', guard('panel.dragend', function (event) {
        if (!isDragging) return;
        isDragging = false;
        const delta = (event.changedTouches[0] || {}).clientY - startY;
        self.panel.style.transform = '';
        if (delta > 90) self.close();
      }));
    }

    static revealHidden(element) {
      const text = element.getAttribute('data-lorelens-text') || '';
      const replacement = document.createElement('span');
      replacement.className = 'lorelens-run';
      replacement.textContent = text;
      if (element.parentNode) element.parentNode.replaceChild(replacement, element);
    }

    open() {
      if (!this.isOpen) {
        this.lastFocused = document.activeElement;
        this.isOpen = true;
      }
      this.scrim.classList.add('is-open');
      this.panel.classList.add('is-open');
      this.scroll.scrollTop = 0;
    }

    close() {
      this.isOpen = false;
      this.scrim.classList.remove('is-open');
      this.panel.classList.remove('is-open');
      this.panel.style.transform = '';
      if (this.lastFocused && typeof this.lastFocused.focus === 'function') {
        try {
          this.lastFocused.focus();
        } catch (error) {
          /* the element went away with the chapter */
        }
      }
    }

    setContent(html) {
      this.scroll.innerHTML = html;
    }

    /* ------------------------------------------------------------ states -- */

    showLoading(term) {
      this.setContent(
        '<div class="lorelens-state">' +
          '<div class="lorelens-spinner"></div>' +
          '<p class="lorelens-state-title">' + escapeHtml(term) + '</p>' +
          '<p class="lorelens-state-body">Looking this up&hellip;</p>' +
          '</div>' +
          Panel.footer([{ action: 'close', label: 'Close' }]),
      );
      this.open();
    }

    showMessage(title, body, actions) {
      this.setContent(
        '<div class="lorelens-state">' +
          '<p class="lorelens-state-title">' + escapeHtml(title) + '</p>' +
          '<p class="lorelens-state-body">' + escapeHtml(body) + '</p>' +
          '</div>' +
          Panel.footer(actions || [{ action: 'close', label: 'Close' }]),
      );
      this.open();
    }

    /** Several articles could be the one meant. Let the reader pick. */
    showChoices(term, choices) {
      const items = choices
        .map(function (choice) {
          return (
            '<button class="lorelens-choice" data-lorelens-action="choose" ' +
            'data-lorelens-value="' + escapeHtml(choice.title) + '">' +
            escapeHtml(choice.title) +
            (choice.snippet
              ? '<span class="lorelens-choice-sub">' + escapeHtml(choice.snippet.slice(0, 90)) + '</span>'
              : '') +
            '</button>'
          );
        })
        .join('');

      this.setContent(
        '<div class="lorelens-section">' +
          '<p class="lorelens-section-title">Which one is ' + escapeHtml(term) + '?</p>' +
          items +
          '</div>' +
          Panel.footer([{ action: 'close', label: 'Close' }]),
      );
      this.open();
    }

    /* ------------------------------------------------------------ entity -- */

    showEntity(entity) {
      const plan = this.guard.plan(entity);

      if (plan.isAheadOfReader) {
        this.setContent(
          Panel.header(entity, true) +
            '<div class="lorelens-state">' +
            '<p class="lorelens-state-body">This character has not appeared yet at chapter ' +
            escapeHtml(String(this.guard.progress)) +
            '. The wiki says they first show up later, so there is nothing here that would not get ahead of you.</p>' +
            '</div>' +
            Panel.footer([
              { action: 'reveal-all', label: 'Show anyway' },
              { action: 'spacer' },
              { action: 'close', label: 'Close' },
            ]),
        );
        this.open();
        return;
      }

      this.setContent(
        Panel.header(entity, false) +
          Panel.tags(plan.tags) +
          this.sections(plan.sections) +
          Panel.footer([
            entity.url ? { action: 'open-wiki', label: 'Full wiki page', href: entity.url } : null,
            { action: 'spacer' },
            { action: 'settings', label: 'Settings' },
            { action: 'close', label: 'Close' },
          ]),
      );
      this.open();
    }

    static header(entity, isMinimal) {
      const scriptLine = [entity.native, entity.romanized]
        .filter(Boolean)
        .map(escapeHtml)
        .join('  ·  ');

      const aliases = (entity.aliases || []).slice(0, 4);
      const imageUrl = escapeUrl(entity.image);

      return (
        '<div class="lorelens-head">' +
        (imageUrl && !isMinimal
          ? '<div class="lorelens-portrait"><img src="' + imageUrl + '" alt="" loading="lazy" ' +
            'referrerpolicy="no-referrer" ' +
            'onerror="this.parentNode.style.display=&quot;none&quot;"></div>'
          : '') +
        '<div class="lorelens-titles">' +
        '<h2 class="lorelens-name">' + escapeHtml(entity.name) + '</h2>' +
        (scriptLine ? '<p class="lorelens-native">' + scriptLine + '</p>' : '') +
        (aliases.length > 0
          ? '<p class="lorelens-alsoknown">also ' + escapeHtml(aliases.join(', ')) + '</p>'
          : '') +
        '</div></div>'
      );
    }

    static tags(tags) {
      if (!tags || tags.length === 0) return '';
      const items = tags
        .map(function (tag) {
          if (tag.masked) {
            /* The label is carried in an attribute rather than the text, and
             * the placeholder is a fixed width, so that neither the rendered
             * text nor the shape of the capsule gives the answer away. */
            return (
              '<span class="lorelens-tag lorelens-tag--masked" ' +
              'data-lorelens-action="reveal-tag" ' +
              'data-lorelens-label="' + escapeHtml(tag.label) + '" ' +
              'data-lorelens-tone="' + escapeHtml(tag.tone) + '" ' +
              'role="button" tabindex="0">status hidden</span>'
            );
          }
          return (
            '<span class="lorelens-tag lorelens-tag--' + escapeHtml(tag.tone) + '">' +
            escapeHtml(tag.label) +
            '</span>'
          );
        })
        .join('');
      return '<div class="lorelens-tags">' + items + '</div>';
    }

    sections(sections) {
      const self = this;
      if (!sections || sections.length === 0) {
        return '<div class="lorelens-section"><p class="lorelens-text">' +
          'The wiki page for this one has no summary yet.</p></div>';
      }

      return sections
        .map(function (section) {
          const runs = section.runs
            .map(function (run) {
              if (!run.hidden) {
                return '<span class="lorelens-run">' + escapeHtml(run.text) + ' </span>';
              }
              return (
                '<span class="lorelens-hidden" role="button" tabindex="0" ' +
                'data-lorelens-action="reveal" ' +
                'data-lorelens-text="' + escapeHtml(run.text) + '">' +
                '<span class="lorelens-hidden-label">' +
                escapeHtml(self.guard.describeReasons(run.reasons)) +
                '</span>' +
                '<span class="lorelens-hidden-hint">Tap to show</span>' +
                '</span>'
              );
            })
            .join('');

          return (
            '<div class="lorelens-section">' +
            '<p class="lorelens-section-title">' + escapeHtml(section.title) + '</p>' +
            '<p class="lorelens-text">' + runs + '</p>' +
            '</div>'
          );
        })
        .join('');
    }

    static footer(actions) {
      const items = (actions || [])
        .filter(Boolean)
        .map(function (action) {
          if (action.action === 'spacer') return '<span class="lorelens-spacer"></span>';
          if (action.href) {
            const href = escapeUrl(action.href);
            if (!href) return '';
            return (
              '<a class="lorelens-btn lorelens-btn--primary" href="' + href + '" ' +
              'target="_blank" rel="noopener noreferrer">' + escapeHtml(action.label) + '</a>'
            );
          }
          return (
            '<button class="lorelens-btn" data-lorelens-action="' + escapeHtml(action.action) + '">' +
            escapeHtml(action.label) +
            '</button>'
          );
        })
        .join('');
      return '<div class="lorelens-foot">' + items + '</div>';
    }
  }

/* ── src/84-settings-ui.js ───────────────────────────────────────────── */

  /* --------------------------------------------------------- settings view */

  /**
   * The settings panel, rendered into the same sheet as everything else.
   *
   * The whole reason this exists is that the previous shape of this tool asked
   * people to edit a config block at the top of the file and re-paste the
   * entire thing into a phone text box to change one value. That is a terrible
   * thing to ask of someone who just wants a different wiki, and it meant every
   * update wiped their configuration. Settings live in storage now, and the
   * pasted file is never meant to be edited at all.
   */
  class SettingsView {
    constructor(options) {
      this.settings = options.settings;
      this.context = options.context;
      this.store = options.store;
      this.wiki = options.wiki;
      this.panel = options.panel;
      this.onApply = options.onApply || function () {};
    }

    render() {
      const settings = this.settings;
      const usage = this.store.describeUsage();

      const html =
        '<div class="lorelens-head"><div class="lorelens-titles">' +
        '<h2 class="lorelens-name">LoreLens</h2>' +
        '<p class="lorelens-native">' +
        escapeHtml(this.context.novelTitle || 'Unknown novel') +
        '</p></div></div>' +

        /* Which wiki. The single most important control, so it goes first. */
        '<div class="lorelens-field">' +
        '<label class="lorelens-label" for="lorelens-wiki">Wiki for this novel</label>' +
        '<input class="lorelens-input" id="lorelens-wiki" type="text" ' +
        'autocapitalize="none" autocorrect="off" spellcheck="false" ' +
        'placeholder="' + escapeHtml(this.wiki.subdomain || 'e.g. shadowslave') + '" ' +
        'value="' + escapeHtml(settings.get('wiki')) + '">' +
        '<p class="lorelens-help">The part before <strong>.fandom.com</strong>. ' +
        'Leave it empty to let LoreLens work it out. ' +
        (this.wiki.subdomain
          ? 'Currently using <strong>' + escapeHtml(this.wiki.subdomain) + '.fandom.com</strong>.'
          : 'No wiki found yet.') +
        '</p></div>' +

        /* Reading position, which drives the spoiler guard. */
        '<div class="lorelens-field">' +
        '<label class="lorelens-label" for="lorelens-progress">You are on chapter</label>' +
        '<input class="lorelens-input" id="lorelens-progress" type="number" min="0" step="1" ' +
        'value="' + escapeHtml(String(settings.get('chapterProgress') || '')) + '" ' +
        'placeholder="' + escapeHtml(String(this.context.chapterNumber || 0)) + '">' +
        '<p class="lorelens-help">Anything the wiki ties to a later chapter gets hidden. ' +
        'This fills in by itself as you read.</p></div>' +

        '<div class="lorelens-field">' +
        '<label class="lorelens-label" for="lorelens-spoiler">Spoiler guard</label>' +
        '<select class="lorelens-select" id="lorelens-spoiler">' +
        SettingsView.option('chapter', 'Hide what is ahead of me', settings.get('spoilerGuard')) +
        SettingsView.option('strong', 'Hide anything that sounds final', settings.get('spoilerGuard')) +
        SettingsView.option('off', 'Show me everything', settings.get('spoilerGuard')) +
        '</select>' +
        '<p class="lorelens-help">Hidden text is never removed, only covered. Tap to reveal it.</p>' +
        '</div>' +

        '<div class="lorelens-field">' +
        '<label class="lorelens-label" for="lorelens-detection">How much to highlight</label>' +
        '<select class="lorelens-select" id="lorelens-detection">' +
        SettingsView.option('strict', 'Only names I have confirmed', settings.get('detection')) +
        SettingsView.option('balanced', 'Balanced', settings.get('detection')) +
        SettingsView.option('generous', 'Anything name-shaped', settings.get('detection')) +
        '</select></div>' +

        '<div class="lorelens-field">' +
        '<label class="lorelens-label" for="lorelens-hlstyle">Marked names look like</label>' +
        '<select class="lorelens-select" id="lorelens-hlstyle">' +
        SettingsView.option('marker', 'Highlighter marker', settings.get('highlightStyle')) +
        SettingsView.option('bold', 'Coloured and bold', settings.get('highlightStyle')) +
        SettingsView.option('underline', 'Underlined', settings.get('highlightStyle')) +
        '</select>' +
        '<p class="lorelens-help">A marked name is not a link and should not look like one — ' +
        'your reader\'s own footnote links are the blue underlined text.</p></div>' +

        '<div class="lorelens-field">' +
        '<label class="lorelens-label" for="lorelens-hlcolor">Marker colour</label>' +
        '<select class="lorelens-select" id="lorelens-hlcolor">' +
        SettingsView.option('violet', 'Violet', settings.get('highlightColor')) +
        SettingsView.option('amber', 'Amber', settings.get('highlightColor')) +
        SettingsView.option('teal', 'Teal', settings.get('highlightColor')) +
        SettingsView.option('rose', 'Rose', settings.get('highlightColor')) +
        SettingsView.option('theme', "Match my reader's theme", settings.get('highlightColor')) +
        '</select></div>' +

        '<div class="lorelens-field">' +
        SettingsView.toggle('firstMentionOnly', 'First mention only',
          'Mark a name once per paragraph instead of every time.', settings) +
        SettingsView.toggle('selectionLookup', 'Look up selected text',
          'Select any words and get a lookup button.', settings) +
        SettingsView.toggle('prefetch', 'Load ahead',
          'Quietly fetch the most common names so taps open instantly.', settings) +
        SettingsView.toggle('liveLookup', 'Use the wiki',
          'Turn off to stop all network requests.', settings) +
        SettingsView.toggle('showRealmsButton', 'Show the ladder button',
          'The button that lists this world\'s cultivation levels.', settings) +
        SettingsView.toggle('showButton', 'Show the settings button', '', settings) +
        SettingsView.toggle('enabled', 'LoreLens is on', '', settings) +
        '</div>' +

        /* Optional and deliberately last: almost nobody needs this, and putting
         * it above the switches would imply it is a normal part of setup. */
        '<div class="lorelens-field">' +
        '<label class="lorelens-label" for="lorelens-lorepack">Custom glossary (optional)</label>' +
        '<input class="lorelens-input" id="lorelens-lorepack" type="url" ' +
        'autocapitalize="none" autocorrect="off" spellcheck="false" ' +
        'placeholder="https://…/glossary.json" ' +
        'value="' + escapeHtml(settings.get('lorepackUrl')) + '">' +
        '<p class="lorelens-help">A hand-written entry file, for novels whose wiki is thin ' +
        'or whose translation uses different names. Loaded once and kept offline. ' +
        'Leave this empty unless someone gave you a link.</p></div>' +

        Panel.footer([
          { action: 'clear-cache', label: 'Clear cache' },
          { action: 'copy-diagnostics', label: 'Copy diagnostics' },
          { action: 'spacer' },
          { action: 'close', label: 'Done' },
        ]) +

        '<p class="lorelens-meta">LoreLens ' + escapeHtml(VERSION) + ' &middot; ' +
        escapeHtml(String(usage.count)) + ' cached entries, ' +
        escapeHtml(String(usage.kilobytes)) + ' KB</p>';

      this.panel.setContent(html);
      this.bind();
      this.panel.open();
    }

    static option(value, label, current) {
      return (
        '<option value="' + escapeHtml(value) + '"' +
        (value === current ? ' selected' : '') + '>' +
        escapeHtml(label) +
        '</option>'
      );
    }

    static toggle(key, label, help, settings) {
      const isOn = Boolean(settings.get(key));
      return (
        '<div class="lorelens-row"><div class="lorelens-row-text">' +
        '<div class="lorelens-label" style="margin:0">' + escapeHtml(label) + '</div>' +
        (help ? '<p class="lorelens-help">' + escapeHtml(help) + '</p>' : '') +
        '</div>' +
        '<button class="lorelens-toggle' + (isOn ? ' is-on' : '') + '" ' +
        'role="switch" aria-checked="' + (isOn ? 'true' : 'false') + '" ' +
        'aria-label="' + escapeHtml(label) + '" ' +
        'data-lorelens-toggle="' + escapeHtml(key) + '"></button></div>'
      );
    }

    /**
     * Inputs need their own listeners rather than the panel's delegated click
     * handler, since we care about change and blur rather than clicks.
     */
    bind() {
      const self = this;
      const root = this.panel.scroll;

      const toggles = root.querySelectorAll('[data-lorelens-toggle]');
      for (const element of Array.prototype.slice.call(toggles)) {
        element.addEventListener('click', guard('settings.toggle', function () {
          const key = element.getAttribute('data-lorelens-toggle');
          const next = !self.settings.get(key);
          self.settings.set(key, next);
          element.classList.toggle('is-on', next);
          element.setAttribute('aria-checked', next ? 'true' : 'false');
          self.onApply(key);
        }));
      }

      const wikiInput = root.querySelector('#lorelens-wiki');
      if (wikiInput) {
        wikiInput.addEventListener('change', guard('settings.wiki', function () {
          /* Accept a full URL as well as a bare subdomain, because that is what
           * people have in their clipboard when they go looking for this. */
          const raw = wikiInput.value.trim();
          const parsed = raw
            .replace(/^https?:\/\//i, '')
            .replace(/\.fandom\.com.*$/i, '')
            .replace(/\/.*$/, '')
            .trim();
          self.settings.set('wiki', parsed);
          self.onApply('wiki');
        }));
      }

      const progressInput = root.querySelector('#lorelens-progress');
      if (progressInput) {
        progressInput.addEventListener('change', guard('settings.progress', function () {
          const value = parseInt(progressInput.value, 10);
          self.settings.set('chapterProgress', isNaN(value) ? 0 : Math.max(0, value));
          self.onApply('chapterProgress');
        }));
      }

      const spoilerSelect = root.querySelector('#lorelens-spoiler');
      if (spoilerSelect) {
        spoilerSelect.addEventListener('change', guard('settings.spoiler', function () {
          self.settings.set('spoilerGuard', spoilerSelect.value);
          self.onApply('spoilerGuard');
        }));
      }

      const lorepackInput = root.querySelector('#lorelens-lorepack');
      if (lorepackInput) {
        lorepackInput.addEventListener('change', guard('settings.lorepack', function () {
          self.settings.set('lorepackUrl', lorepackInput.value.trim());
          self.onApply('lorepackUrl');
        }));
      }

      const detectionSelect = root.querySelector('#lorelens-detection');
      if (detectionSelect) {
        detectionSelect.addEventListener('change', guard('settings.detection', function () {
          self.settings.set('detection', detectionSelect.value);
          self.onApply('detection');
        }));
      }

      const styleSelect = root.querySelector('#lorelens-hlstyle');
      if (styleSelect) {
        styleSelect.addEventListener('change', guard('settings.hlstyle', function () {
          self.settings.set('highlightStyle', styleSelect.value);
          self.onApply('highlightStyle');
        }));
      }

      const colorSelect = root.querySelector('#lorelens-hlcolor');
      if (colorSelect) {
        colorSelect.addEventListener('change', guard('settings.hlcolor', function () {
          self.settings.set('highlightColor', colorSelect.value);
          self.onApply('highlightColor');
        }));
      }
    }

    /**
     * A plain-text dump of what LoreLens can see about its environment. This is
     * what turns "it doesn't work on my phone" into a fixable bug report, and
     * it deliberately contains nothing but feature detection and settings.
     */
    buildDiagnostics(highlighter) {
      const lines = [
        'LoreLens ' + VERSION,
        'novel: ' + (this.context.novelTitle || '(not detected)'),
        'chapter: ' + (this.context.chapterTitle || '(not detected)') +
          ' → number ' + this.context.chapterNumber,
        'root: ' + (this.context.root ? this.context.root.tagName + '#' + (this.context.root.id || '') : 'NONE'),
        'wiki: ' + (this.wiki.subdomain || '(none)') + (this.wiki.disabled ? ' [disabled]' : ''),
        'highlight mode: ' + (highlighter ? highlighter.mode : '?'),
        'storage: ' + (this.store.backend ? 'localStorage' : 'memory only'),
        '',
        'features:',
        '  CSS.highlights: ' + (typeof window.CSS !== 'undefined' && !!window.CSS.highlights),
        '  Highlight: ' + (typeof window.Highlight === 'function'),
        '  caretRangeFromPoint: ' + (typeof document.caretRangeFromPoint === 'function'),
        '  caretPositionFromPoint: ' + (typeof document.caretPositionFromPoint === 'function'),
        '  DOMParser: ' + (typeof window.DOMParser === 'function'),
        '  AbortController: ' + (typeof window.AbortController === 'function'),
        '  requestIdleCallback: ' + (typeof window.requestIdleCallback === 'function'),
        '  MutationObserver: ' + (typeof window.MutationObserver === 'function'),
        '  lookbehind regex: ' + SettingsView.supportsLookbehind(),
        '',
        'settings: ' + JSON.stringify(this.settings.values),
        '',
        'log:',
      ];
      return lines.concat(logLines).join('\n');
    }

    static supportsLookbehind() {
      try {
        new RegExp('(?<!x)y');
        return true;
      } catch (error) {
        return false;
      }
    }
  }

/* ── src/86-selection.js ─────────────────────────────────────────────── */

  /* ------------------------------------------------------ selection lookup */

  /**
   * Select any words in the chapter and a small "Look up" button appears above
   * them.
   *
   * Name detection will always miss things — a character introduced once,
   * fifty chapters ago, under a title nobody uses any more. This is the escape
   * hatch that makes those cases workable, and it is the reason LoreLens is
   * still useful on a novel whose wiki barely exists.
   */
  class SelectionLookup {
    constructor(options) {
      this.settings = options.settings;
      this.getRoot = options.getRoot;
      this.onLookup = options.onLookup;
      this.bubble = null;
      this.attach();
    }

    attach() {
      const self = this;

      const update = debounce(guard('selection.update', function () {
        self.evaluate();
      }), 220);

      document.addEventListener('selectionchange', update);
      /* Scrolling with a selection open would otherwise leave the bubble
       * floating over unrelated text. */
      window.addEventListener('scroll', guard('selection.scroll', function () {
        self.hide();
      }), { passive: true });
    }

    evaluate() {
      if (!this.settings.get('enabled') || !this.settings.get('selectionLookup')) {
        this.hide();
        return;
      }

      const selection = window.getSelection ? window.getSelection() : null;
      if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
        this.hide();
        return;
      }

      const text = String(selection.toString() || '').replace(/\s+/g, ' ').trim();
      if (!SelectionLookup.isLookupWorthy(text)) {
        this.hide();
        return;
      }

      const range = selection.getRangeAt(0);
      const root = this.getRoot();
      if (root && range.commonAncestorContainer) {
        const container =
          range.commonAncestorContainer.nodeType === 1
            ? range.commonAncestorContainer
            : range.commonAncestorContainer.parentElement;
        if (container && !root.contains(container)) {
          this.hide();
          return;
        }
      }

      let rect;
      try {
        rect = range.getBoundingClientRect();
      } catch (error) {
        this.hide();
        return;
      }
      if (!rect || (rect.width === 0 && rect.height === 0)) {
        this.hide();
        return;
      }

      this.show(text, rect);
    }

    /** Worth offering a lookup for — a phrase, not a paragraph and not a letter. */
    static isLookupWorthy(text) {
      if (text.length < MIN_TERM_LENGTH || text.length > 60) return false;
      const words = text.split(/\s+/);
      if (words.length > MAX_TERM_WORDS) return false;
      if (/[.!?;:]$/.test(text)) return false;
      return true;
    }

    show(text, rect) {
      if (!this.bubble) {
        this.bubble = document.createElement('button');
        this.bubble.className = 'lorelens-ui lorelens-bubble';
        this.bubble.setAttribute('type', 'button');
        const self = this;
        this.bubble.addEventListener('click', guard('selection.lookup', function (event) {
          event.preventDefault();
          event.stopPropagation();
          const term = self.bubble.getAttribute('data-lorelens-term') || '';
          self.hide();
          if (window.getSelection) {
            try {
              window.getSelection().removeAllRanges();
            } catch (error) {
              /* some engines refuse; harmless */
            }
          }
          self.onLookup(term);
        }));
        (document.body || document.documentElement).appendChild(this.bubble);
      }

      this.bubble.textContent = 'Look up "' + (text.length > 24 ? text.slice(0, 22) + '…' : text) + '"';
      this.bubble.setAttribute('data-lorelens-term', text);

      const scrollX = window.pageXOffset || 0;
      const scrollY = window.pageYOffset || 0;
      const left = clamp(rect.left + rect.width / 2 + scrollX, 70, (window.innerWidth || 360) - 70 + scrollX);
      this.bubble.style.left = left + 'px';
      this.bubble.style.top = Math.max(scrollY + 28, rect.top + scrollY - 8) + 'px';
      this.bubble.style.display = 'block';
    }

    hide() {
      if (this.bubble) this.bubble.style.display = 'none';
    }
  }

/* ── src/88-realms.js ────────────────────────────────────────────────── */

  /* --------------------------------------------------- the power system --- */

  /**
   * "What are the cultivation levels in this world, again?"
   *
   * Every progression-fantasy novel has a ladder — Qi Refining, Foundation
   * Establishment, Core Formation, and eighty chapters later you have lost
   * track of whether Nascent Soul is above or below Golden Core. The wiki
   * always has a page for it, and going to look is exactly the trip that gets
   * people spoiled.
   *
   * So it lives behind a button in the chapter. One tap, the ladder, done.
   *
   * Wikis do not agree on what to call this page or how to lay it out, so this
   * tries the names that convention produces and then reads the ordering out of
   * whichever structure the page actually uses.
   */
  const POWER_PAGE_TITLES = [
    'Cultivation',
    'Cultivation Realms',
    'Cultivation Levels',
    'Cultivation Stages',
    'Cultivation System',
    'Realms',
    'Power System',
    'Ranks',
    'Rank',
    'Levels',
    'Classes',
    'Grades',
    'Power Levels',
    'Magic System',
  ];

  /** Headings and list items that are page furniture rather than a rank. */
  const NOT_A_RANK =
    /^(references?|gallery|trivia|see also|notes?|navigation|contents?|external links?|sources?|categories|appearances?|images?|videos?|quotes?)$/i;

  class RealmsGuide {
    constructor(options) {
      this.wiki = options.wiki;
      this.store = options.store;
      this.settings = options.settings;
      this.panel = options.panel;
      this.getChapterText = options.getChapterText;
      this.ladder = null;
      this.isLoading = false;
    }

    get cacheKey() {
      return 'realms:' + this.wiki.subdomain;
    }

    /** Open the panel, from cache if we have it. */
    show() {
      if (!this.wiki.subdomain) {
        this.panel.showMessage(
          'Power system',
          'LoreLens has not found a wiki for this novel yet, so there is nowhere to read the ' +
            'cultivation levels from. You can set the wiki in settings.',
          [{ action: 'settings', label: 'Choose a wiki' }, { action: 'close', label: 'Close' }],
        );
        return Promise.resolve();
      }

      const cached = this.store.read(this.cacheKey);
      if (cached) {
        this.ladder = cached;
        this.render(cached);
        return Promise.resolve();
      }

      if (!this.settings.get('liveLookup')) {
        this.panel.showMessage(
          'Power system',
          'Wiki lookups are switched off, and nothing is stored for this novel yet.',
          [{ action: 'settings', label: 'Settings' }, { action: 'close', label: 'Close' }],
        );
        return Promise.resolve();
      }

      const self = this;
      this.panel.showLoading('Power system');

      return this.load().then(function (ladder) {
        if (!ladder) {
          self.panel.showMessage(
            'Power system',
            'No page on ' + self.wiki.subdomain + '.fandom.com looks like a cultivation or ' +
              'ranking system. Not every novel has one, and some wikis file it under a name ' +
              'nobody would guess.',
            [
              { action: 'search-realms', label: 'Search the wiki' },
              { action: 'close', label: 'Close' },
            ],
          );
          return;
        }
        self.store.write(self.cacheKey, ladder, ENTRY_TTL_DAYS);
        self.ladder = ladder;
        self.render(ladder);
      });
    }

    /** Find the page, fetch it, read the ladder out of it. */
    load() {
      if (this.isLoading) return Promise.resolve(null);
      this.isLoading = true;
      const self = this;

      return this.findPage()
        .then(function (title) {
          if (!title) return null;
          return self.wiki.fetchRenderedArticle(title).then(function (html) {
            if (!html) return null;
            const steps = RealmsGuide.parseLadder(html);
            if (steps.length < 3) return null;
            return {
              title: title,
              url: self.wiki.articleUrl(title),
              intro: RealmsGuide.parseIntro(html),
              steps: steps,
            };
          });
        })
        .then(function (ladder) {
          self.isLoading = false;
          return ladder;
        })
        .catch(function () {
          self.isLoading = false;
          return null;
        });
    }

    /**
     * Which of the candidate titles exists? One batched query answers for all
     * of them, rather than a request each.
     */
    findPage() {
      const self = this;
      return this.wiki
        .request({ action: 'query', prop: 'info', redirects: '1', titles: POWER_PAGE_TITLES.join('|') })
        .then(function (payload) {
          const pages = (payload && payload.query && payload.query.pages) || [];
          const list = Array.isArray(pages)
            ? pages
            : Object.keys(pages).map(function (key) { return pages[key]; });

          const existing = {};
          for (const page of list) {
            if (page && !page.missing && page.title) existing[foldKey(page.title)] = page.title;
          }
          /* Candidate order is preference order, so walk it rather than the
           * order the API happened to answer in. */
          for (const candidate of POWER_PAGE_TITLES) {
            const hit = existing[foldKey(candidate)];
            if (hit) return hit;
          }
          return null;
        })
        .then(function (title) {
          if (title) return title;
          /* Nothing obvious — ask the wiki's own search. */
          return self.wiki.searchTitle('cultivation realms ranks power system').then(function (results) {
            if (!results || results.length === 0) return null;
            return results[0].title;
          });
        });
    }

    /* ----------------------------------------------------------- parsing -- */

    static parseDocument(html) {
      if (typeof window.DOMParser !== 'function') return null;
      try {
        return new window.DOMParser().parseFromString(html, 'text/html');
      } catch (error) {
        return null;
      }
    }

    static parseIntro(html) {
      const parsed = RealmsGuide.parseDocument(html);
      if (!parsed) return '';
      const body = parsed.querySelector('.mw-parser-output') || parsed.body;
      if (!body) return '';
      const paragraphs = body.querySelectorAll('p');
      for (const paragraph of Array.prototype.slice.call(paragraphs)) {
        const text = stripWikiHtml(paragraph.innerHTML || '');
        if (text.length > 40) return splitSentences(text).slice(0, 2).join(' ');
      }
      return '';
    }

    /**
     * Read the rungs out of whatever shape the page uses. Wikis lay this out as
     * a numbered list, a run of headings, a bulleted list or a table, roughly in
     * that order of how often each occurs, so each is tried in turn and the
     * first that yields a plausible ladder wins.
     */
    static parseLadder(html) {
      const parsed = RealmsGuide.parseDocument(html);
      if (!parsed) return [];
      const body = parsed.querySelector('.mw-parser-output') || parsed.body;
      if (!body) return [];

      for (const element of Array.prototype.slice.call(
        body.querySelectorAll('.navbox, .toc, .reference, sup, style, script, .mw-editsection'),
      )) {
        if (element.parentNode) element.parentNode.removeChild(element);
      }

      const strategies = [
        RealmsGuide.fromOrderedList,
        RealmsGuide.fromHeadings,
        RealmsGuide.fromTable,
        RealmsGuide.fromBulletList,
      ];

      for (const strategy of strategies) {
        try {
          const steps = RealmsGuide.clean(strategy(body));
          if (steps.length >= 3) return steps;
        } catch (error) {
          /* ":scope" and friends are not universally available. Try the next
           * shape rather than giving up on the page entirely. */
        }
      }
      return [];
    }

    static fromOrderedList(body) {
      const lists = body.querySelectorAll('ol');
      for (const list of Array.prototype.slice.call(lists)) {
        const items = list.querySelectorAll(':scope > li');
        if (items.length >= 3) return RealmsGuide.textsOf(items);
      }
      return [];
    }

    static fromHeadings(body) {
      const headings = body.querySelectorAll('h2, h3');
      return RealmsGuide.textsOf(headings);
    }

    static fromBulletList(body) {
      const lists = body.querySelectorAll('ul');
      for (const list of Array.prototype.slice.call(lists)) {
        const items = list.querySelectorAll(':scope > li');
        if (items.length >= 3) return RealmsGuide.textsOf(items);
      }
      return [];
    }

    static fromTable(body) {
      const table = body.querySelector('table');
      if (!table) return [];
      const rows = table.querySelectorAll('tr');
      const out = [];
      for (const row of Array.prototype.slice.call(rows)) {
        const cell = row.querySelector('td, th');
        if (!cell) continue;
        out.push((cell.textContent || '').replace(/\s+/g, ' ').trim());
      }
      return out;
    }

    static textsOf(nodes) {
      const out = [];
      for (const node of Array.prototype.slice.call(nodes)) {
        /* Only the rung's own name, not the paragraph of description that
         * often follows it inside the same list item. */
        const raw = (node.textContent || '').replace(/\s+/g, ' ').trim();
        const name = raw.split(/[:–—-]\s|\.\s/)[0].trim();
        out.push(name);
      }
      return out;
    }

    static clean(names) {
      const seen = new Set();
      const out = [];
      for (const name of names) {
        const trimmed = String(name || '').replace(/\[\d+\]/g, '').trim();
        if (trimmed.length < 2 || trimmed.length > 48) continue;
        if (NOT_A_RANK.test(trimmed)) continue;
        if (/^\d+$/.test(trimmed)) continue;
        const key = foldKey(trimmed);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(trimmed);
        if (out.length >= 40) break;
      }
      return out;
    }

    /* --------------------------------------------------------- rendering -- */

    /**
     * A ladder gives away how far the world's power scale goes, which is a
     * mild spoiler in itself. It is behind a button the reader chose to press,
     * so it is shown — but in the strongest spoiler mode the top of the ladder
     * is folded away, since that is the part that says how the story ends.
     */
    render(ladder) {
      const chapterText = foldKey(this.getChapterText ? this.getChapterText() : '');
      const isStrict = this.settings.get('spoilerGuard') === 'strong';
      const foldFrom = isStrict ? Math.ceil(ladder.steps.length * 0.6) : ladder.steps.length;

      const rows = ladder.steps
        .map(function (step, position) {
          if (position >= foldFrom) return '';
          const isHere = chapterText.indexOf(foldKey(step)) >= 0;
          return (
            '<li class="lorelens-rung' + (isHere ? ' is-here' : '') + '">' +
            '<span class="lorelens-rung-n">' + String(position + 1) + '</span>' +
            '<span class="lorelens-rung-name">' + escapeHtml(step) + '</span>' +
            (isHere ? '<span class="lorelens-rung-tag">in this chapter</span>' : '') +
            '</li>'
          );
        })
        .join('');

      const foldedCount = ladder.steps.length - foldFrom;

      this.panel.setContent(
        '<div class="lorelens-head"><div class="lorelens-titles">' +
          '<h2 class="lorelens-name">' + escapeHtml(ladder.title) + '</h2>' +
          '<p class="lorelens-native">' + escapeHtml(String(ladder.steps.length)) + ' levels</p>' +
          '</div></div>' +
          (ladder.intro
            ? '<div class="lorelens-section"><p class="lorelens-text">' +
              escapeHtml(ladder.intro) + '</p></div>'
            : '') +
          '<ol class="lorelens-ladder">' + rows + '</ol>' +
          (foldedCount > 0
            ? '<div class="lorelens-hidden" role="button" tabindex="0" ' +
              'data-lorelens-action="reveal-ladder">' +
              '<span class="lorelens-hidden-label">' + String(foldedCount) +
              ' more levels above this</span>' +
              '<span class="lorelens-hidden-hint">Tap to show</span></div>'
            : '') +
          Panel.footer([
            ladder.url ? { action: 'open-wiki', label: 'Full page', href: ladder.url } : null,
            { action: 'spacer' },
            { action: 'refresh-realms', label: 'Refresh' },
            { action: 'close', label: 'Close' },
          ]),
      );
      this.panel.open();
    }

    /** Re-render with nothing folded away. */
    revealAll() {
      if (!this.ladder) return;
      const previous = this.settings.values.spoilerGuard;
      this.settings.values.spoilerGuard = 'off';
      this.render(this.ladder);
      this.settings.values.spoilerGuard = previous;
    }

    /** Drop the cached ladder and fetch it again — for when a wiki updates. */
    refresh() {
      this.store.remove(this.cacheKey);
      this.ladder = null;
      return this.show();
    }
  }

/* ── src/90-app.js ───────────────────────────────────────────────────── */

  /* ------------------------------------------------------------------- app */

  class LoreLensApp {
    constructor() {
      this.store = new Store();
      this.settings = new Settings(this.store);
      this.context = new ReaderContext();
      this.wiki = new WikiClient(this.store);
      this.spoilerGuard = new SpoilerGuard(this.settings);
      this.index = new EntityIndex();
      this.detector = new NameDetector(this.settings);
      this.highlighter = null;
      this.panel = null;
      this.settingsView = null;
      this.selection = null;
      this.realms = null;
      this.fabs = null;
      this.fab = null;
      this.realmsFab = null;
      this.currentEntity = null;
      this.currentTerm = '';
      this.observer = null;
      this.isScanning = false;
    }

    /* ------------------------------------------------------------- startup */

    start() {
      if (!this.context.detect()) {
        log('no chapter content found; standing down');
        return;
      }

      this.settings.useNovel(this.context.novelKey);
      this.settings.advanceProgress(this.context.chapterNumber);

      applyStyleSheet(this.context.palette, this.settings);

      this.highlighter = new Highlighter(this.index, this.settings);
      this.panel = new Panel({
        spoilerGuard: this.spoilerGuard,
        onAction: guard('app.panelAction', this.handlePanelAction.bind(this)),
      });
      this.settingsView = new SettingsView({
        settings: this.settings,
        context: this.context,
        store: this.store,
        wiki: this.wiki,
        panel: this.panel,
        onApply: guard('app.applySetting', this.handleSettingChange.bind(this)),
      });

      const self = this;
      this.selection = new SelectionLookup({
        settings: this.settings,
        getRoot: function () {
          return self.context.root;
        },
        onLookup: guardAsync('app.selectionLookup', function (term) {
          return self.lookup(term);
        }),
      });

      this.realms = new RealmsGuide({
        wiki: this.wiki,
        store: this.store,
        settings: this.settings,
        panel: this.panel,
        getChapterText: function () {
          const root = self.context.root;
          return (root && (root.innerText || root.textContent)) || '';
        },
      });

      this.bindTaps();
      this.buildFab();
      this.watchForChapterChanges();
      this.watchForThemeChanges();

      if (!this.settings.get('enabled')) {
        log('LoreLens is switched off in settings');
        return;
      }

      const startScan = guard('app.afterSources', this.scan.bind(this));
      Promise.all([this.resolveWiki(), this.loadLorepack()]).then(startScan);
    }

    /**
     * An optional hand-curated pack of entries, fetched once and cached.
     *
     * This is not the main path and is not meant to be — asking someone to
     * prepare a data file before they can read is exactly the friction this
     * version exists to remove. It earns its place for the cases the wiki
     * cannot serve: a novel whose wiki is a stub, a fan translation whose names
     * differ from the wiki's, or a group that wants to share a spoiler-safe
     * glossary for a series they are actively translating.
     */
    loadLorepack() {
      const url = this.settings.get('lorepackUrl');
      if (!url) return Promise.resolve(null);

      const self = this;
      const cacheKey = 'lorepack:' + url;
      const cached = this.store.read(cacheKey);
      if (cached) {
        this.mergeLorepack(cached);
        return Promise.resolve(cached);
      }

      if (!/^https:\/\//i.test(url)) {
        log('refusing to load a lorepack over a non-https url');
        return Promise.resolve(null);
      }

      return fetch(url, { credentials: 'omit' })
        .then(function (response) {
          if (!response.ok) throw new Error('HTTP ' + response.status);
          return response.json();
        })
        .then(function (pack) {
          const cleaned = LoreLensApp.validateLorepack(pack);
          if (!cleaned) {
            log('lorepack rejected: unexpected shape');
            return null;
          }
          self.store.write(cacheKey, cleaned, ENTRY_TTL_DAYS);
          self.mergeLorepack(cleaned);
          return cleaned;
        })
        .catch(function (error) {
          log('lorepack fetch failed:', (error && error.message) || String(error));
          return null;
        });
    }

    /**
     * A lorepack is a file from the internet being rendered inside someone's
     * reader, so every field is treated as hostile until it has been checked
     * and clipped to a shape the panel knows how to draw.
     */
    static validateLorepack(pack) {
      if (!pack || typeof pack !== 'object') return null;
      const list = Array.isArray(pack.entities) ? pack.entities : null;
      if (!list) return null;

      const entities = [];
      for (const raw of list.slice(0, MAX_INDEXED_TERMS)) {
        if (!raw || typeof raw !== 'object') continue;
        const name = String(raw.name || '').trim();
        if (!name || name.length > 120) continue;

        entities.push({
          id: 'pack:' + slugify(name),
          name: name,
          title: String(raw.title || name).slice(0, 120),
          aliases: (Array.isArray(raw.aliases) ? raw.aliases : [])
            .map(function (alias) { return String(alias).trim(); })
            .filter(function (alias) { return alias.length >= MIN_TERM_LENGTH && alias.length <= 60; })
            .slice(0, 10),
          native: String(raw.native || '').slice(0, 60),
          romanized: String(raw.romanized || '').slice(0, 80),
          image: /^https:\/\//i.test(raw.image || '') ? String(raw.image) : '',
          url: /^https:\/\//i.test(raw.url || '') ? String(raw.url) : '',
          tags: (Array.isArray(raw.tags) ? raw.tags : []).slice(0, 6).map(function (tag) {
            const label = String((tag && tag.label) || '').slice(0, 40);
            const tone = ['good', 'bad', 'accent', 'neutral'].indexOf((tag && tag.tone) || '') >= 0
              ? tag.tone
              : 'neutral';
            return {
              label: label,
              tone: tone,
              kind: (tag && tag.kind) === 'fate' ? 'fate' : 'plain',
              isFateReveal: (tag && tag.kind) === 'fate' && FATE_WORDS.test(label),
            };
          }).filter(function (tag) { return tag.label; }),
          sections: (Array.isArray(raw.sections) ? raw.sections : []).slice(0, 6).map(function (section) {
            return {
              title: String((section && section.title) || 'Notes').slice(0, 60),
              body: String((section && section.body) || '').slice(0, 4000),
              alwaysSafe: Boolean(section && section.alwaysSafe),
            };
          }).filter(function (section) { return section.body; }),
          firstSeen: Number(raw.firstSeen) > 0 ? Number(raw.firstSeen) : 0,
          source: 'lorepack',
          isEnriched: true,
        });
      }

      if (entities.length === 0) return null;
      return { schemaVersion: 2, entities: entities };
    }

    mergeLorepack(pack) {
      for (const entity of pack.entities) {
        this.index.add({
          name: entity.name,
          aliases: entity.aliases,
          entity: entity,
          confidence: CONFIDENCE.CONFIRMED,
        });
      }
      log('lorepack merged:', String(pack.entities.length), 'entries');
    }

    /**
     * Decide which wiki this novel uses: an explicit choice always wins, and
     * otherwise we go looking. Discovery is cached hard, so this costs nothing
     * after the first chapter of a book.
     */
    resolveWiki() {
      const chosen = this.settings.get('wiki');
      if (chosen) {
        this.wiki.use(chosen);
        return Promise.resolve(chosen);
      }
      if (!this.settings.get('liveLookup')) return Promise.resolve('');
      if (!this.context.novelTitle) {
        log('no novel title detected, cannot auto-find a wiki');
        return Promise.resolve('');
      }

      const self = this;
      return this.wiki.discoverWiki(this.context.novelTitle).then(function (subdomain) {
        if (subdomain) self.wiki.use(subdomain);
        return subdomain;
      });
    }

    /* ---------------------------------------------------------- scanning -- */

    /** Detect names, index them, paint them. */
    scan() {
      if (this.isScanning) return;
      this.isScanning = true;

      const root = this.context.root;
      const text = (root && (root.innerText || root.textContent)) || '';

      const candidates = this.detector.detect(text);
      for (const candidate of candidates) {
        /* A name we have looked up before, in any chapter, is already known —
         * so the tool gets more accurate the longer you read a series. */
        const cached = this.readCachedEntity(candidate.phrase);
        if (cached) {
          this.index.add({
            name: candidate.phrase,
            aliases: cached.aliases || [],
            entity: cached,
            confidence: CONFIDENCE.CONFIRMED,
          });
        } else if (this.settings.get('detection') !== 'strict') {
          this.index.add({
            name: candidate.phrase,
            aliases: [],
            entity: null,
            confidence: CONFIDENCE.GUESSED,
          });
        }
      }

      const self = this;
      this.highlighter.run(root, function () {
        self.isScanning = false;
        self.prefetch(candidates);
      });
    }

    readCachedEntity(term) {
      if (!this.wiki.subdomain) return null;
      return this.store.read('entry:' + this.wiki.subdomain + ':' + foldKey(term));
    }

    writeCachedEntity(term, entity) {
      if (!this.wiki.subdomain) return;
      this.store.write('entry:' + this.wiki.subdomain + ':' + foldKey(term), entity, ENTRY_TTL_DAYS);
    }

    /**
     * Warm the cache for the names most likely to be tapped, so that the first
     * tap in a chapter opens instantly rather than showing a spinner. Bounded
     * hard: this runs while someone is reading, on a phone, possibly on mobile
     * data, and it is a convenience rather than a feature.
     */
    prefetch(candidates) {
      if (!this.settings.get('prefetch')) return;
      if (!this.settings.get('liveLookup') || !this.wiki.isReady) return;

      const self = this;
      const targets = candidates
        .filter(function (candidate) {
          return !self.readCachedEntity(candidate.phrase);
        })
        .slice(0, 5);

      if (targets.length === 0) return;
      log('prefetching', String(targets.length), 'names');

      let position = 0;
      function next() {
        if (position >= targets.length) {
          /* Everything we learned raises confidence, so repaint once at the
           * end rather than flickering the chapter on every response. */
          self.highlighter.run(self.context.root);
          return;
        }
        const term = targets[position].phrase;
        position += 1;
        self.fetchEntity(term).then(function (entity) {
          if (entity) {
            self.writeCachedEntity(term, entity);
            self.index.resolve(term, entity);
          } else {
            self.index.reject(term);
          }
          whenIdle(next);
        });
      }

      whenIdle(next);
    }

    /* ------------------------------------------------------------ lookups -- */

    /**
     * The tap path. Cache first, then the wiki, then a search, then an honest
     * "nothing found" — never a spinner that goes nowhere.
     */
    lookup(term) {
      if (!term) return Promise.resolve();
      this.currentTerm = term;

      /* A curated entry beats anything we could fetch, and never needs the
       * network — so it is checked before the cache and before the wiki. */
      const indexed = this.index.lookup(term);
      if (indexed && indexed.entity && indexed.entity.source === 'lorepack') {
        this.showEntity(indexed.entity);
        return Promise.resolve();
      }

      const cached = this.readCachedEntity(term);
      if (cached) {
        this.showEntity(cached);
        this.enrich(term, cached);
        return Promise.resolve();
      }

      if (!this.settings.get('liveLookup')) {
        this.panel.showMessage(
          term,
          'Wiki lookups are switched off, so there is nothing stored for this name yet.',
          [{ action: 'settings', label: 'Settings' }, { action: 'close', label: 'Close' }],
        );
        return Promise.resolve();
      }

      if (!this.wiki.isReady) {
        this.panel.showMessage(
          term,
          this.wiki.subdomain
            ? 'This wiki is not responding. It may be unreachable from your connection.'
            : 'LoreLens has not found a wiki for this novel yet. You can set one in settings.',
          [{ action: 'settings', label: 'Choose a wiki' }, { action: 'close', label: 'Close' }],
        );
        return Promise.resolve();
      }

      const self = this;
      this.panel.showLoading(term);

      return this.fetchEntity(term).then(function (entity) {
        if (self.currentTerm !== term) return; // the reader tapped something else
        if (entity) {
          self.writeCachedEntity(term, entity);
          self.index.resolve(term, entity);
          self.showEntity(entity);
          self.enrich(term, entity);
          return;
        }
        return self.offerAlternatives(term);
      });
    }

    /** Exact title first; a search only if that misses. */
    fetchEntity(term) {
      const self = this;
      return this.wiki.fetchArticle(term).then(function (page) {
        if (!page) return null;
        return buildEntity(page, '', self.wiki.subdomain);
      });
    }

    /**
     * Tags, alternate names and the native-script name all come from the
     * infobox, which means fetching and parsing the whole rendered article.
     * That is far too slow to block the panel on, so the summary goes up
     * immediately and this fills in behind it.
     */
    enrich(term, entity) {
      if (entity.isEnriched) return;
      const self = this;

      this.wiki.fetchRenderedArticle(entity.title).then(function (html) {
        if (!html) return;
        const enriched = buildEntity(
          {
            title: entity.title,
            extract: entity.sections.map(function (section) {
              return section.body;
            }).join(' '),
            thumbnail: entity.image ? { source: entity.image } : null,
            fullurl: entity.url,
          },
          html,
          self.wiki.subdomain,
        );
        enriched.isEnriched = true;

        self.writeCachedEntity(term, enriched);
        self.index.resolve(term, enriched);

        /* Only repaint if the reader is still looking at this entry. */
        if (self.panel.isOpen && self.currentTerm === term) {
          self.showEntity(enriched);
        }
      });
    }

    /** No exact article. Search, and either follow the obvious answer or ask. */
    offerAlternatives(term) {
      const self = this;
      return this.wiki.searchTitle(term).then(function (results) {
        if (!results || results.length === 0) {
          self.panel.showMessage(
            term,
            'No article on ' + self.wiki.subdomain + '.fandom.com matches this name. ' +
              'It may be spelled differently there, or this may not be a character at all.',
            [
              { action: 'search-web', label: 'Search the wiki' },
              { action: 'settings', label: 'Settings' },
              { action: 'close', label: 'Close' },
            ],
          );
          self.index.reject(term);
          return;
        }

        /* One strong match is not worth asking about. */
        if (results.length === 1 || results[0].score >= 80) {
          return self.fetchEntity(results[0].title).then(function (entity) {
            if (!entity) {
              self.panel.showMessage(term, 'That article could not be loaded.', null);
              return;
            }
            self.writeCachedEntity(term, entity);
            self.index.resolve(term, entity);
            self.showEntity(entity);
            self.enrich(term, entity);
          });
        }

        self.panel.showChoices(term, results.slice(0, 5));
      });
    }

    showEntity(entity) {
      this.currentEntity = entity;
      this.panel.showEntity(entity);
    }

    /* ------------------------------------------------------------- events -- */

    bindTaps() {
      const self = this;
      const root = this.context.root;
      if (!root) return;

      root.addEventListener('click', guard('app.tap', function (event) {
        if (!self.settings.get('enabled')) return;

        /* The wrapping path gives us a real element to read the term off. */
        const marked = event.target.closest
          ? event.target.closest('.' + MARK_CLASS)
          : null;
        if (marked) {
          event.preventDefault();
          event.stopPropagation();
          self.lookup(marked.getAttribute('data-lorelens-term'));
          return;
        }

        /* The painted path has no element, so resolve the tap by position. */
        const term = self.highlighter.termAtPoint(event.clientX, event.clientY);
        if (term) {
          event.preventDefault();
          event.stopPropagation();
          self.lookup(term);
        }
      }), true);
    }

    handlePanelAction(action, value) {
      if (action === 'settings') {
        this.settingsView.render();
        return;
      }
      if (action === 'choose') {
        const self = this;
        this.panel.showLoading(value);
        this.fetchEntity(value).then(function (entity) {
          if (!entity) {
            self.panel.showMessage(value, 'That article could not be loaded.', null);
            return;
          }
          self.writeCachedEntity(self.currentTerm || value, entity);
          self.index.resolve(self.currentTerm || value, entity);
          self.showEntity(entity);
          self.enrich(self.currentTerm || value, entity);
        });
        return;
      }
      if (action === 'reveal-all') {
        const entity = this.currentEntity;
        if (!entity) return;
        const previous = this.settings.get('spoilerGuard');
        this.settings.values.spoilerGuard = 'off';
        this.panel.showEntity(entity);
        this.settings.values.spoilerGuard = previous;
        return;
      }
      if (action === 'realms') {
        this.realms.show();
        return;
      }
      if (action === 'reveal-ladder') {
        this.realms.revealAll();
        return;
      }
      if (action === 'refresh-realms') {
        this.realms.refresh();
        return;
      }
      if (action === 'search-realms') {
        window.open(
          this.wiki.host() + '/wiki/Special:Search?query=' + encodeURIComponent('cultivation realms'),
          '_blank',
          'noopener',
        );
        return;
      }
      if (action === 'search-web') {
        const url =
          this.wiki.host() + '/wiki/Special:Search?query=' + encodeURIComponent(this.currentTerm);
        window.open(url, '_blank', 'noopener');
        return;
      }
      if (action === 'clear-cache') {
        const removed = this.store.clearCache();
        this.panel.showMessage(
          'Cache cleared',
          removed + ' stored entries removed. Names will be fetched again as you tap them.',
          [{ action: 'settings', label: 'Back' }, { action: 'close', label: 'Close' }],
        );
        return;
      }
      if (action === 'copy-diagnostics') {
        this.copyDiagnostics();
      }
    }

    copyDiagnostics() {
      const text = this.settingsView.buildDiagnostics(this.highlighter);
      const self = this;

      const done = function (ok) {
        self.panel.showMessage(
          ok ? 'Copied' : 'Could not copy',
          ok
            ? 'Diagnostics are on your clipboard. Paste them into a GitHub issue.'
            : 'Your reader will not let scripts use the clipboard. The diagnostics are printed to the console instead.',
          [{ action: 'settings', label: 'Back' }, { action: 'close', label: 'Close' }],
        );
        if (!ok && window.console) window.console.log(text);
      };

      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(
          function () {
            done(true);
          },
          function () {
            done(false);
          },
        );
      } else {
        done(false);
      }
    }

    handleSettingChange(key) {
      if (key === 'wiki') {
        this.wiki.use(this.settings.get('wiki'));
        this.store.clearCache();
        this.index = new EntityIndex();
        this.highlighter.index = this.index;
        this.scan();
        return;
      }
      if (key === 'enabled') {
        if (this.settings.get('enabled')) this.scan();
        else this.highlighter.clear();
        return;
      }
      if (key === 'detection' || key === 'firstMentionOnly') {
        this.index = new EntityIndex();
        this.highlighter.index = this.index;
        this.scan();
        return;
      }
      if (key === 'lorepackUrl') {
        this.index = new EntityIndex();
        this.highlighter.index = this.index;
        const self = this;
        this.loadLorepack().then(function () {
          self.scan();
        });
        return;
      }
      if (key === 'highlightStyle' || key === 'highlightColor') {
        /* Only the stylesheet changes — the ranges are already registered, so
         * the marks repaint without walking the chapter again. */
        applyStyleSheet(this.context.palette, this.settings);
        return;
      }
      if (key === 'showButton' || key === 'showRealmsButton') {
        this.updateFabVisibility();
      }
    }

    /* ---------------------------------------------------------------- fab -- */

    buildFab() {
      const self = this;

      this.fabs = document.createElement('div');
      this.fabs.className = 'lorelens-ui lorelens-fabs';

      const makeButton = function (label, description, onTap) {
        const button = document.createElement('button');
        button.className = 'lorelens-fab';
        button.setAttribute('type', 'button');
        button.setAttribute('aria-label', description);
        button.setAttribute('title', description);
        button.textContent = label;
        button.addEventListener('click', guard('app.fab', function (event) {
          event.preventDefault();
          event.stopPropagation();
          onTap();
        }));
        return button;
      };

      /* The ladder sits above the settings button: it is the one people reach
       * for mid-chapter, and the thumb gets there first. */
      this.realmsFab = makeButton('☰', 'Cultivation levels in this world', function () {
        self.realms.show();
      });
      this.fab = makeButton('L', 'LoreLens settings', function () {
        self.settingsView.render();
      });

      this.fabs.appendChild(this.realmsFab);
      this.fabs.appendChild(this.fab);
      (document.body || document.documentElement).appendChild(this.fabs);
      this.updateFabVisibility();
    }

    updateFabVisibility() {
      if (this.fab) {
        this.fab.style.display = this.settings.get('showButton') ? 'flex' : 'none';
      }
      if (this.realmsFab) {
        this.realmsFab.style.display = this.settings.get('showRealmsButton') ? 'flex' : 'none';
      }
      if (this.fabs) {
        const anyVisible =
          this.settings.get('showButton') || this.settings.get('showRealmsButton');
        this.fabs.style.display = anyVisible ? 'flex' : 'none';
      }
    }

    /* ------------------------------------------------------------ watching */

    /**
     * Readers append paragraphs as they load, swap the whole chapter in place
     * when you reach the end of one, and re-render on a font-size change. Any
     * of those leaves our highlights stale, so we repaint after the dust
     * settles rather than trying to predict which one happened.
     */
    watchForChapterChanges() {
      if (typeof window.MutationObserver !== 'function') return;
      const self = this;

      const repaint = debounce(guard('app.repaint', function () {
        const previousTitle = self.context.chapterTitle;
        self.context.detect();

        if (self.context.chapterTitle !== previousTitle) {
          log('chapter changed:', self.context.chapterTitle);
          self.settings.advanceProgress(self.context.chapterNumber);
        }
        if (self.settings.get('enabled')) self.scan();
      }), 400);

      this.observer = new MutationObserver(function (records) {
        for (const record of records) {
          /* Ignore the mutations we caused ourselves. */
          const target = record.target;
          if (target && target.classList && target.classList.contains('lorelens-ui')) continue;
          if (target && target.closest && target.closest('.lorelens-panel')) continue;
          repaint();
          return;
        }
      });

      const root = this.context.root;
      if (root) this.observer.observe(root, { childList: true, subtree: true });
    }

    /** Follow the reader when it changes theme, so the panel never clashes. */
    watchForThemeChanges() {
      const self = this;
      const refresh = debounce(guard('app.theme', function () {
        const palette = self.context.buildPalette();
        self.context.palette = palette;
        applyStyleSheet(palette, self.settings);
      }), 500);

      if (window.matchMedia) {
        try {
          const query = window.matchMedia('(prefers-color-scheme: dark)');
          if (query.addEventListener) query.addEventListener('change', refresh);
          else if (query.addListener) query.addListener(refresh);
        } catch (error) {
          /* not supported; the observer below still catches theme swaps */
        }
      }

      if (typeof window.MutationObserver === 'function' && document.body) {
        new MutationObserver(refresh).observe(document.body, {
          attributes: true,
          attributeFilter: ['style', 'class'],
        });
      }
    }

    /** Called when the reader injects the script again on a new chapter. */
    rescan() {
      log('rescan requested');
      this.context.detect();
      this.settings.useNovel(this.context.novelKey);
      this.settings.advanceProgress(this.context.chapterNumber);
      if (this.settings.get('enabled')) this.scan();
    }
  }

/* ── src/99-bootstrap.js ─────────────────────────────────────────────── */

  /* ------------------------------------------------------------- bootstrap */

  /**
   * The public surface, for anyone who wants to drive LoreLens from the
   * console or from another script. Keeping this deliberately small: it is the
   * bit we cannot change later without breaking somebody's setup.
   */
  function publish(app) {
    window.lorelens = {
      version: VERSION,

      /** Open the panel for a name, exactly as if it had been tapped. */
      open: function (term) {
        return guardAsync('api.open', function () {
          return app.lookup(String(term || ''));
        })();
      },

      /** Re-detect the chapter and repaint. Called on re-injection. */
      rescan: guard('api.rescan', function () {
        app.rescan();
      }),

      /** Open the settings panel. */
      settings: guard('api.settings', function () {
        app.settingsView.render();
      }),

      /** Open this world's cultivation / rank ladder. */
      realms: guard('api.realms', function () {
        return app.realms.show();
      }),

      /** Everything we know about this environment, as text. */
      diagnostics: guard('api.diagnostics', function () {
        return app.settingsView.buildDiagnostics(app.highlighter);
      }),

      /** Forget every cached wiki entry. Settings are kept. */
      clearCache: guard('api.clearCache', function () {
        return app.store.clearCache();
      }),

      /* Exposed for the test suite, which drives the internals directly rather
       * than through the UI. Not a supported interface — it will change. */
      _internals: {
        app: app,
        EntityIndex: EntityIndex,
        NameDetector: NameDetector,
        SpoilerGuard: SpoilerGuard,
        WikiClient: WikiClient,
        ReaderContext: ReaderContext,
        Highlighter: Highlighter,
        Settings: Settings,
        Store: Store,
        Panel: Panel,
        RealmsGuide: RealmsGuide,
        buildEntity: buildEntity,
        parseInfobox: parseInfobox,
        stripWikiHtml: stripWikiHtml,
        classifyFieldLabel: classifyFieldLabel,
        scaleWikiImage: scaleWikiImage,
        splitSentences: splitSentences,
        foldKey: foldKey,
        parseColor: parseColor,
        luminance: luminance,
        CONFIDENCE: CONFIDENCE,
      },
    };
  }

  function boot() {
    let app;
    try {
      app = new LoreLensApp();
      publish(app);
      app.start();
    } catch (error) {
      /* A failure here means no highlights. It must never mean no chapter. */
      log('fatal during startup:', (error && error.message) || String(error));
      if (window.console && window.console.warn) {
        window.console.warn('[LoreLens] failed to start:', error);
      }
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
