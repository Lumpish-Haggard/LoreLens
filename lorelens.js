/* =============================================================================
 * LoreLens for LNReader — v1.0.0
 * Highlights character / place / term names inside a chapter and opens a lore
 * sheet with wiki info when one is tapped.
 *
 * WHERE THIS GOES
 *   LNReader → Settings → Reader → Advanced → JS tab → paste → Save.
 *   Reopen a chapter for changes to apply.
 *
 * TWO WAYS TO GET DATA
 *   1. Lorepack (offline, recommended): a JSON file you build once from a
 *      Fandom wiki with build-lorepack.mjs. Set LOREPACK_URL, or paste the
 *      JSON straight into INLINE_LOREPACK for a fully offline setup.
 *   2. Live lookup: falls back to the Fandom API on tap and caches the answer.
 * ========================================================================== */

(function initLoreLens() {
  'use strict';

  /* ---------------------------------------------------------------- config */

  const CONFIG = {
    /** Hosted lorepack JSON. Fetched once per chapter, cached for CACHE_TTL_DAYS. */
    lorepackUrl: '',

    /** Paste a lorepack object here for a zero-network setup. Wins over lorepackUrl. */
    inlineLorepack: null,

    /** Fandom subdomain used for live lookups, e.g. 'imabadguy' for imabadguy.fandom.com. */
    fandomWiki: '',

    /** Look terms up live when they are missing from the lorepack. */
    isLiveLookupEnabled: true,

    /** Highlight repeated Capitalised Phrases even when no lorepack entry exists. */
    isAutoDetectEnabled: true,

    /** Auto-detected phrases must appear at least this many times in the chapter. */
    autoDetectMinOccurrences: 2,

    /** Hide the parts of an entry marked as spoilers behind a tap-to-reveal blur. */
    shouldBlurSpoilers: true,

    cacheTtlDays: 30,
  };

  const STORAGE_PREFIX = 'lorelens:v1:';
  const CHAPTER_SELECTOR = '#LNReader-chapter';
  const MARK_CLASS = 'lorelens-term';
  const SKIP_SELECTOR = 'a, code, pre, script, style, .' + MARK_CLASS;
  const MAX_TERM_WORDS = 4;
  const NODES_PER_FRAME = 120;

  const SENTENCE_STARTER_WORDS = new Set([
    'the', 'a', 'an', 'he', 'she', 'it', 'they', 'his', 'her', 'their', 'this',
    'that', 'these', 'those', 'but', 'and', 'if', 'when', 'while', 'after',
    'before', 'however', 'although', 'though', 'even', 'still', 'yet', 'so',
    'then', 'there', 'here', 'now', 'once', 'as', 'at', 'in', 'on', 'of', 'for',
    'with', 'without', 'from', 'to', 'by', 'chapter', 'i', 'you', 'we', 'my',
    'your', 'our', 'no', 'not', 'what', 'why', 'how', 'who', 'all', 'some',
    'every', 'each', 'many', 'much', 'more', 'most', 'his', 'its', 'one', 'two',
  ]);

  /* ------------------------------------------------------------- utilities */

  function escapeForRegex(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function escapeForHtml(text) {
    return String(text == null ? '' : text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function normalizeKey(text) {
    return String(text).toLowerCase().replace(/\s+/g, ' ').trim();
  }

  function scheduleWork(callback) {
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(callback, { timeout: 400 });
      return;
    }
    setTimeout(callback, 0);
  }

  /* --------------------------------------------------------- CacheStore --- */

  /** Thin, failure-tolerant wrapper over localStorage with per-key expiry. */
  class CacheStore {
    constructor(ttlDays) {
      this.ttlMs = ttlDays * 24 * 60 * 60 * 1000;
      this.memoryEntries = new Map();
      this.hasBackingStore = CacheStore.detectBackingStore();
    }

    static detectBackingStore() {
      try {
        const probeKey = STORAGE_PREFIX + 'probe';
        window.localStorage.setItem(probeKey, '1');
        window.localStorage.removeItem(probeKey);
        return true;
      } catch (error) {
        return false;
      }
    }

    read(key) {
      if (this.memoryEntries.has(key)) return this.memoryEntries.get(key);
      if (!this.hasBackingStore) return null;
      try {
        const raw = window.localStorage.getItem(STORAGE_PREFIX + key);
        if (!raw) return null;
        const entry = JSON.parse(raw);
        if (Date.now() - entry.savedAt > this.ttlMs) {
          window.localStorage.removeItem(STORAGE_PREFIX + key);
          return null;
        }
        this.memoryEntries.set(key, entry.value);
        return entry.value;
      } catch (error) {
        return null;
      }
    }

    write(key, value) {
      this.memoryEntries.set(key, value);
      if (!this.hasBackingStore) return;
      try {
        window.localStorage.setItem(
          STORAGE_PREFIX + key,
          JSON.stringify({ savedAt: Date.now(), value }),
        );
      } catch (error) {
        /* quota exhausted — memory cache still serves this session */
      }
    }
  }

  /* -------------------------------------------------------- EntityIndex --- */

  /**
   * Owns the term → entity mapping and the single regex used to find terms.
   * Entities may be added at runtime (auto-detected phrases, live lookups).
   */
  class EntityIndex {
    constructor() {
      this.entitiesByKey = new Map();
      this.matcher = null;
      this.isMatcherStale = true;
    }

    addEntity(entity) {
      const terms = [entity.name].concat(entity.aliases || []);
      terms.forEach((term) => {
        const key = normalizeKey(term);
        if (!key || key.length < 2) return;
        if (!this.entitiesByKey.has(key)) this.entitiesByKey.set(key, entity);
      });
      this.isMatcherStale = true;
    }

    addEntities(entities) {
      (entities || []).forEach((entity) => this.addEntity(entity));
    }

    hasTerm(term) {
      return this.entitiesByKey.has(normalizeKey(term));
    }

    findEntity(term) {
      return this.entitiesByKey.get(normalizeKey(term)) || null;
    }

    get isEmpty() {
      return this.entitiesByKey.size === 0;
    }

    /** Longest-first alternation so "Young Master Gu" beats "Gu". */
    buildMatcher() {
      if (!this.isMatcherStale && this.matcher) return this.matcher;
      const terms = Array.from(this.entitiesByKey.values())
        .reduce((accumulated, entity) => {
          accumulated.push(entity.name);
          (entity.aliases || []).forEach((alias) => accumulated.push(alias));
          return accumulated;
        }, [])
        .filter((term, index, all) => all.indexOf(term) === index)
        .sort((left, right) => right.length - left.length)
        .map(escapeForRegex);

      if (terms.length === 0) {
        this.matcher = null;
        this.isMatcherStale = false;
        return null;
      }

      const body = '(?:' + terms.join('|') + ')';
      this.matcher = EntityIndex.compileBoundedMatcher(body);
      this.isMatcherStale = false;
      return this.matcher;
    }

    static compileBoundedMatcher(body) {
      try {
        return new RegExp('(?<![\\p{L}\\p{N}_])' + body + '(?![\\p{L}\\p{N}_])', 'gu');
      } catch (error) {
        return new RegExp('\\b' + body + '\\b', 'g');
      }
    }
  }

  /* ---------------------------------------------------- AutoTermDetector --- */

  /** Finds repeated Capitalised Phrases so the tool is useful with no lorepack. */
  class AutoTermDetector {
    constructor(minOccurrences) {
      this.minOccurrences = minOccurrences;
    }

    detectTerms(plainText) {
      const phrasePattern = new RegExp(
        '\\b[A-Z][a-z\'’-]+(?:\\s+(?:of|the|de)?\\s*[A-Z][a-z\'’-]+){0,' +
          (MAX_TERM_WORDS - 1) +
          '}\\b',
        'g',
      );
      const countsByPhrase = new Map();
      let match = phrasePattern.exec(plainText);

      while (match !== null) {
        const phrase = match[0].trim();
        if (this.isPlausibleTerm(phrase, plainText, match.index)) {
          countsByPhrase.set(phrase, (countsByPhrase.get(phrase) || 0) + 1);
        }
        match = phrasePattern.exec(plainText);
      }

      return Array.from(countsByPhrase.entries())
        .filter(([, count]) => count >= this.minOccurrences)
        .map(([phrase]) => phrase);
    }

    isPlausibleTerm(phrase, plainText, offset) {
      if (phrase.length < 3) return false;
      const firstWord = phrase.split(/\s+/)[0].toLowerCase();
      if (SENTENCE_STARTER_WORDS.has(firstWord)) return false;

      const isSingleWord = phrase.indexOf(' ') === -1;
      if (!isSingleWord) return true;

      // A lone capitalised word only counts mid-sentence, never after a stop.
      const precedingText = plainText.slice(Math.max(0, offset - 40), offset);
      return !/(^|[.!?"“”]\s*|\n\s*)$/.test(precedingText);
    }
  }

  /* ---------------------------------------------------------- WikiClient --- */

  /** Reads article summaries from a Fandom (MediaWiki) instance. */
  class WikiClient {
    constructor(wikiSubdomain, cacheStore) {
      this.wikiSubdomain = wikiSubdomain;
      this.cacheStore = cacheStore;
      this.pendingRequests = new Map();
    }

    get isConfigured() {
      return Boolean(this.wikiSubdomain);
    }

    buildArticleUrl(title) {
      return (
        'https://' +
        this.wikiSubdomain +
        '.fandom.com/wiki/' +
        encodeURIComponent(title.replace(/\s+/g, '_'))
      );
    }

    async fetchEntity(title) {
      if (!this.isConfigured) return null;

      const cacheKey = 'wiki:' + this.wikiSubdomain + ':' + normalizeKey(title);
      const cachedEntity = this.cacheStore.read(cacheKey);
      if (cachedEntity) return cachedEntity;
      if (this.pendingRequests.has(cacheKey)) return this.pendingRequests.get(cacheKey);

      const request = this.requestArticle(title)
        .then((entity) => {
          if (entity) this.cacheStore.write(cacheKey, entity);
          this.pendingRequests.delete(cacheKey);
          return entity;
        })
        .catch(() => {
          this.pendingRequests.delete(cacheKey);
          return null;
        });

      this.pendingRequests.set(cacheKey, request);
      return request;
    }

    async requestArticle(title) {
      const endpoint =
        'https://' +
        this.wikiSubdomain +
        '.fandom.com/api.php' +
        '?action=query&format=json&origin=*&redirects=1&prop=extracts|pageimages' +
        '&exintro=1&explaintext=1&exsentences=6&piprop=thumbnail&pithumbsize=640' +
        '&titles=' +
        encodeURIComponent(title);

      const response = await fetch(endpoint, { credentials: 'omit' });
      if (!response.ok) throw new Error('wiki request failed: ' + response.status);

      const payload = await response.json();
      const pages = (payload.query && payload.query.pages) || {};
      const page = Object.values(pages)[0];
      if (!page || page.missing !== undefined || !page.extract) return null;

      return {
        id: 'wiki-' + normalizeKey(page.title).replace(/\s+/g, '-'),
        name: page.title,
        aliases: [],
        type: 'wiki',
        image: page.thumbnail ? page.thumbnail.source : '',
        chips: [{ label: 'From wiki', tone: 'neutral' }],
        sections: [{ title: 'Summary', body: page.extract, isSpoiler: false }],
        wikiUrl: this.buildArticleUrl(page.title),
      };
    }
  }

  /* ------------------------------------------------------------ LoreSheet --- */

  /** The bottom sheet: builds its own DOM and styles once, then renders entries. */
  class LoreSheet {
    constructor(options) {
      this.shouldBlurSpoilers = options.shouldBlurSpoilers;
      this.injectStyles();
      this.buildElements();
    }

    injectStyles() {
      if (document.getElementById('lorelens-styles')) return;
      const style = document.createElement('style');
      style.id = 'lorelens-styles';
      style.textContent = LoreSheet.STYLE_TEXT;
      document.head.appendChild(style);
    }

    buildElements() {
      this.backdrop = document.createElement('div');
      this.backdrop.className = 'lorelens-backdrop';
      this.backdrop.addEventListener('click', () => this.close());

      this.sheet = document.createElement('aside');
      this.sheet.className = 'lorelens-sheet';
      this.sheet.setAttribute('role', 'dialog');
      this.sheet.setAttribute('aria-modal', 'true');
      this.sheet.addEventListener('click', (event) => event.stopPropagation());

      document.body.appendChild(this.backdrop);
      document.body.appendChild(this.sheet);

      document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') this.close();
      });
    }

    open() {
      this.backdrop.classList.add('is-visible');
      this.sheet.classList.add('is-visible');
    }

    close() {
      this.backdrop.classList.remove('is-visible');
      this.sheet.classList.remove('is-visible');
    }

    renderLoading(term) {
      this.sheet.innerHTML =
        '<div class="lorelens-grip"></div>' +
        '<div class="lorelens-state">' +
        '<p class="lorelens-state-title">' + escapeForHtml(term) + '</p>' +
        '<p class="lorelens-state-body">Looking this up…</p>' +
        '</div>';
      this.open();
    }

    renderMissing(term, hasWiki) {
      const advice = hasWiki
        ? 'No wiki article matches this name. Try a longer form of it, or add it to your lorepack.'
        : 'No entry yet. Add it to your lorepack, or set fandomWiki in the config to look names up live.';
      this.sheet.innerHTML =
        '<div class="lorelens-grip"></div>' +
        '<div class="lorelens-state">' +
        '<p class="lorelens-state-title">' + escapeForHtml(term) + '</p>' +
        '<p class="lorelens-state-body">' + advice + '</p>' +
        '</div>';
      this.open();
    }

    renderEntity(entity) {
      this.sheet.innerHTML =
        '<div class="lorelens-grip"></div>' +
        this.buildHeaderMarkup(entity) +
        this.buildPortraitMarkup(entity) +
        this.buildChipsMarkup(entity) +
        this.buildSectionsMarkup(entity) +
        this.buildFooterMarkup(entity);

      this.bindSpoilerToggles();
      this.sheet.scrollTop = 0;
      this.open();
    }

    buildHeaderMarkup(entity) {
      const scriptLine = [entity.native, entity.romanized]
        .filter(Boolean)
        .map(escapeForHtml)
        .join(' · ');
      return (
        '<header class="lorelens-header">' +
        '<h2 class="lorelens-name">' + escapeForHtml(entity.name) + '</h2>' +
        (scriptLine ? '<p class="lorelens-script">' + scriptLine + '</p>' : '') +
        '</header>'
      );
    }

    buildPortraitMarkup(entity) {
      if (!entity.image) return '';
      return (
        '<figure class="lorelens-portrait">' +
        '<img src="' + escapeForHtml(entity.image) + '" alt="" loading="lazy" ' +
        'onerror="this.parentNode.remove()">' +
        '</figure>'
      );
    }

    buildChipsMarkup(entity) {
      const chips = entity.chips || [];
      if (chips.length === 0) return '';
      const items = chips
        .map((chip) => {
          const tone = ['good', 'bad', 'accent', 'neutral'].indexOf(chip.tone) >= 0
            ? chip.tone
            : 'neutral';
          return (
            '<span class="lorelens-chip lorelens-chip--' + tone + '">' +
            escapeForHtml(chip.label) +
            '</span>'
          );
        })
        .join('');
      return '<div class="lorelens-chips">' + items + '</div>';
    }

    buildSectionsMarkup(entity) {
      const sections = entity.sections || [];
      if (sections.length === 0) return '';
      const blocks = sections
        .map((section, index) => {
          const shouldHide = this.shouldBlurSpoilers && section.isSpoiler;
          return (
            '<section class="lorelens-section">' +
            '<h3 class="lorelens-section-title">' +
            escapeForHtml(section.title || 'Notes') +
            (section.isSpoiler ? '<span class="lorelens-spoiler-tag">spoiler</span>' : '') +
            '</h3>' +
            '<div class="lorelens-body' + (shouldHide ? ' is-hidden' : '') + '"' +
            (shouldHide ? ' data-spoiler-index="' + index + '"' : '') + '>' +
            escapeForHtml(section.body).replace(/\n+/g, '</p><p>').replace(/^/, '<p>') +
            '</p></div>' +
            (shouldHide
              ? '<button class="lorelens-reveal" data-reveal-index="' + index + '">' +
                'Show spoiler</button>'
              : '') +
            '</section>'
          );
        })
        .join('');
      return '<div class="lorelens-sections">' + blocks + '</div>';
    }

    buildFooterMarkup(entity) {
      const links = [];
      if (entity.wikiUrl) {
        links.push(
          '<a class="lorelens-link" href="' + escapeForHtml(entity.wikiUrl) + '" ' +
          'target="_blank" rel="noopener">Open wiki page ↗</a>',
        );
      }
      links.push('<button class="lorelens-link lorelens-close">Close</button>');
      const footer =
        '<footer class="lorelens-footer">' + links.join('') + '</footer>';
      // Bind after insertion happens in renderEntity via delegation below.
      return footer;
    }

    bindSpoilerToggles() {
      this.sheet.querySelectorAll('.lorelens-reveal').forEach((button) => {
        button.addEventListener('click', () => {
          const index = button.getAttribute('data-reveal-index');
          const body = this.sheet.querySelector('[data-spoiler-index="' + index + '"]');
          if (body) body.classList.remove('is-hidden');
          button.remove();
        });
      });
      const closeButton = this.sheet.querySelector('.lorelens-close');
      if (closeButton) closeButton.addEventListener('click', () => this.close());
    }
  }

  LoreSheet.STYLE_TEXT = [
    '.' + MARK_CLASS + '{color:var(--theme-primary);',
    'text-decoration:underline;text-decoration-style:dotted;',
    'text-underline-offset:.18em;text-decoration-thickness:1px;',
    'cursor:pointer;-webkit-tap-highlight-color:transparent}',
    '.' + MARK_CLASS + ':active{opacity:.6}',
    '.lorelens-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.55);',
    'opacity:0;pointer-events:none;transition:opacity .18s ease;z-index:2147483000}',
    '.lorelens-backdrop.is-visible{opacity:1;pointer-events:auto}',
    '.lorelens-sheet{position:fixed;left:0;right:0;bottom:0;z-index:2147483001;',
    'max-height:78vh;overflow-y:auto;-webkit-overflow-scrolling:touch;',
    'background:var(--theme-surface,#181818);color:var(--theme-onSurface,#eee);',
    'border-top:1px solid var(--theme-outline,rgba(255,255,255,.14));',
    'border-radius:20px 20px 0 0;padding:0 18px 24px;',
    'transform:translateY(102%);transition:transform .26s cubic-bezier(.22,1,.36,1);',
    'font-family:var(--readerSettings-fontFamily,inherit);',
    'box-shadow:0 -12px 40px rgba(0,0,0,.45)}',
    '.lorelens-sheet.is-visible{transform:translateY(0)}',
    '@media (prefers-reduced-motion:reduce){.lorelens-sheet{transition:none}}',
    '@media (min-width:720px){.lorelens-sheet{left:auto;right:24px;bottom:24px;',
    'width:380px;max-height:70vh;border-radius:18px;',
    'border:1px solid var(--theme-outline,rgba(255,255,255,.14))}}',
    '.lorelens-grip{width:36px;height:4px;border-radius:2px;margin:10px auto 4px;',
    'background:var(--theme-outline,rgba(255,255,255,.25))}',
    '.lorelens-header{padding:8px 0 2px}',
    '.lorelens-name{margin:0;font-size:1.35em;line-height:1.2;font-weight:600;',
    'letter-spacing:-.01em;color:var(--theme-onSurface,#fff)}',
    '.lorelens-script{margin:4px 0 0;font-size:.85em;letter-spacing:.06em;',
    'color:var(--theme-onSurfaceVariant,#aaa)}',
    '.lorelens-portrait{margin:14px 0 0;border-radius:14px;overflow:hidden;',
    'background:var(--theme-surfaceVariant,#222)}',
    '.lorelens-portrait img{display:block;width:100%;height:auto;max-height:44vh;',
    'object-fit:cover}',
    '.lorelens-chips{display:flex;flex-wrap:wrap;gap:6px;margin:14px 0 0}',
    '.lorelens-chip{font-size:.72em;letter-spacing:.04em;text-transform:uppercase;',
    'padding:4px 9px;border-radius:999px;white-space:nowrap;',
    'background:var(--theme-surfaceVariant,#262626);',
    'color:var(--theme-onSurfaceVariant,#bbb)}',
    '.lorelens-chip--accent{background:var(--theme-primary,#7aa2f7);',
    'color:var(--theme-onPrimary,#000)}',
    '.lorelens-chip--good{background:rgba(56,161,105,.22);color:#5fd39a}',
    '.lorelens-chip--bad{background:rgba(214,73,73,.22);color:#f08a8a}',
    '.lorelens-sections{margin-top:18px}',
    '.lorelens-section+.lorelens-section{margin-top:16px}',
    '.lorelens-section-title{display:flex;align-items:center;gap:8px;margin:0 0 6px;',
    'font-size:.72em;font-weight:600;letter-spacing:.14em;text-transform:uppercase;',
    'color:var(--theme-onSurfaceVariant,#999)}',
    '.lorelens-spoiler-tag{letter-spacing:.06em;text-transform:none;font-weight:500;',
    'padding:1px 6px;border-radius:4px;background:rgba(214,73,73,.2);color:#f08a8a}',
    '.lorelens-body{font-size:.92em;line-height:1.55;',
    'color:var(--theme-onSurface,#ddd)}',
    '.lorelens-body p{margin:0 0 .6em}',
    '.lorelens-body.is-hidden{filter:blur(6px);user-select:none;pointer-events:none}',
    '.lorelens-reveal{margin-top:6px;font:inherit;font-size:.8em;cursor:pointer;',
    'padding:5px 12px;border-radius:999px;border:1px solid var(--theme-outline,#444);',
    'background:transparent;color:var(--theme-primary,#7aa2f7)}',
    '.lorelens-footer{display:flex;gap:10px;align-items:center;margin-top:20px;',
    'padding-top:14px;border-top:1px solid var(--theme-outline,rgba(255,255,255,.1))}',
    '.lorelens-link{font:inherit;font-size:.85em;cursor:pointer;text-decoration:none;',
    'padding:8px 14px;border-radius:10px;border:1px solid var(--theme-outline,#444);',
    'background:transparent;color:var(--theme-primary,#7aa2f7)}',
    '.lorelens-state{padding:18px 0 8px}',
    '.lorelens-state-title{margin:0 0 6px;font-size:1.15em;font-weight:600}',
    '.lorelens-state-body{margin:0;font-size:.9em;line-height:1.5;',
    'color:var(--theme-onSurfaceVariant,#aaa)}',
  ].join('');

  /* ------------------------------------------------------ TextHighlighter --- */

  /** Walks chapter text nodes and wraps every indexed term in a tappable span. */
  class TextHighlighter {
    constructor(entityIndex) {
      this.entityIndex = entityIndex;
    }

    highlightWithin(rootElement) {
      const matcher = this.entityIndex.buildMatcher();
      if (!matcher) return;
      const textNodes = this.collectTextNodes(rootElement);
      this.processInBatches(textNodes, matcher, 0);
    }

    collectTextNodes(rootElement) {
      const walker = document.createTreeWalker(rootElement, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          if (!node.nodeValue || node.nodeValue.trim().length < 2) {
            return NodeFilter.FILTER_REJECT;
          }
          if (node.parentElement && node.parentElement.closest(SKIP_SELECTOR)) {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        },
      });

      const nodes = [];
      let currentNode = walker.nextNode();
      while (currentNode !== null) {
        nodes.push(currentNode);
        currentNode = walker.nextNode();
      }
      return nodes;
    }

    processInBatches(textNodes, matcher, startIndex) {
      const endIndex = Math.min(startIndex + NODES_PER_FRAME, textNodes.length);
      for (let index = startIndex; index < endIndex; index += 1) {
        this.wrapMatchesInNode(textNodes[index], matcher);
      }
      if (endIndex < textNodes.length) {
        scheduleWork(() => this.processInBatches(textNodes, matcher, endIndex));
      }
    }

    wrapMatchesInNode(textNode, matcher) {
      if (!textNode.parentNode) return;
      const text = textNode.nodeValue;
      matcher.lastIndex = 0;
      if (!matcher.test(text)) return;

      matcher.lastIndex = 0;
      const fragment = document.createDocumentFragment();
      let cursor = 0;
      let match = matcher.exec(text);

      while (match !== null) {
        if (match.index > cursor) {
          fragment.appendChild(
            document.createTextNode(text.slice(cursor, match.index)),
          );
        }
        fragment.appendChild(TextHighlighter.createTermElement(match[0]));
        cursor = match.index + match[0].length;
        match = matcher.exec(text);
      }

      if (cursor < text.length) {
        fragment.appendChild(document.createTextNode(text.slice(cursor)));
      }
      textNode.parentNode.replaceChild(fragment, textNode);
    }

    static createTermElement(term) {
      const element = document.createElement('span');
      element.className = MARK_CLASS;
      element.setAttribute('data-lorelens-term', term);
      element.setAttribute('role', 'button');
      element.setAttribute('tabindex', '0');
      element.textContent = term;
      return element;
    }
  }

  /* ---------------------------------------------------------- LoreLensApp --- */

  class LoreLensApp {
    constructor(config) {
      this.config = config;
      this.cacheStore = new CacheStore(config.cacheTtlDays);
      this.entityIndex = new EntityIndex();
      this.wikiClient = new WikiClient(config.fandomWiki, this.cacheStore);
      this.sheet = new LoreSheet({ shouldBlurSpoilers: config.shouldBlurSpoilers });
      this.highlighter = new TextHighlighter(this.entityIndex);
      this.autoDetector = new AutoTermDetector(config.autoDetectMinOccurrences);
    }

    async start() {
      const chapterElement = document.querySelector(CHAPTER_SELECTOR);
      if (!chapterElement) return;

      this.bindTermTaps(chapterElement);

      const lorepack = await this.loadLorepack();
      if (lorepack) this.entityIndex.addEntities(lorepack.entities);

      if (this.config.isAutoDetectEnabled) {
        this.indexAutoDetectedTerms(chapterElement);
      }
      if (this.entityIndex.isEmpty) return;

      this.highlighter.highlightWithin(chapterElement);
      this.watchForNewContent(chapterElement);
    }

    async loadLorepack() {
      if (this.config.inlineLorepack) return this.config.inlineLorepack;
      if (!this.config.lorepackUrl) return null;

      const cacheKey = 'lorepack:' + this.config.lorepackUrl;
      const cachedPack = this.cacheStore.read(cacheKey);
      if (cachedPack) return cachedPack;

      try {
        const response = await fetch(this.config.lorepackUrl, { credentials: 'omit' });
        if (!response.ok) return null;
        const lorepack = await response.json();
        this.cacheStore.write(cacheKey, lorepack);
        return lorepack;
      } catch (error) {
        return null;
      }
    }

    indexAutoDetectedTerms(chapterElement) {
      const plainText = chapterElement.innerText || chapterElement.textContent || '';
      const detectedTerms = this.autoDetector.detectTerms(plainText);
      detectedTerms.forEach((term) => {
        if (this.entityIndex.hasTerm(term)) return;
        this.entityIndex.addEntity({
          id: 'auto-' + normalizeKey(term).replace(/\s+/g, '-'),
          name: term,
          aliases: [],
          type: 'auto',
          isPlaceholder: true,
        });
      });
    }

    bindTermTaps(chapterElement) {
      chapterElement.addEventListener(
        'click',
        (event) => {
          const target = event.target.closest('.' + MARK_CLASS);
          if (!target) return;
          event.preventDefault();
          event.stopPropagation();
          this.showTerm(target.getAttribute('data-lorelens-term'));
        },
        true,
      );
    }

    async showTerm(term) {
      const entity = this.entityIndex.findEntity(term);

      if (entity && !entity.isPlaceholder) {
        this.sheet.renderEntity(entity);
        return;
      }

      if (!this.config.isLiveLookupEnabled || !this.wikiClient.isConfigured) {
        this.sheet.renderMissing(term, false);
        return;
      }

      this.sheet.renderLoading(term);
      const wikiEntity = await this.wikiClient.fetchEntity(term);
      if (!wikiEntity) {
        this.sheet.renderMissing(term, true);
        return;
      }
      this.entityIndex.addEntity(wikiEntity);
      this.sheet.renderEntity(wikiEntity);
    }

    /** Page-reader mode and lazy loaders can append paragraphs after first paint. */
    watchForNewContent(chapterElement) {
      let debounceTimer = null;
      const observer = new MutationObserver(() => {
        window.clearTimeout(debounceTimer);
        debounceTimer = window.setTimeout(() => {
          observer.disconnect();
          this.highlighter.highlightWithin(chapterElement);
          observer.observe(chapterElement, { childList: true, subtree: true });
        }, 250);
      });
      observer.observe(chapterElement, { childList: true, subtree: true });
    }
  }

  /* -------------------------------------------------------------- bootstrap */

  try {
    new LoreLensApp(CONFIG).start();
  } catch (error) {
    /* never break the reader */
  }
})();
