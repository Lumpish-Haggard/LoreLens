
  /* ----------------------------------------------------------------- panel */

  /**
   * The sheet that slides up when you tap a name.
   *
   * Every string that comes from a wiki goes through escapeHtml or escapeUrl on
   * the way in. Wiki content is user-generated content from a site we do not
   * control, rendered inside the reader's own page — treating it as trusted
   * would mean any wiki editor could run code in someone's reader.
   */
  class Panel {
    constructor(options) {
      this.guard = options.spoilerGuard;
      this.onAction = options.onAction || function () {};
      this.onClose = options.onClose || function () {};
      this.isOpen = false;
      this.lastFocused = null;
      this.build();
    }

    build() {
      this.scrim = document.createElement('div');
      this.scrim.className = 'lorelens-ui lorelens-scrim';

      this.panel = document.createElement('div');
      this.panel.className = 'lorelens-ui lorelens-panel';
      this.panel.setAttribute('role', 'dialog');
      this.panel.setAttribute('aria-modal', 'true');
      this.panel.setAttribute('aria-label', 'LoreLens');

      this.grip = document.createElement('div');
      this.grip.className = 'lorelens-grip';

      this.scroll = document.createElement('div');
      this.scroll.className = 'lorelens-scroll';

      this.panel.appendChild(this.grip);
      this.panel.appendChild(this.scroll);

      const body = document.body || document.documentElement;
      body.appendChild(this.scrim);
      body.appendChild(this.panel);

      this.bindEvents();
    }

    bindEvents() {
      const self = this;

      this.scrim.addEventListener('click', guard('panel.scrim', function () {
        self.close();
      }));

      document.addEventListener('keydown', guard('panel.key', function (event) {
        if (event.key === 'Escape' && self.isOpen) {
          event.preventDefault();
          self.close();
        }
      }));

      /* One delegated handler for everything inside the panel, so that
       * re-rendering the contents never leaves stale listeners behind. */
      this.panel.addEventListener('click', guard('panel.click', function (event) {
        /* closest() is missing on some nodes in older engines, and on SVG
         * elements in a few of them. A missing handler is better than a throw. */
        if (!event.target || typeof event.target.closest !== 'function') return;
        const target = event.target.closest('[data-lorelens-action]');
        if (!target) return;
        const action = target.getAttribute('data-lorelens-action');
        const value = target.getAttribute('data-lorelens-value') || '';

        if (action === 'close') {
          self.close();
          return;
        }
        if (action === 'reveal') {
          Panel.revealHidden(target);
          return;
        }
        if (action === 'reveal-tag') {
          target.textContent = target.getAttribute('data-lorelens-label') || '';
          target.className = 'lorelens-tag lorelens-tag--' + (target.getAttribute('data-lorelens-tone') || 'neutral');
          target.removeAttribute('data-lorelens-action');
          return;
        }
        self.onAction(action, value, event);
      }));

      /* Swipe the sheet down to dismiss — the gesture people already expect. */
      let startY = 0;
      let isDragging = false;

      this.grip.addEventListener('touchstart', guard('panel.dragstart', function (event) {
        startY = event.touches[0].clientY;
        isDragging = true;
      }), { passive: true });

      this.panel.addEventListener('touchmove', guard('panel.drag', function (event) {
        if (!isDragging) return;
        const delta = event.touches[0].clientY - startY;
        if (delta > 0) self.panel.style.transform = 'translateY(' + delta + 'px)';
      }), { passive: true });

      this.panel.addEventListener('touchend', guard('panel.dragend', function (event) {
        if (!isDragging) return;
        isDragging = false;
        const delta = (event.changedTouches[0] || {}).clientY - startY;
        self.panel.style.transform = '';
        if (delta > 90) self.close();
      }));
    }

    static revealHidden(element) {
      const text = element.getAttribute('data-lorelens-text') || '';
      const replacement = document.createElement('span');
      replacement.className = 'lorelens-run';
      replacement.textContent = text;
      if (element.parentNode) element.parentNode.replaceChild(replacement, element);
    }

    open() {
      if (!this.isOpen) {
        this.lastFocused = document.activeElement;
        this.isOpen = true;
      }
      this.scrim.classList.add('is-open');
      this.panel.classList.add('is-open');
      this.scroll.scrollTop = 0;
    }

    close() {
      const wasOpen = this.isOpen;
      this.isOpen = false;
      this.scrim.classList.remove('is-open');
      this.panel.classList.remove('is-open');
      this.panel.style.transform = '';
      if (this.lastFocused && typeof this.lastFocused.focus === 'function') {
        try {
          this.lastFocused.focus();
        } catch (error) {
          /* the element went away with the chapter */
        }
      }
      /* Coming back to the chapter is the moment to check the marks survived
       * whatever the reader did while the panel was covering them. */
      if (wasOpen) this.onClose();
    }

    setContent(html) {
      this.scroll.innerHTML = html;
    }

    /* ------------------------------------------------------------ states -- */

    showLoading(term) {
      this.setContent(
        '<div class="lorelens-state">' +
          '<div class="lorelens-spinner"></div>' +
          '<p class="lorelens-state-title">' + escapeHtml(term) + '</p>' +
          '<p class="lorelens-state-body">Looking this up&hellip;</p>' +
          '</div>' +
          Panel.footer([{ action: 'close', label: 'Close' }]),
      );
      this.open();
    }

    showMessage(title, body, actions) {
      this.setContent(
        '<div class="lorelens-state">' +
          '<p class="lorelens-state-title">' + escapeHtml(title) + '</p>' +
          '<p class="lorelens-state-body">' + escapeHtml(body) + '</p>' +
          '</div>' +
          Panel.footer(actions || [{ action: 'close', label: 'Close' }]),
      );
      this.open();
    }

    /** Several articles could be the one meant. Let the reader pick. */
    showChoices(term, choices) {
      const items = choices
        .map(function (choice) {
          return (
            '<button class="lorelens-choice" data-lorelens-action="choose" ' +
            'data-lorelens-value="' + escapeHtml(choice.title) + '">' +
            escapeHtml(choice.title) +
            (choice.snippet
              ? '<span class="lorelens-choice-sub">' + escapeHtml(choice.snippet.slice(0, 90)) + '</span>'
              : '') +
            '</button>'
          );
        })
        .join('');

      this.setContent(
        '<div class="lorelens-section">' +
          '<p class="lorelens-section-title">Which one is ' + escapeHtml(term) + '?</p>' +
          items +
          '</div>' +
          Panel.footer([{ action: 'close', label: 'Close' }]),
      );
      this.open();
    }

    /* ------------------------------------------------------------ entity -- */

    showEntity(entity) {
      const plan = this.guard.plan(entity);

      if (plan.isAheadOfReader) {
        this.setContent(
          Panel.header(entity, true) +
            '<div class="lorelens-state">' +
            '<p class="lorelens-state-body">This character has not appeared yet at chapter ' +
            escapeHtml(String(this.guard.progress)) +
            '. The wiki says they first show up later, so there is nothing here that would not get ahead of you.</p>' +
            '</div>' +
            Panel.footer([
              { action: 'reveal-all', label: 'Show anyway' },
              { action: 'spacer' },
              { action: 'close', label: 'Close' },
            ]),
        );
        this.open();
        return;
      }

      this.setContent(
        Panel.header(entity, false) +
          Panel.tags(plan.tags) +
          this.sections(plan.sections) +
          Panel.footer([
            entity.url ? { action: 'open-wiki', label: 'Full wiki page', href: entity.url } : null,
            { action: 'spacer' },
            { action: 'settings', label: 'Settings' },
            { action: 'close', label: 'Close' },
          ]),
      );
      this.open();
    }

    static header(entity, isMinimal) {
      const scriptLine = [entity.native, entity.romanized]
        .filter(Boolean)
        .map(escapeHtml)
        .join('  ·  ');

      const aliases = (entity.aliases || []).slice(0, 4);
      const imageUrl = escapeUrl(entity.image);

      return (
        '<div class="lorelens-head">' +
        (imageUrl && !isMinimal
          ? '<div class="lorelens-portrait"><img src="' + imageUrl + '" alt="" loading="lazy" ' +
            'referrerpolicy="no-referrer" ' +
            'onerror="this.parentNode.style.display=&quot;none&quot;"></div>'
          : '') +
        '<div class="lorelens-titles">' +
        '<h2 class="lorelens-name">' + escapeHtml(entity.name) + '</h2>' +
        (scriptLine ? '<p class="lorelens-native">' + scriptLine + '</p>' : '') +
        (aliases.length > 0
          ? '<p class="lorelens-alsoknown">also ' + escapeHtml(aliases.join(', ')) + '</p>'
          : '') +
        '</div></div>'
      );
    }

    static tags(tags) {
      if (!tags || tags.length === 0) return '';
      const items = tags
        .map(function (tag) {
          if (tag.masked) {
            /* The label is carried in an attribute rather than the text, and
             * the placeholder is a fixed width, so that neither the rendered
             * text nor the shape of the capsule gives the answer away. */
            return (
              '<span class="lorelens-tag lorelens-tag--masked" ' +
              'data-lorelens-action="reveal-tag" ' +
              'data-lorelens-label="' + escapeHtml(tag.label) + '" ' +
              'data-lorelens-tone="' + escapeHtml(tag.tone) + '" ' +
              'role="button" tabindex="0">status hidden</span>'
            );
          }
          return (
            '<span class="lorelens-tag lorelens-tag--' + escapeHtml(tag.tone) + '">' +
            escapeHtml(tag.label) +
            '</span>'
          );
        })
        .join('');
      return '<div class="lorelens-tags">' + items + '</div>';
    }

    sections(sections) {
      const self = this;
      if (!sections || sections.length === 0) {
        return '<div class="lorelens-section"><p class="lorelens-text">' +
          'The wiki page for this one has no summary yet.</p></div>';
      }

      return sections
        .map(function (section) {
          const runs = section.runs
            .map(function (run) {
              if (!run.hidden) {
                return '<span class="lorelens-run">' + escapeHtml(run.text) + ' </span>';
              }
              return (
                '<span class="lorelens-hidden" role="button" tabindex="0" ' +
                'data-lorelens-action="reveal" ' +
                'data-lorelens-text="' + escapeHtml(run.text) + '">' +
                '<span class="lorelens-hidden-label">' +
                escapeHtml(self.guard.describeReasons(run.reasons)) +
                '</span>' +
                '<span class="lorelens-hidden-hint">Tap to show</span>' +
                '</span>'
              );
            })
            .join('');

          return (
            '<div class="lorelens-section">' +
            '<p class="lorelens-section-title">' + escapeHtml(section.title) + '</p>' +
            '<p class="lorelens-text">' + runs + '</p>' +
            '</div>'
          );
        })
        .join('');
    }

    static footer(actions) {
      const items = (actions || [])
        .filter(Boolean)
        .map(function (action) {
          if (action.action === 'spacer') return '<span class="lorelens-spacer"></span>';
          if (action.href) {
            const href = escapeUrl(action.href);
            if (!href) return '';
            return (
              '<a class="lorelens-btn lorelens-btn--primary" href="' + href + '" ' +
              'target="_blank" rel="noopener noreferrer">' + escapeHtml(action.label) + '</a>'
            );
          }
          return (
            '<button class="lorelens-btn" data-lorelens-action="' + escapeHtml(action.action) + '">' +
            escapeHtml(action.label) +
            '</button>'
          );
        })
        .join('');
      return '<div class="lorelens-foot">' + items + '</div>';
    }
  }
