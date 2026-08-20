
  /* --------------------------------------------------------------- storage */

  /**
   * A last-resort store built on `window.name`.
   *
   * LNReader hands the WebView its chapter as `source={{ html }}` with no
   * baseUrl, which means the document has no real origin. Every origin-scoped
   * API is then either unavailable or scoped to a bucket that does not survive
   * the next document — and since a new chapter is a new document, anything
   * kept in localStorage can be gone by the time the reader turns the page.
   * That shows up as being asked which wiki to use over and over.
   *
   * `window.name` is the one string that survives a navigation in the same
   * window without belonging to an origin. It is a blunt instrument: shared
   * with whatever else is on the page, and lost when the window is destroyed.
   * So it is used alongside the real stores rather than instead of them, and it
   * refuses to touch a value that is not ours.
   *
   * Declared before Store because a class declaration is not hoisted.
   */
  const WINDOW_NAME_MARKER = 'lorelens1:';

  /** Above this, a value is too big to be worth carrying in window.name. */
  const WINDOW_NAME_VALUE_LIMIT = 8 * 1024;

  class WindowNameBackend {
    read() {
      const raw = String(window.name || '');
      if (raw.indexOf(WINDOW_NAME_MARKER) !== 0) return {};
      try {
        return JSON.parse(raw.slice(WINDOW_NAME_MARKER.length)) || {};
      } catch (error) {
        return {};
      }
    }

    save(map) {
      const encoded = WINDOW_NAME_MARKER + JSON.stringify(map);
      if (encoded.length > 96 * 1024) throw new Error('window.name budget exhausted');
      window.name = encoded;
    }

    /** Refuse to clobber a value some other script is relying on. */
    static isSafeToUse() {
      const raw = String(window.name || '');
      return raw === '' || raw.indexOf(WINDOW_NAME_MARKER) === 0;
    }

    getItem(key) {
      const map = this.read();
      return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : null;
    }

    setItem(key, value) {
      if (!WindowNameBackend.isSafeToUse()) throw new Error('window.name is in use');
      const text = String(value);
      if (text.length > WINDOW_NAME_VALUE_LIMIT) throw new Error('value too large for window.name');
      const map = this.read();
      map[key] = text;
      this.save(map);
    }

    removeItem(key) {
      if (!WindowNameBackend.isSafeToUse()) return;
      const map = this.read();
      delete map[key];
      this.save(map);
    }

    key(index) {
      return Object.keys(this.read())[index] || null;
    }

    get length() {
      return Object.keys(this.read()).length;
    }
  }

  /**
   * Persistence that never throws, and that does not trust any single store to
   * actually persist.
   *
   * The important design point: this writes to *every* backend that works and
   * reads back whichever one still has the data. Probing a store tells you it
   * accepted a write a moment ago; it does not tell you the value will still be
   * there in the next document, and in a WebView with no origin it very often
   * is not. Writing to one store and hoping is how a setting silently
   * evaporates between chapters.
   */
  class Store {
    constructor() {
      this.memory = new Map();
      this.backends = Store.probeBackends();
      this.backend = this.backends.length > 0 ? this.backends[0].store : null;
      this.backendName = this.backends.length > 0
        ? this.backends.map(function (entry) { return entry.name; }).join(' + ')
        : 'memory only (nothing will be remembered)';
      log('storage:', this.backendName);
    }

    /** Every store that accepts a write and gives it back. */
    static probeBackends() {
      const candidates = [
        { name: 'localStorage', make: function () { return window.localStorage; } },
        { name: 'sessionStorage', make: function () { return window.sessionStorage; } },
        { name: 'window.name', make: function () { return new WindowNameBackend(); } },
      ];

      const working = [];
      for (const candidate of candidates) {
        try {
          const store = candidate.make();
          if (!store) continue;
          const key = STORAGE_PREFIX + 'probe';
          store.setItem(key, 'ok');
          const readBack = store.getItem(key);
          store.removeItem(key);
          if (readBack === 'ok') working.push({ name: candidate.name, store: store });
        } catch (error) {
          /* Blocked, absent, or full. Try the next. */
        }
      }
      return working;
    }

    /**
     * @returns the stored value, or null if absent or expired.
     *
     * The memory layer carries its own expiry rather than being a plain value
     * cache. Without that, a time-to-live would only take effect after a
     * reload, and a reading session lasts hours.
     */
    read(key) {
      const cached = this.memory.get(key);
      if (cached) {
        if (cached.expiresAt && Date.now() > cached.expiresAt) {
          this.remove(key);
          return null;
        }
        return cached.value;
      }

      /* Whichever store still has it wins, and if several do, the newest. */
      let best = null;
      for (const entry of this.backends) {
        const record = Store.readFrom(entry.store, key);
        if (!record) continue;
        if (!best || (record.savedAt || 0) > (best.savedAt || 0)) best = record;
      }
      if (!best) return null;

      if (best.expiresAt && Date.now() > best.expiresAt) {
        this.remove(key);
        return null;
      }

      this.memory.set(key, { value: best.value, expiresAt: best.expiresAt || 0 });
      return best.value;
    }

    static readFrom(store, key) {
      try {
        const raw = store.getItem(STORAGE_PREFIX + key);
        if (!raw) return null;
        return JSON.parse(raw);
      } catch (error) {
        return null;
      }
    }

    write(key, value, ttlDays) {
      const expiresAt = ttlDays ? Date.now() + ttlDays * 86400000 : 0;
      this.memory.set(key, { value: value, expiresAt: expiresAt });

      const encoded = JSON.stringify({ savedAt: Date.now(), expiresAt: expiresAt, value: value });
      let wroteSomewhere = false;

      for (const entry of this.backends) {
        try {
          entry.store.setItem(STORAGE_PREFIX + key, encoded);
          wroteSomewhere = true;
        } catch (error) {
          /* Quota, or too large for this particular backend. Drop the oldest
           * half of our own entries and try this one once more. */
          if (this.evictOldest(entry.store)) {
            try {
              entry.store.setItem(STORAGE_PREFIX + key, encoded);
              wroteSomewhere = true;
            } catch (retryError) {
              /* This backend cannot take it. Others may still. */
            }
          }
        }
      }

      if (!wroteSomewhere) log('nothing accepted a write for', key);
    }

    remove(key) {
      this.memory.delete(key);
      for (const entry of this.backends) {
        try {
          entry.store.removeItem(STORAGE_PREFIX + key);
        } catch (error) {
          /* nothing useful to do */
        }
      }
    }

    /** Only ever touches keys under our own prefix. */
    ownKeys(store) {
      const keys = [];
      try {
        for (let index = 0; index < store.length; index += 1) {
          const key = store.key(index);
          if (key && key.indexOf(STORAGE_PREFIX) === 0) keys.push(key);
        }
      } catch (error) {
        return [];
      }
      return keys;
    }

    evictOldest(store) {
      const entries = [];
      for (const fullKey of this.ownKeys(store)) {
        if (fullKey.indexOf(STORAGE_PREFIX + 'settings') === 0) continue; // never evict settings
        try {
          const record = JSON.parse(store.getItem(fullKey));
          entries.push({ key: fullKey, savedAt: (record && record.savedAt) || 0 });
        } catch (error) {
          entries.push({ key: fullKey, savedAt: 0 });
        }
      }
      if (entries.length === 0) return false;

      entries.sort(function (left, right) {
        return left.savedAt - right.savedAt;
      });
      const doomed = entries.slice(0, Math.max(1, Math.floor(entries.length / 2)));
      for (const entry of doomed) {
        try {
          store.removeItem(entry.key);
        } catch (error) {
          /* keep going */
        }
      }
      log('evicted', String(doomed.length), 'cached entries to free space');
      return true;
    }

    clearCache() {
      let removed = 0;
      for (const entry of this.backends) {
        for (const fullKey of this.ownKeys(entry.store)) {
          if (fullKey.indexOf(STORAGE_PREFIX + 'settings') === 0) continue;
          try {
            entry.store.removeItem(fullKey);
            removed += 1;
          } catch (error) {
            /* keep going */
          }
        }
      }
      /* Settings live in the memory layer too, and clearing the cache must not
       * take them with it — that would drop the chosen wiki on the floor. */
      const settings = this.memory.get('settings');
      this.memory.clear();
      if (settings) this.memory.set('settings', settings);
      return removed;
    }

    /**
     * Every logical key we hold that starts with `prefix`, across all backends.
     *
     * Used to recall everything already known about a novel at the start of a
     * chapter, rather than only what the current chapter happens to mention.
     */
    keysUnder(prefix) {
      const full = STORAGE_PREFIX + prefix;
      const seen = new Set();
      for (const entry of this.backends) {
        for (const fullKey of this.ownKeys(entry.store)) {
          if (fullKey.indexOf(full) === 0) seen.add(fullKey.slice(STORAGE_PREFIX.length));
        }
      }
      for (const key of this.memory.keys()) {
        if (key.indexOf(prefix) === 0) seen.add(key);
      }
      return Array.from(seen);
    }

    /** Rough size of what we are occupying, for the settings panel. */
    describeUsage() {
      let bytes = 0;
      const seen = new Set();
      for (const entry of this.backends) {
        for (const fullKey of this.ownKeys(entry.store)) {
          if (seen.has(fullKey)) continue;
          seen.add(fullKey);
          try {
            bytes += (entry.store.getItem(fullKey) || '').length;
          } catch (error) {
            /* keep going */
          }
        }
      }
      return { count: seen.size, kilobytes: Math.round(bytes / 1024) };
    }
  }
