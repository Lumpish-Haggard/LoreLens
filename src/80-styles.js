
  /* ------------------------------------------------------------- styling */

  /**
   * All of LoreLens's CSS, generated from the palette we read off the page so
   * that the panel belongs to whatever theme the reader is using rather than
   * fighting it.
   *
   * Everything is scoped under .lorelens-ui or a lorelens- prefix. Nothing here
   * may style a bare element selector: this stylesheet is a guest in someone
   * else's document and a rule on `p` or `button` would leak into the chapter.
   */
  function buildStyleSheet(palette) {
    const accent = toCss(palette.accent);
    const accentSoft = toCss(palette.accent, 0.16);
    const accentFaint = toCss(palette.accent, 0.1);
    const surface = toCss(palette.surface);
    const surfaceRaised = toCss(palette.surfaceRaised);
    const text = toCss(palette.foreground);
    const muted = palette.muted;
    const outline = palette.outline;
    const outlineStrong = palette.outlineStrong;

    return [
      /* ---- how a known name looks in the prose ---- */

      '::highlight(' + HIGHLIGHT_NAME + '){',
      'background-color:' + accentSoft + ';',
      'text-decoration:underline;',
      'text-decoration-color:' + toCss(palette.accent, 0.55) + ';',
      'text-decoration-thickness:1px;',
      'text-underline-offset:2px;}',

      '::highlight(' + HIGHLIGHT_NAME + '-guess){',
      'background-color:' + accentFaint + ';',
      'text-decoration:underline dotted;',
      'text-decoration-color:' + toCss(palette.foreground, 0.35) + ';',
      'text-underline-offset:2px;}',

      /* The wrapping fallback has to look identical to the painted version. */
      '.' + MARK_CLASS + '{',
      'background-color:' + accentSoft + ';',
      'text-decoration:underline;',
      'text-decoration-color:' + toCss(palette.accent, 0.55) + ';',
      'text-underline-offset:2px;',
      'cursor:pointer;border-radius:2px;',
      '-webkit-tap-highlight-color:transparent;}',
      '.' + MARK_CLASS + '--guess{',
      'background-color:' + accentFaint + ';',
      'text-decoration-style:dotted;',
      'text-decoration-color:' + toCss(palette.foreground, 0.35) + ';}',
      '.' + MARK_CLASS + ':active{background-color:' + toCss(palette.accent, 0.3) + ';}',

      /* ---- shared shell ---- */

      '.lorelens-ui{',
      'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;',
      'font-size:15px;line-height:1.5;color:' + text + ';',
      'box-sizing:border-box;-webkit-tap-highlight-color:transparent;}',
      '.lorelens-ui *{box-sizing:border-box;}',

      '.lorelens-scrim{',
      'position:fixed;inset:0;z-index:2147483000;',
      'background:' + palette.scrim + ';',
      'opacity:0;pointer-events:none;transition:opacity .2s ease;}',
      '.lorelens-scrim.is-open{opacity:1;pointer-events:auto;}',

      '.lorelens-panel{',
      'position:fixed;left:0;right:0;bottom:0;z-index:2147483001;',
      'max-height:82vh;display:flex;flex-direction:column;',
      'background:' + surface + ';',
      'border-top:1px solid ' + outline + ';',
      'border-radius:18px 18px 0 0;',
      'box-shadow:0 -10px 40px rgba(0,0,0,.35);',
      'transform:translateY(101%);',
      'transition:transform .28s cubic-bezier(.22,1,.36,1);',
      'padding-bottom:env(safe-area-inset-bottom,0px);}',
      '.lorelens-panel.is-open{transform:translateY(0);}',

      /* Wider screens get a card rather than a sheet that swallows the page. */
      '@media (min-width:760px){.lorelens-panel{',
      'left:auto;right:20px;bottom:20px;width:400px;max-height:78vh;',
      'border-radius:16px;border:1px solid ' + outline + ';',
      'transform:translateY(calc(100% + 24px));}}',

      '@media (prefers-reduced-motion:reduce){',
      '.lorelens-panel,.lorelens-scrim{transition:none;}}',

      /* ---- panel chrome ---- */

      '.lorelens-grip{flex:none;width:38px;height:4px;border-radius:99px;',
      'margin:9px auto 2px;background:' + outlineStrong + ';}',

      '.lorelens-scroll{overflow-y:auto;-webkit-overflow-scrolling:touch;',
      'padding:6px 18px 18px;overscroll-behavior:contain;}',

      '.lorelens-head{display:flex;align-items:flex-start;gap:12px;padding:8px 0 0;}',
      '.lorelens-portrait{flex:none;width:74px;height:74px;border-radius:12px;',
      'overflow:hidden;background:' + surfaceRaised + ';}',
      '.lorelens-portrait img{width:100%;height:100%;object-fit:cover;display:block;}',
      '.lorelens-titles{flex:1;min-width:0;}',
      '.lorelens-name{margin:0;font-size:19px;font-weight:650;line-height:1.25;',
      'letter-spacing:-.01em;word-break:break-word;}',
      '.lorelens-native{margin:3px 0 0;font-size:13px;color:' + muted + ';}',
      '.lorelens-alsoknown{margin:5px 0 0;font-size:12.5px;color:' + muted + ';}',

      /* ---- tags ---- */

      '.lorelens-tags{display:flex;flex-wrap:wrap;gap:6px;margin:12px 0 0;}',
      '.lorelens-tag{font-size:11.5px;font-weight:600;letter-spacing:.02em;',
      'padding:4px 9px;border-radius:99px;white-space:nowrap;',
      'background:' + surfaceRaised + ';color:' + muted + ';}',
      '.lorelens-tag--accent{background:' + accentSoft + ';color:' + accent + ';}',
      '.lorelens-tag--good{background:rgba(52,168,110,.18);color:#3fae7a;}',
      '.lorelens-tag--bad{background:rgba(206,74,74,.18);color:#d76b6b;}',
      /* A masked tag must not leak its content through its own width. */
      '.lorelens-tag--masked{background:' + surfaceRaised + ';color:' + muted + ';',
      'cursor:pointer;font-style:italic;}',

      /* ---- body sections ---- */

      '.lorelens-section{margin:16px 0 0;}',
      '.lorelens-section-title{margin:0 0 5px;font-size:11px;font-weight:700;',
      'letter-spacing:.1em;text-transform:uppercase;color:' + muted + ';}',
      '.lorelens-text{margin:0;font-size:14.5px;line-height:1.6;}',
      '.lorelens-run{}',

      '.lorelens-hidden{position:relative;display:block;margin:6px 0;',
      'padding:10px 12px;border-radius:10px;cursor:pointer;',
      'background:' + surfaceRaised + ';border:1px dashed ' + outlineStrong + ';}',
      '.lorelens-hidden-label{display:flex;align-items:center;gap:7px;',
      'font-size:12.5px;font-weight:600;color:' + muted + ';}',
      '.lorelens-hidden-label::before{content:"";width:13px;height:13px;flex:none;',
      'border-radius:3px;background:' + outlineStrong + ';}',
      '.lorelens-hidden-hint{margin:3px 0 0;font-size:11.5px;color:' + muted + ';',
      'opacity:.85;}',

      /* ---- footer ---- */

      '.lorelens-foot{display:flex;gap:8px;align-items:center;flex-wrap:wrap;',
      'margin:18px 0 0;padding-top:13px;border-top:1px solid ' + outline + ';}',
      '.lorelens-btn{font:inherit;font-size:13px;font-weight:600;cursor:pointer;',
      'padding:8px 13px;border-radius:9px;border:1px solid ' + outline + ';',
      'background:transparent;color:' + text + ';text-decoration:none;',
      'display:inline-flex;align-items:center;gap:6px;}',
      '.lorelens-btn--primary{background:' + accentSoft + ';color:' + accent + ';',
      'border-color:transparent;}',
      '.lorelens-btn:active{background:' + surfaceRaised + ';}',
      '.lorelens-spacer{flex:1;}',

      /* ---- states ---- */

      '.lorelens-state{padding:22px 4px 12px;text-align:center;}',
      '.lorelens-state-title{margin:0 0 6px;font-size:16px;font-weight:650;}',
      '.lorelens-state-body{margin:0;font-size:13.5px;color:' + muted + ';line-height:1.55;}',
      '.lorelens-spinner{width:20px;height:20px;margin:0 auto 12px;border-radius:50%;',
      'border:2px solid ' + outline + ';border-top-color:' + accent + ';',
      'animation:lorelens-spin .7s linear infinite;}',
      '@keyframes lorelens-spin{to{transform:rotate(360deg);}}',
      '@media (prefers-reduced-motion:reduce){.lorelens-spinner{animation-duration:2s;}}',

      /* ---- choices (disambiguation) ---- */

      '.lorelens-choice{display:block;width:100%;text-align:left;font:inherit;',
      'font-size:14px;padding:11px 12px;margin:6px 0 0;cursor:pointer;',
      'border-radius:10px;border:1px solid ' + outline + ';',
      'background:transparent;color:' + text + ';}',
      '.lorelens-choice-sub{display:block;margin-top:3px;font-size:12px;color:' + muted + ';}',

      /* ---- floating button ---- */

      '.lorelens-fab{position:fixed;z-index:2147482999;right:14px;',
      'bottom:calc(16px + env(safe-area-inset-bottom,0px));',
      'width:38px;height:38px;border-radius:50%;cursor:pointer;',
      'display:flex;align-items:center;justify-content:center;',
      'font-size:15px;font-weight:700;letter-spacing:-.02em;',
      'border:1px solid ' + outline + ';background:' + surface + ';color:' + accent + ';',
      'box-shadow:0 3px 12px rgba(0,0,0,.22);opacity:.5;transition:opacity .2s ease;}',
      '.lorelens-fab:active{opacity:1;}',
      '.lorelens-fab.is-busy{opacity:.9;}',

      /* ---- selection lookup bubble ---- */

      '.lorelens-bubble{position:absolute;z-index:2147483002;',
      'padding:7px 12px;border-radius:9px;cursor:pointer;font-size:13px;font-weight:600;',
      'background:' + surfaceRaised + ';color:' + accent + ';',
      'border:1px solid ' + outline + ';box-shadow:0 3px 14px rgba(0,0,0,.3);',
      'transform:translate(-50%,-100%);white-space:nowrap;}',

      /* ---- settings form ---- */

      '.lorelens-field{margin:14px 0 0;}',
      '.lorelens-label{display:block;font-size:13px;font-weight:600;margin-bottom:5px;}',
      '.lorelens-help{margin:4px 0 0;font-size:12px;color:' + muted + ';line-height:1.45;}',
      '.lorelens-input,.lorelens-select{width:100%;font:inherit;font-size:14px;',
      'padding:9px 11px;border-radius:9px;color:' + text + ';',
      'border:1px solid ' + outline + ';background:' + surfaceRaised + ';}',
      '.lorelens-row{display:flex;align-items:center;justify-content:space-between;',
      'gap:12px;padding:11px 0;border-bottom:1px solid ' + outline + ';}',
      '.lorelens-row:last-child{border-bottom:none;}',
      '.lorelens-row-text{flex:1;min-width:0;}',
      '.lorelens-toggle{flex:none;width:44px;height:26px;border-radius:99px;',
      'cursor:pointer;position:relative;border:none;padding:0;',
      'background:' + outlineStrong + ';transition:background .18s ease;}',
      '.lorelens-toggle::after{content:"";position:absolute;top:3px;left:3px;',
      'width:20px;height:20px;border-radius:50%;background:' + surface + ';',
      'transition:transform .18s ease;}',
      '.lorelens-toggle.is-on{background:' + accent + ';}',
      '.lorelens-toggle.is-on::after{transform:translateX(18px);}',
      '@media (prefers-reduced-motion:reduce){',
      '.lorelens-toggle,.lorelens-toggle::after{transition:none;}}',

      '.lorelens-meta{margin:16px 0 0;font-size:11.5px;color:' + muted + ';',
      'text-align:center;line-height:1.6;}',
    ].join('');
  }

  /** Install or replace the stylesheet. Called again whenever the theme moves. */
  function applyStyleSheet(palette) {
    let style = document.getElementById('lorelens-styles');
    if (!style) {
      style = document.createElement('style');
      style.id = 'lorelens-styles';
      (document.head || document.documentElement).appendChild(style);
    }
    style.textContent = buildStyleSheet(palette);
  }
