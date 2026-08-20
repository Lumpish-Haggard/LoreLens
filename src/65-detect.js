
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
        const phrase = match[0].replace(/[\s'-]+$/, '').trim();
        if (this.isPlausible(phrase)) {
          const key = foldKey(phrase);
          const record = found.get(key) || {
            display: phrase,
            count: 0,
            midSentenceCount: 0,
            words: phrase.split(/\s+/).length,
          };
          record.count += 1;
          if (!NameDetector.isSentenceInitial(text, match.index)) {
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
