
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
