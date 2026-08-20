
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
