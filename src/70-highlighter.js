
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

    /**
     * Are the marks we drew still on the page?
     *
     * Ranges are anchored to text nodes, so anything that replaces the chapter's
     * nodes — the reader re-rendering after a font change, a lazy loader, its
     * own scripts restoring state when a panel closes — silently detaches them
     * and the marks vanish with no event to tell us. Cheap enough to check
     * whenever we might have been disturbed.
     */
    isStillPainted(root) {
      if (this.ranges.length === 0) {
        /* Nothing is drawn. That is only healthy if there was nothing to draw —
         * otherwise it means a run cleared the marks and then failed to put any
         * back, which is precisely the state that used to persist until the
         * reader closed the novel. */
        return this.index.isEmpty;
      }

      if (this.mode === 'highlight') {
        try {
          if (!window.CSS.highlights.has(HIGHLIGHT_NAME) &&
              !window.CSS.highlights.has(HIGHLIGHT_NAME + '-guess')) {
            return false;
          }
        } catch (error) {
          return false;
        }
      }

      /* A detached range reports a collapsed, zero-length rect, and its start
       * container is no longer inside the chapter. Sampling a few is enough. */
      const sample = Math.min(4, this.ranges.length);
      for (let index = 0; index < sample; index += 1) {
        const entry = this.ranges[index];
        try {
          const node = entry.range.startContainer;
          if (!node || (root && !root.contains(node))) return false;
        } catch (error) {
          return false;
        }
      }
      return true;
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
      let isFinished = false;

      /**
       * Whatever happens, the caller is told the run is over exactly once.
       *
       * This is not defensive padding. The walk is spread across idle
       * callbacks, so a throw inside one of them unwinds into the browser's
       * callback queue and nowhere else: the completion callback would never
       * fire, the caller's "a scan is in progress" flag would stay set forever,
       * and — because highlights are cleared at the top of a run — every mark
       * would be gone with no scan ever able to start again. The only way out
       * was to close the novel and reopen it. That was a real bug.
       */
      function finish() {
        if (isFinished) return;
        isFinished = true;
        try {
          self.commit();
        } catch (error) {
          log('could not commit highlights:', (error && error.message) || String(error));
        }
        log('highlighted', String(matchCount), 'mentions');
        if (onComplete) onComplete(matchCount);
      }

      function processBatch() {
        try {
          const end = Math.min(cursor + NODES_PER_BATCH, textNodes.length);
          for (; cursor < end; cursor += 1) {
            matchCount += self.markNode(textNodes[cursor], matcher, seenInBlock);
          }
        } catch (error) {
          /* A node that moved under us, or a selector this engine dislikes.
           * Keep whatever was matched so far rather than losing the chapter. */
          log('highlight batch failed:', (error && error.message) || String(error));
          finish();
          return;
        }

        if (cursor < textNodes.length) {
          whenIdle(processBatch);
          return;
        }
        finish();
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
