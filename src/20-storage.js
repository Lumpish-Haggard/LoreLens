
  /* --------------------------------------------------------------- storage */

  /**
   * A last-resort store built on `window.name`.
   *
   * Some reader WebViews load the chapter with no real origin — a `data:` or
   * `about:blank` document — and every origin-scoped API, localStorage
   * included, either throws or silently forgets everything between chapters.
   * When that happens the tool asks which wiki to use on every single chapter,
   * which is unusable.
   *
   * `window.name` is the one string that survives a navigation in the same
   * window without belonging to an origin. It is a blunt instrument: it is
   * shared with whatever else is on the page, and it does not survive the
   * window being destroyed. So it is only ever reached for when the real
   * options have failed, and it refuses to touch a value that is not ours.
   *
   * Declared before Store because a class declaration is not hoisted.
   */
  const WINDOW_NAME_MARKER = 'lorelens1:';

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
      /* Very large values here would be carried into every navigation, so this
       * backend holds settings and little else. */
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
      const map = this.read();
      map[key] = String(value);
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
   * localStorage, but it never throws and it never grows without bound.
   *
   * A reader WebView may have storage disabled, may be in a private context, or
   * may hand us a quota of nothing at all. In every one of those cases LoreLens
   * has to keep working for the current session, so an in-memory map always
   * backs the persistent store rather than replacing it.
   */
  class Store {
    constructor() {
      this.memory = new Map();
      this.backend = Store.probeBackend();
      this.backendName = Store.nameOf(this.backend);
      log('storage backend:', this.backendName);
    }

    /** Which store we ended up on, for the diagnostics. */
    static nameOf(backend) {
      if (!backend) return 'memory only (nothing will be remembered)';
      try {
        if (backend === window.localStorage) return 'localStorage';
        if (backend === window.sessionStorage) return 'sessionStorage (lost when the app closes)';
      } catch (error) {
        /* touching them can throw; fall through */
      }
      return 'window.name (fallback — the reader blocks normal storage)';
    }

    static probeBackend() {
      const candidates = [
        function () { return window.localStorage; },
        function () { return window.sessionStorage; },
        function () { return new WindowNameBackend(); },
      ];

      for (const make of candidates) {
        try {
          const store = make();
          if (!store) continue;
          const key = STORAGE_PREFIX + 'probe';
          store.setItem(key, '1');
          const readBack = store.getItem(key);
          store.removeItem(key);
          if (readBack === '1') return store;
        } catch (error) {
          /* Blocked, absent, or full. Try the next one. */
        }
      }
      return null;
    }

    /**
     * @returns the stored value, or null if absent or expired.
     *
     * The memory layer carries its own expiry rather than being a plain value
     * cache. Without that, a time-to-live would only ever take effect after a
     * reload — the in-memory copy would keep answering with stale data for as
     * long as the reader stayed open, which for a reading session is hours.
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

      if (!this.backend) return null;
      try {
        const raw = this.backend.getItem(STORAGE_PREFIX + key);
        if (!raw) return null;
        const record = JSON.parse(raw);
        if (record.expiresAt && Date.now() > record.expiresAt) {
          this.remove(key);
          return null;
        }
        this.memory.set(key, { value: record.value, expiresAt: record.expiresAt || 0 });
        return record.value;
      } catch (error) {
        return null;
      }
    }

    write(key, value, ttlDays) {
      const expiresAt = ttlDays ? Date.now() + ttlDays * 86400000 : 0;
      this.memory.set(key, { value: value, expiresAt: expiresAt });
      if (!this.backend) return;
      const record = {
        savedAt: Date.now(),
        expiresAt: expiresAt,
        value: value,
      };
      try {
        this.backend.setItem(STORAGE_PREFIX + key, JSON.stringify(record));
      } catch (error) {
        /* Almost certainly the quota. Drop the oldest half of our own cached
         * entries and try once more; if it still fails, memory carries the
         * session and we simply re-fetch next time. */
        if (this.evictOldest()) {
          try {
            this.backend.setItem(STORAGE_PREFIX + key, JSON.stringify(record));
          } catch (retryError) {
            log('storage write failed after eviction');
          }
        }
      }
    }

    remove(key) {
      this.memory.delete(key);
      if (!this.backend) return;
      try {
        this.backend.removeItem(STORAGE_PREFIX + key);
      } catch (error) {
        /* nothing useful to do */
      }
    }

    /** Only ever touches keys under our own prefix. */
    ownKeys() {
      if (!this.backend) return [];
      const keys = [];
      try {
        for (let index = 0; index < this.backend.length; index += 1) {
          const key = this.backend.key(index);
          if (key && key.indexOf(STORAGE_PREFIX) === 0) keys.push(key);
        }
      } catch (error) {
        return [];
      }
      return keys;
    }

    evictOldest() {
      const entries = [];
      for (const fullKey of this.ownKeys()) {
        if (fullKey.indexOf(STORAGE_PREFIX + 'settings') === 0) continue; // never evict settings
        try {
          const record = JSON.parse(this.backend.getItem(fullKey));
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
          this.backend.removeItem(entry.key);
        } catch (error) {
          /* keep going */
        }
      }
      log('evicted', String(doomed.length), 'cached entries to free space');
      return true;
    }

    clearCache() {
      let removed = 0;
      for (const fullKey of this.ownKeys()) {
        if (fullKey.indexOf(STORAGE_PREFIX + 'settings') === 0) continue;
        try {
          this.backend.removeItem(fullKey);
          removed += 1;
        } catch (error) {
          /* keep going */
        }
      }
      this.memory.clear();
      return removed;
    }

    /** Rough size of what we are occupying, for the settings panel. */
    describeUsage() {
      let bytes = 0;
      let count = 0;
      for (const fullKey of this.ownKeys()) {
        try {
          bytes += (this.backend.getItem(fullKey) || '').length;
          count += 1;
        } catch (error) {
          /* keep going */
        }
      }
      return { count: count, kilobytes: Math.round(bytes / 1024) };
    }
  }
