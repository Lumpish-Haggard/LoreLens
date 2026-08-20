
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
