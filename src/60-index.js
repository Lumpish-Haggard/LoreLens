
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
