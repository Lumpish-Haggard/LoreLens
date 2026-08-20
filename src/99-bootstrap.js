
  /* ------------------------------------------------------------- bootstrap */

  /**
   * The public surface, for anyone who wants to drive LoreLens from the
   * console or from another script. Keeping this deliberately small: it is the
   * bit we cannot change later without breaking somebody's setup.
   */
  function publish(app) {
    window.lorelens = {
      version: VERSION,

      /** Open the panel for a name, exactly as if it had been tapped. */
      open: function (term) {
        return guardAsync('api.open', function () {
          return app.lookup(String(term || ''));
        })();
      },

      /** Re-detect the chapter and repaint. Called on re-injection. */
      rescan: guard('api.rescan', function () {
        app.rescan();
      }),

      /** Open the settings panel. */
      settings: guard('api.settings', function () {
        app.settingsView.render();
      }),

      /** Open this world's cultivation / rank ladder. */
      realms: guard('api.realms', function () {
        return app.realms.show();
      }),

      /** Everything we know about this environment, as text. */
      diagnostics: guard('api.diagnostics', function () {
        return app.settingsView.buildDiagnostics(app.highlighter);
      }),

      /** Forget every cached wiki entry. Settings are kept. */
      clearCache: guard('api.clearCache', function () {
        return app.store.clearCache();
      }),

      /* Exposed for the test suite, which drives the internals directly rather
       * than through the UI. Not a supported interface — it will change. */
      _internals: {
        app: app,
        EntityIndex: EntityIndex,
        NameDetector: NameDetector,
        SpoilerGuard: SpoilerGuard,
        WikiClient: WikiClient,
        ReaderContext: ReaderContext,
        Highlighter: Highlighter,
        Settings: Settings,
        Store: Store,
        Panel: Panel,
        RealmsGuide: RealmsGuide,
        LoreLensApp: LoreLensApp,
        WIKIS: WIKIS,
        buildEntity: buildEntity,
        buildSections: buildSections,
        cleanExtract: cleanExtract,
        isEditorialNotice: isEditorialNotice,
        WindowNameBackend: WindowNameBackend,
        parseInfobox: parseInfobox,
        stripWikiHtml: stripWikiHtml,
        classifyFieldLabel: classifyFieldLabel,
        scaleWikiImage: scaleWikiImage,
        splitSentences: splitSentences,
        foldKey: foldKey,
        parseColor: parseColor,
        luminance: luminance,
        CONFIDENCE: CONFIDENCE,
      },
    };
  }

  function boot() {
    let app;
    try {
      app = new LoreLensApp();
      publish(app);
      app.start();
    } catch (error) {
      /* A failure here means no highlights. It must never mean no chapter. */
      log('fatal during startup:', (error && error.message) || String(error));
      if (window.console && window.console.warn) {
        window.console.warn('[LoreLens] failed to start:', error);
      }
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
