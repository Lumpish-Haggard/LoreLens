
  /* ------------------------------------------------------------- utilities */

  /**
   * Diagnostics ring buffer. Everything interesting that happens gets a line
   * here, and the settings panel can copy the whole thing to the clipboard.
   * Bug reports from inside a phone reader are otherwise almost content-free,
   * so this is the difference between a fixable report and a guess.
   */
  const logLines = [];
  const startedAt = Date.now();

  function log() {
    const parts = Array.prototype.slice.call(arguments).map(function (part) {
      if (typeof part === 'string') return part;
      try {
        return JSON.stringify(part);
      } catch (error) {
        return String(part);
      }
    });
    const elapsed = String(Date.now() - startedAt).padStart(6, ' ');
    logLines.push(elapsed + 'ms  ' + parts.join(' '));
    if (logLines.length > LOG_CAPACITY) logLines.shift();
  }

  /**
   * Wrap anything that the reader will call into. A LoreLens bug must never be
   * able to take the chapter down with it — a reader that will not scroll is a
   * far worse outcome than a reader with no highlights.
   */
  function guard(label, fn) {
    return function guarded() {
      try {
        return fn.apply(this, arguments);
      } catch (error) {
        log('ERROR in ' + label + ':', (error && error.message) || String(error));
        return undefined;
      }
    };
  }

  /** The async twin of guard(). Rejections become undefined, never unhandled. */
  function guardAsync(label, fn) {
    return function guardedAsync() {
      try {
        return Promise.resolve(fn.apply(this, arguments)).catch(function (error) {
          log('ERROR in ' + label + ':', (error && error.message) || String(error));
          return undefined;
        });
      } catch (error) {
        log('ERROR in ' + label + ':', (error && error.message) || String(error));
        return Promise.resolve(undefined);
      }
    };
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /**
   * For anything going into an href or src. Wiki data is untrusted input, and
   * "untrusted" includes a page whose infobox image field somebody set to a
   * javascript: URL.
   */
  function escapeUrl(value) {
    const text = String(value == null ? '' : value).trim();
    if (!/^https?:\/\//i.test(text)) return '';
    return escapeHtml(text);
  }

  function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Case- and accent-insensitive key for looking a term up. Normalising width
   * and diacritics matters more than it looks: translated novels mix "Lu Yu",
   * "Lú Yǔ" and full-width punctuation inside a single chapter.
   */
  function foldKey(value) {
    let text = String(value == null ? '' : value);
    if (typeof text.normalize === 'function') {
      try {
        text = text.normalize('NFKD').replace(/[̀-ͯ]/g, '');
      } catch (error) {
        /* older engines: fall through with the unnormalised string */
      }
    }
    return text
      .toLowerCase()
      .replace(/[‘’ʼ]/g, "'")
      .replace(/[‐-―]/g, '-')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function slugify(value) {
    return foldKey(value)
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  function titleToWikiPath(title) {
    return encodeURIComponent(String(title).replace(/\s+/g, '_'));
  }

  function clamp(value, low, high) {
    return Math.min(high, Math.max(low, value));
  }

  function unique(items) {
    const seen = new Set();
    const out = [];
    for (const item of items) {
      const key = foldKey(item);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(item);
    }
    return out;
  }

  function debounce(fn, waitMs) {
    let timer = null;
    return function debounced() {
      const args = arguments;
      const self = this;
      window.clearTimeout(timer);
      timer = window.setTimeout(function () {
        fn.apply(self, args);
      }, waitMs);
    };
  }

  /** Yield to the reader. Highlighting must never win a fight with scrolling. */
  function whenIdle(fn) {
    if (typeof window.requestIdleCallback === 'function') {
      window.requestIdleCallback(fn, { timeout: 500 });
    } else if (typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(function () {
        window.setTimeout(fn, 0);
      });
    } else {
      window.setTimeout(fn, 0);
    }
  }

  function sleep(ms) {
    return new Promise(function (resolve) {
      window.setTimeout(resolve, ms);
    });
  }

  /**
   * Split prose into sentences. Not linguistically perfect and does not need to
   * be — it feeds the spoiler guard, where the cost of a bad split is that one
   * extra clause gets hidden.
   */
  function splitSentences(text) {
    const cleaned = String(text || '').replace(/\s+/g, ' ').trim();
    if (!cleaned) return [];
    const parts = cleaned.match(/[^.!?]+[.!?]+(?:["'”’)]+)?\s*|[^.!?]+$/g);
    return (parts || [cleaned]).map(function (part) {
      return part.trim();
    }).filter(Boolean);
  }

  /* ------------------------------------------------------------- colours -- */

  /**
   * The panel has to sit inside whatever theme the reader is using, including
   * themes that did not exist when this was written. Rather than hardcode the
   * reader's CSS variable names — which differ between apps and change between
   * releases — we read the colours the page is actually painting and build a
   * matching palette from them. That works everywhere and cannot go stale.
   */

  function parseColor(value) {
    const text = String(value || '').trim();
    if (!text) return null;

    let match = text.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.%]+))?\s*\)$/i);
    if (match) {
      let alpha = 1;
      if (match[4] != null) {
        alpha = match[4].indexOf('%') >= 0 ? parseFloat(match[4]) / 100 : parseFloat(match[4]);
      }
      return {
        r: clamp(parseFloat(match[1]), 0, 255),
        g: clamp(parseFloat(match[2]), 0, 255),
        b: clamp(parseFloat(match[3]), 0, 255),
        a: clamp(alpha, 0, 1),
      };
    }

    match = text.match(/^#([0-9a-f]{3,8})$/i);
    if (match) {
      const hex = match[1];
      const expand = function (part) {
        return parseInt(part.length === 1 ? part + part : part, 16);
      };
      if (hex.length === 3 || hex.length === 4) {
        return {
          r: expand(hex[0]),
          g: expand(hex[1]),
          b: expand(hex[2]),
          a: hex.length === 4 ? expand(hex[3]) / 255 : 1,
        };
      }
      if (hex.length === 6 || hex.length === 8) {
        return {
          r: expand(hex.slice(0, 2)),
          g: expand(hex.slice(2, 4)),
          b: expand(hex.slice(4, 6)),
          a: hex.length === 8 ? expand(hex.slice(6, 8)) / 255 : 1,
        };
      }
    }

    return null;
  }

  /** Perceived brightness, 0 (black) to 1 (white). Good enough for theme choice. */
  function luminance(color) {
    if (!color) return 0;
    const channel = function (value) {
      const scaled = value / 255;
      return scaled <= 0.03928 ? scaled / 12.92 : Math.pow((scaled + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
  }

  function mixColors(from, to, amount) {
    return {
      r: Math.round(from.r + (to.r - from.r) * amount),
      g: Math.round(from.g + (to.g - from.g) * amount),
      b: Math.round(from.b + (to.b - from.b) * amount),
      a: 1,
    };
  }

  function toCss(color, alpha) {
    const a = alpha == null ? (color.a == null ? 1 : color.a) : alpha;
    return 'rgba(' + Math.round(color.r) + ',' + Math.round(color.g) + ',' + Math.round(color.b) + ',' + a + ')';
  }

  /** Is this colour actually painted, or is it a transparent placeholder? */
  function isOpaqueEnough(color) {
    return Boolean(color) && color.a > 0.5;
  }
