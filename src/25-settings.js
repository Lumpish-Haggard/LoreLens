
  /* -------------------------------------------------------------- settings */

  /**
   * Every setting lives here and every one of them is editable from the panel
   * inside the reader. Nothing in this file is meant to be hand-edited before
   * pasting — that was the old way, it meant re-pasting the whole script to
   * change one thing, and it is why the defaults below are chosen to be
   * correct for someone who never opens the settings at all.
   */
  const DEFAULT_SETTINGS = {
    /** Master switch. Off means no highlights, no panel, no requests. */
    enabled: true,

    /**
     * 'balanced' underlines names we are confident about and dims maybes.
     * 'generous' highlights anything name-shaped. 'strict' only highlights
     * names confirmed to exist on the wiki.
     */
    detection: 'balanced',

    /** Highlight only the first mention of a name in each paragraph. */
    firstMentionOnly: true,

    /**
     * How much of a wiki entry to hide.
     *   'chapter' — hide anything the wiki ties to a chapter past where you are
     *   'strong'  — the above, plus fate tags and anything that reads final
     *   'off'     — show everything
     */
    spoilerGuard: 'chapter',

    /** Your position in the book. Auto-filled from the chapter title. */
    chapterProgress: 0,

    /** Fandom subdomain override for this novel, e.g. 'shadowslave'. */
    wiki: '',

    /** Look names up on the wiki when tapped. Off makes LoreLens fully offline. */
    liveLookup: true,

    /** Quietly fetch the most common names after a chapter loads, so taps are instant. */
    prefetch: true,

    /** Show a floating button to open settings. Off leaves only the long-press path. */
    showButton: true,

    /** Select any text and get a "Look up" button, even on names we did not highlight. */
    selectionLookup: true,

    /** Optional offline lorepack, for people who want zero network at read time. */
    lorepackUrl: '',
  };

  const SETTINGS_KEY = 'settings';

  class Settings {
    constructor(store) {
      this.store = store;
      this.values = Object.assign({}, DEFAULT_SETTINGS);
      this.perNovel = {};
      this.novelKey = '';
      this.listeners = [];
      this.load();
    }

    load() {
      const saved = this.store.read(SETTINGS_KEY);
      if (saved && typeof saved === 'object') {
        /* Only adopt keys we still know about, so a setting removed in a later
         * version cannot resurrect itself out of someone's storage. */
        for (const key of Object.keys(DEFAULT_SETTINGS)) {
          if (Object.prototype.hasOwnProperty.call(saved, key)) {
            this.values[key] = saved[key];
          }
        }
        this.perNovel = (saved.perNovel && typeof saved.perNovel === 'object') ? saved.perNovel : {};
      }
    }

    save() {
      const payload = Object.assign({}, this.values, { perNovel: this.perNovel });
      this.store.write(SETTINGS_KEY, payload, 0);
    }

    /**
     * Bind to a novel. Anything set from here on is remembered for this novel
     * specifically — which wiki it uses and how far in you are — because those
     * two are meaningless globally.
     */
    useNovel(novelKey) {
      this.novelKey = novelKey || '';
      const scoped = this.perNovel[this.novelKey];
      if (scoped) {
        if (scoped.wiki) this.values.wiki = scoped.wiki;
        if (scoped.chapterProgress) this.values.chapterProgress = scoped.chapterProgress;
      } else {
        this.values.wiki = '';
        this.values.chapterProgress = 0;
      }
    }

    get(key) {
      return this.values[key];
    }

    set(key, value) {
      if (!Object.prototype.hasOwnProperty.call(DEFAULT_SETTINGS, key)) return;
      this.values[key] = value;

      if ((key === 'wiki' || key === 'chapterProgress') && this.novelKey) {
        if (!this.perNovel[this.novelKey]) this.perNovel[this.novelKey] = {};
        this.perNovel[this.novelKey][key] = value;
      }

      this.save();
      this.emit(key, value);
    }

    /** Update progress only upward — flicking back a chapter should not re-hide. */
    advanceProgress(chapterNumber) {
      if (!chapterNumber || chapterNumber <= this.values.chapterProgress) return;
      this.set('chapterProgress', chapterNumber);
    }

    onChange(listener) {
      this.listeners.push(listener);
    }

    emit(key, value) {
      for (const listener of this.listeners) {
        try {
          listener(key, value);
        } catch (error) {
          log('settings listener failed:', (error && error.message) || 'unknown');
        }
      }
    }

    reset() {
      this.values = Object.assign({}, DEFAULT_SETTINGS);
      this.perNovel = {};
      this.save();
      this.emit('*', null);
    }
  }
