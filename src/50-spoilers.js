
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
