
  /* --------------------------------------------------------- settings view */

  /**
   * The settings panel, rendered into the same sheet as everything else.
   *
   * The whole reason this exists is that the previous shape of this tool asked
   * people to edit a config block at the top of the file and re-paste the
   * entire thing into a phone text box to change one value. That is a terrible
   * thing to ask of someone who just wants a different wiki, and it meant every
   * update wiped their configuration. Settings live in storage now, and the
   * pasted file is never meant to be edited at all.
   */
  class SettingsView {
    constructor(options) {
      this.settings = options.settings;
      this.context = options.context;
      this.store = options.store;
      this.wiki = options.wiki;
      this.panel = options.panel;
      this.onApply = options.onApply || function () {};
    }

    render() {
      const settings = this.settings;
      const usage = this.store.describeUsage();

      const html =
        '<div class="lorelens-head"><div class="lorelens-titles">' +
        '<h2 class="lorelens-name">LoreLens</h2>' +
        '<p class="lorelens-native">' +
        escapeHtml(this.context.novelTitle || 'Unknown novel') +
        '</p></div></div>' +

        /* Which wiki. The single most important control, so it goes first. */
        '<div class="lorelens-field">' +
        '<label class="lorelens-label" for="lorelens-wiki">Wiki for this novel</label>' +
        '<input class="lorelens-input" id="lorelens-wiki" type="text" ' +
        'autocapitalize="none" autocorrect="off" spellcheck="false" ' +
        'placeholder="' + escapeHtml(this.wiki.subdomain || 'e.g. shadowslave') + '" ' +
        'value="' + escapeHtml(settings.get('wiki')) + '">' +
        '<p class="lorelens-help">The part before <strong>.fandom.com</strong>. ' +
        'Leave it empty to let LoreLens work it out. ' +
        (this.wiki.subdomain
          ? 'Currently using <strong>' + escapeHtml(this.wiki.subdomain) + '.fandom.com</strong>.'
          : 'No wiki found yet.') +
        '</p></div>' +

        /* Reading position, which drives the spoiler guard. */
        '<div class="lorelens-field">' +
        '<label class="lorelens-label" for="lorelens-progress">You are on chapter</label>' +
        '<input class="lorelens-input" id="lorelens-progress" type="number" min="0" step="1" ' +
        'value="' + escapeHtml(String(settings.get('chapterProgress') || '')) + '" ' +
        'placeholder="' + escapeHtml(String(this.context.chapterNumber || 0)) + '">' +
        '<p class="lorelens-help">Anything the wiki ties to a later chapter gets hidden. ' +
        'This fills in by itself as you read.</p></div>' +

        '<div class="lorelens-field">' +
        '<label class="lorelens-label" for="lorelens-spoiler">Spoiler guard</label>' +
        '<select class="lorelens-select" id="lorelens-spoiler">' +
        SettingsView.option('chapter', 'Hide what is ahead of me', settings.get('spoilerGuard')) +
        SettingsView.option('strong', 'Hide anything that sounds final', settings.get('spoilerGuard')) +
        SettingsView.option('off', 'Show me everything', settings.get('spoilerGuard')) +
        '</select>' +
        '<p class="lorelens-help">Hidden text is never removed, only covered. Tap to reveal it.</p>' +
        '</div>' +

        '<div class="lorelens-field">' +
        '<label class="lorelens-label" for="lorelens-detection">How much to highlight</label>' +
        '<select class="lorelens-select" id="lorelens-detection">' +
        SettingsView.option('strict', 'Only names I have confirmed', settings.get('detection')) +
        SettingsView.option('balanced', 'Balanced', settings.get('detection')) +
        SettingsView.option('generous', 'Anything name-shaped', settings.get('detection')) +
        '</select></div>' +

        '<div class="lorelens-field">' +
        '<label class="lorelens-label" for="lorelens-hlstyle">Marked names look like</label>' +
        '<select class="lorelens-select" id="lorelens-hlstyle">' +
        SettingsView.option('marker', 'Highlighter marker', settings.get('highlightStyle')) +
        SettingsView.option('bold', 'Coloured and bold', settings.get('highlightStyle')) +
        SettingsView.option('underline', 'Underlined', settings.get('highlightStyle')) +
        '</select>' +
        '<p class="lorelens-help">A marked name is not a link and should not look like one — ' +
        'your reader\'s own footnote links are the blue underlined text.</p></div>' +

        '<div class="lorelens-field">' +
        '<label class="lorelens-label" for="lorelens-hlcolor">Marker colour</label>' +
        '<select class="lorelens-select" id="lorelens-hlcolor">' +
        SettingsView.option('violet', 'Violet', settings.get('highlightColor')) +
        SettingsView.option('amber', 'Amber', settings.get('highlightColor')) +
        SettingsView.option('teal', 'Teal', settings.get('highlightColor')) +
        SettingsView.option('rose', 'Rose', settings.get('highlightColor')) +
        SettingsView.option('theme', "Match my reader's theme", settings.get('highlightColor')) +
        '</select></div>' +

        '<div class="lorelens-field">' +
        SettingsView.toggle('firstMentionOnly', 'First mention only',
          'Mark a name once per paragraph instead of every time.', settings) +
        SettingsView.toggle('selectionLookup', 'Look up selected text',
          'Select any words and get a lookup button.', settings) +
        SettingsView.toggle('prefetch', 'Load ahead',
          'Quietly fetch the most common names so taps open instantly.', settings) +
        SettingsView.toggle('liveLookup', 'Use the wiki',
          'Turn off to stop all network requests.', settings) +
        SettingsView.toggle('showRealmsButton', 'Show the ladder button',
          'The button that lists this world\'s cultivation levels.', settings) +
        SettingsView.toggle('showButton', 'Show the settings button', '', settings) +
        SettingsView.toggle('enabled', 'LoreLens is on', '', settings) +
        '</div>' +

        /* Optional and deliberately last: almost nobody needs this, and putting
         * it above the switches would imply it is a normal part of setup. */
        '<div class="lorelens-field">' +
        '<label class="lorelens-label" for="lorelens-lorepack">Custom glossary (optional)</label>' +
        '<input class="lorelens-input" id="lorelens-lorepack" type="url" ' +
        'autocapitalize="none" autocorrect="off" spellcheck="false" ' +
        'placeholder="https://…/glossary.json" ' +
        'value="' + escapeHtml(settings.get('lorepackUrl')) + '">' +
        '<p class="lorelens-help">A hand-written entry file, for novels whose wiki is thin ' +
        'or whose translation uses different names. Loaded once and kept offline. ' +
        'Leave this empty unless someone gave you a link.</p></div>' +

        Panel.footer([
          { action: 'clear-cache', label: 'Clear cache' },
          { action: 'copy-diagnostics', label: 'Copy diagnostics' },
          { action: 'spacer' },
          { action: 'close', label: 'Done' },
        ]) +

        '<p class="lorelens-meta">LoreLens ' + escapeHtml(VERSION) + ' &middot; ' +
        escapeHtml(String(usage.count)) + ' cached entries, ' +
        escapeHtml(String(usage.kilobytes)) + ' KB</p>';

      this.panel.setContent(html);
      this.bind();
      this.panel.open();
    }

    static option(value, label, current) {
      return (
        '<option value="' + escapeHtml(value) + '"' +
        (value === current ? ' selected' : '') + '>' +
        escapeHtml(label) +
        '</option>'
      );
    }

    static toggle(key, label, help, settings) {
      const isOn = Boolean(settings.get(key));
      return (
        '<div class="lorelens-row"><div class="lorelens-row-text">' +
        '<div class="lorelens-label" style="margin:0">' + escapeHtml(label) + '</div>' +
        (help ? '<p class="lorelens-help">' + escapeHtml(help) + '</p>' : '') +
        '</div>' +
        '<button class="lorelens-toggle' + (isOn ? ' is-on' : '') + '" ' +
        'role="switch" aria-checked="' + (isOn ? 'true' : 'false') + '" ' +
        'aria-label="' + escapeHtml(label) + '" ' +
        'data-lorelens-toggle="' + escapeHtml(key) + '"></button></div>'
      );
    }

    /**
     * Inputs need their own listeners rather than the panel's delegated click
     * handler, since we care about change and blur rather than clicks.
     */
    bind() {
      const self = this;
      const root = this.panel.scroll;

      const toggles = root.querySelectorAll('[data-lorelens-toggle]');
      for (const element of Array.prototype.slice.call(toggles)) {
        element.addEventListener('click', guard('settings.toggle', function () {
          const key = element.getAttribute('data-lorelens-toggle');
          const next = !self.settings.get(key);
          self.settings.set(key, next);
          element.classList.toggle('is-on', next);
          element.setAttribute('aria-checked', next ? 'true' : 'false');
          self.onApply(key);
        }));
      }

      const wikiInput = root.querySelector('#lorelens-wiki');
      if (wikiInput) {
        wikiInput.addEventListener('change', guard('settings.wiki', function () {
          /* Accept a full URL as well as a bare subdomain, because that is what
           * people have in their clipboard when they go looking for this. */
          const raw = wikiInput.value.trim();
          const parsed = raw
            .replace(/^https?:\/\//i, '')
            .replace(/\.fandom\.com.*$/i, '')
            .replace(/\/.*$/, '')
            .trim();
          self.settings.set('wiki', parsed);
          self.onApply('wiki');
        }));
      }

      const progressInput = root.querySelector('#lorelens-progress');
      if (progressInput) {
        progressInput.addEventListener('change', guard('settings.progress', function () {
          const value = parseInt(progressInput.value, 10);
          self.settings.set('chapterProgress', isNaN(value) ? 0 : Math.max(0, value));
          self.onApply('chapterProgress');
        }));
      }

      const spoilerSelect = root.querySelector('#lorelens-spoiler');
      if (spoilerSelect) {
        spoilerSelect.addEventListener('change', guard('settings.spoiler', function () {
          self.settings.set('spoilerGuard', spoilerSelect.value);
          self.onApply('spoilerGuard');
        }));
      }

      const lorepackInput = root.querySelector('#lorelens-lorepack');
      if (lorepackInput) {
        lorepackInput.addEventListener('change', guard('settings.lorepack', function () {
          self.settings.set('lorepackUrl', lorepackInput.value.trim());
          self.onApply('lorepackUrl');
        }));
      }

      const detectionSelect = root.querySelector('#lorelens-detection');
      if (detectionSelect) {
        detectionSelect.addEventListener('change', guard('settings.detection', function () {
          self.settings.set('detection', detectionSelect.value);
          self.onApply('detection');
        }));
      }

      const styleSelect = root.querySelector('#lorelens-hlstyle');
      if (styleSelect) {
        styleSelect.addEventListener('change', guard('settings.hlstyle', function () {
          self.settings.set('highlightStyle', styleSelect.value);
          self.onApply('highlightStyle');
        }));
      }

      const colorSelect = root.querySelector('#lorelens-hlcolor');
      if (colorSelect) {
        colorSelect.addEventListener('change', guard('settings.hlcolor', function () {
          self.settings.set('highlightColor', colorSelect.value);
          self.onApply('highlightColor');
        }));
      }
    }

    /**
     * A plain-text dump of what LoreLens can see about its environment. This is
     * what turns "it doesn't work on my phone" into a fixable bug report, and
     * it deliberately contains nothing but feature detection and settings.
     */
    buildDiagnostics(highlighter) {
      const lines = [
        'LoreLens ' + VERSION,
        'novel: ' + (this.context.novelTitle || '(not detected)'),
        /* If this changes between chapters, per-novel settings will not be
         * found again and the reader gets asked for the wiki over and over.
         * Having it in a bug report makes that diagnosable in one glance. */
        'novel key: ' + this.context.novelKey,
        'document.title: ' + (document.title || '(empty)'),
        'chapter: ' + (this.context.chapterTitle || '(not detected)') +
          ' → number ' + this.context.chapterNumber,
        'root: ' + (this.context.root ? this.context.root.tagName + '#' + (this.context.root.id || '') : 'NONE'),
        'wiki: ' + (this.wiki.subdomain || '(none)') + (this.wiki.disabled ? ' [disabled]' : ''),
        'highlight mode: ' + (highlighter ? highlighter.mode : '?'),
        'storage: ' + (this.store.backend ? 'localStorage' : 'memory only'),
        '',
        'features:',
        '  CSS.highlights: ' + (typeof window.CSS !== 'undefined' && !!window.CSS.highlights),
        '  Highlight: ' + (typeof window.Highlight === 'function'),
        '  caretRangeFromPoint: ' + (typeof document.caretRangeFromPoint === 'function'),
        '  caretPositionFromPoint: ' + (typeof document.caretPositionFromPoint === 'function'),
        '  DOMParser: ' + (typeof window.DOMParser === 'function'),
        '  AbortController: ' + (typeof window.AbortController === 'function'),
        '  requestIdleCallback: ' + (typeof window.requestIdleCallback === 'function'),
        '  MutationObserver: ' + (typeof window.MutationObserver === 'function'),
        '  lookbehind regex: ' + SettingsView.supportsLookbehind(),
        '',
        'settings: ' + JSON.stringify(this.settings.values),
        '',
        'log:',
      ];
      return lines.concat(logLines).join('\n');
    }

    static supportsLookbehind() {
      try {
        new RegExp('(?<!x)y');
        return true;
      } catch (error) {
        return false;
      }
    }
  }
