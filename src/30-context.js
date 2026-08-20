
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
