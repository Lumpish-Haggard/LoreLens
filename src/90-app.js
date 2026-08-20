
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
      this.scanStartedAt = 0;
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
        onClose: guard('app.panelClosed', this.revalidateHighlights.bind(this)),
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
    /**
     * Re-mark the chapter if the marks have gone.
     *
     * Called when a panel closes, because that is when the reader is most
     * likely to have re-rendered the chapter underneath it, and a reader whose
     * highlights vanished after looking one name up has no way of getting them
     * back short of leaving the novel and coming in again.
     */
    revalidateHighlights() {
      if (!this.settings.get('enabled') || !this.highlighter) return;
      if (this.highlighter.isStillPainted(this.context.root)) return;
      log('marks went missing; re-running');
      this.scan();
    }

    scan() {
      /* A scan that somehow never finished must not wedge the tool forever. */
      if (this.isScanning) {
        if (Date.now() - this.scanStartedAt < 10000) return;
        log('previous scan never finished; starting a new one');
      }
      this.isScanning = true;
      this.scanStartedAt = Date.now();

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

    /**
     * Listen on the document rather than the chapter element.
     *
     * A listener bound to the chapter container dies with it the moment the
     * reader swaps that container out for the next chapter, and taps stop
     * working with nothing to show why. The document outlives every re-render.
     */
    bindTaps() {
      const self = this;

      document.addEventListener('click', guard('app.tap', function (event) {
        if (!self.settings.get('enabled')) return;

        const root = self.context.root;
        if (!root || !event.target) return;
        /* Ignore taps on our own UI, and anything outside the prose. */
        if (event.target.closest && event.target.closest('.lorelens-ui')) return;
        if (!root.contains(event.target)) return;

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
        const previousRoot = self.context.root;
        self.context.detect();

        /* If the reader swapped the whole container out, we have been watching
         * a detached element ever since — no further mutation would ever reach
         * us, so the next chapter would never get marked. */
        if (self.context.root && self.context.root !== previousRoot) {
          log('chapter container was replaced; re-attaching the observer');
          self.observeRoot();
        }

        if (self.context.chapterTitle !== previousTitle) {
          log('chapter changed:', self.context.chapterTitle);
          self.settings.useNovel(self.context.novelKey);
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

      this.observeRoot();
    }

    /** Point the chapter observer at the current root, wherever it moved to. */
    observeRoot() {
      if (!this.observer || !this.context.root) return;
      try {
        this.observer.disconnect();
        this.observer.observe(this.context.root, { childList: true, subtree: true });
      } catch (error) {
        log('could not observe the chapter:', (error && error.message) || String(error));
      }
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
