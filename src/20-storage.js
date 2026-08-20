
  /* --------------------------------------------------------------- storage */

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
      log('storage backend:', this.backend ? 'localStorage' : 'memory only');
    }

    static probeBackend() {
      try {
        const key = STORAGE_PREFIX + 'probe';
        window.localStorage.setItem(key, '1');
        window.localStorage.removeItem(key);
        return window.localStorage;
      } catch (error) {
        return null;
      }
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
