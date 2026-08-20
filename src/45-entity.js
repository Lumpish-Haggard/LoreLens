
  /* --------------------------------------------------------------- entities */

  /**
   * Strip rendered wiki HTML down to readable prose.
   *
   * Declared as a function so it is hoisted across the whole script — the wiki
   * client above calls it, and lives in an earlier file.
   */
  function stripWikiHtml(html) {
    const text = String(html || '');

    if (typeof window.DOMParser === 'function') {
      try {
        const parsed = new window.DOMParser().parseFromString(text, 'text/html');
        const body = parsed && parsed.body;
        if (body) {
          /* Reference markers, edit links and navigation boxes are noise in a
           * summary, and citation numbers in particular read as gibberish once
           * the superscript formatting is gone. */
          const noise = body.querySelectorAll(
            'sup.reference, .reference, .mw-editsection, .navbox, .toc, ' +
              'style, script, .portable-infobox, table, .mw-empty-elt',
          );
          for (const element of Array.prototype.slice.call(noise)) {
            if (element.parentNode) element.parentNode.removeChild(element);
          }
          return (body.textContent || '').replace(/\s+/g, ' ').trim();
        }
      } catch (error) {
        /* fall through to the regex path */
      }
    }

    return text
      .replace(/<(script|style|table)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<sup[\s\S]*?<\/sup>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#0?39;|&apos;/g, "'")
      .replace(/\[\d+\]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /** Which meaning, if any, an infobox label carries. */
  function classifyFieldLabel(label) {
    const key = foldKey(label).replace(/[:：]\s*$/, '');
    if (!key) return null;
    for (const meaning of Object.keys(FIELD_ALIASES)) {
      const aliases = FIELD_ALIASES[meaning];
      for (const alias of aliases) {
        if (key === alias) return meaning;
      }
    }
    /* Loosen to a contains-match only after exact matching fails, so that
     * "Cultivation Realm" lands on rank without "Realm of Origin" hijacking it. */
    for (const meaning of Object.keys(FIELD_ALIASES)) {
      for (const alias of FIELD_ALIASES[meaning]) {
        if (alias.length >= 5 && key.indexOf(alias) >= 0) return meaning;
      }
    }
    return null;
  }

  /**
   * Pull label/value pairs out of a Fandom portable infobox.
   *
   * Parsed as a document rather than with regexes: infobox markup nests, and a
   * regex that copes with the nesting is a regex nobody can safely change later.
   */
  function parseInfobox(html) {
    const fields = {};
    if (!html || typeof window.DOMParser !== 'function') return fields;

    let document_;
    try {
      document_ = new window.DOMParser().parseFromString(html, 'text/html');
    } catch (error) {
      return fields;
    }
    if (!document_ || !document_.body) return fields;

    const infobox = document_.querySelector('.portable-infobox, .infobox, .infoboxtable');
    if (!infobox) return fields;

    /* The modern portable infobox: paired label and value elements. */
    const rows = infobox.querySelectorAll('.pi-item.pi-data, .pi-data');
    for (const row of Array.prototype.slice.call(rows)) {
      const labelElement = row.querySelector('.pi-data-label');
      const valueElement = row.querySelector('.pi-data-value');
      if (!labelElement || !valueElement) continue;
      const label = (labelElement.textContent || '').replace(/\s+/g, ' ').trim();
      const value = cleanFieldValue(valueElement);
      if (label && value) fields[label] = value;
    }

    /* Older table-shaped infoboxes, still common on long-running wikis. */
    if (Object.keys(fields).length === 0) {
      const cells = infobox.querySelectorAll('tr');
      for (const cell of Array.prototype.slice.call(cells)) {
        const header = cell.querySelector('th');
        const data = cell.querySelector('td');
        if (!header || !data) continue;
        const label = (header.textContent || '').replace(/\s+/g, ' ').trim();
        const value = cleanFieldValue(data);
        if (label && value) fields[label] = value;
      }
    }

    const image = infobox.querySelector('.pi-image img, img');
    if (image) {
      const source = image.getAttribute('src') || image.getAttribute('data-src') || '';
      if (source) fields.__image = source;
    }

    return fields;
  }

  /** A field value as text, with list items separated rather than run together. */
  function cleanFieldValue(element) {
    const clone = element.cloneNode(true);
    const noise = clone.querySelectorAll('sup, .reference, style, script, .pi-data-label');
    for (const item of Array.prototype.slice.call(noise)) {
      if (item.parentNode) item.parentNode.removeChild(item);
    }
    /* A list of affiliations would otherwise run together into one word soup. */
    for (const breakElement of Array.prototype.slice.call(clone.querySelectorAll('br, li'))) {
      if (typeof breakElement.insertAdjacentText === 'function') {
        breakElement.insertAdjacentText('afterend', ' · ');
      }
    }
    return (clone.textContent || '')
      .replace(/\s*·\s*$/, '')
      .replace(/\s+/g, ' ')
      .replace(/\s*·\s*/g, ' · ')
      .trim()
      .slice(0, 240);
  }

  /**
   * Fandom serves images through a resizing proxy. Asking for a smaller one
   * saves a meaningful amount of data on a phone, and the panel never shows a
   * portrait larger than a few hundred pixels anyway.
   */
  function scaleWikiImage(url, width) {
    const text = String(url || '');
    if (!text) return '';
    if (text.indexOf('wikia.nocookie.net') < 0) return text;
    /* Drop any existing transform, then request our own. */
    const base = text.split('/revision/')[0].split('?')[0];
    return base + '/revision/latest/scale-to-width-down/' + width;
  }

  const TAG_RULES = [
    {
      meaning: 'status',
      kind: 'fate',
      tone: function (value) {
        if (/\b(alive|living|active)\b/i.test(value)) return 'good';
        if (/\b(dead|deceased|died|killed|destroyed)\b/i.test(value)) return 'bad';
        return 'neutral';
      },
    },
    { meaning: 'race', kind: 'plain', tone: function () { return 'neutral'; } },
    { meaning: 'gender', kind: 'plain', tone: function () { return 'neutral'; } },
    { meaning: 'rank', kind: 'progress', tone: function () { return 'accent'; } },
    { meaning: 'affiliation', kind: 'plain', tone: function () { return 'accent'; } },
  ];

  /** Turn infobox fields into the little capsules along the top of the panel. */
  function buildTags(fieldsByMeaning) {
    const tags = [];
    for (const rule of TAG_RULES) {
      const value = fieldsByMeaning[rule.meaning];
      if (!value) continue;
      const parts = String(value)
        .split(/\s+·\s+|[,;]|\s+\/\s+/)
        .map(function (part) {
          return part.replace(/\([^)]*\)/g, '').trim();
        })
        .filter(function (part) {
          return part.length > 0 && part.length <= 28;
        })
        .slice(0, 2);

      for (const part of parts) {
        tags.push({
          label: part,
          tone: rule.tone(part),
          kind: rule.kind,
          /* A status of "deceased" is the single most common way a wiki spoils
           * a book in one word, so it is flagged for the spoiler guard here. */
          isFateReveal: rule.kind === 'fate' && FATE_WORDS.test(part),
        });
      }
      if (tags.length >= 6) break;
    }
    return tags.slice(0, 6);
  }

  function buildAliases(fieldsByMeaning, canonicalName) {
    const raw = String(fieldsByMeaning.alias || '');
    if (!raw) return [];
    return unique(
      raw
        .split(/\s+·\s+|[,;]|\s+\/\s+/)
        .map(function (part) {
          return part.replace(/\([^)]*\)/g, '').replace(/["“”]/g, '').trim();
        })
        .filter(function (part) {
          return (
            part.length >= 4 &&
            part.length <= 40 &&
            foldKey(part) !== foldKey(canonicalName) &&
            /^[A-Za-zÀ-￿][A-Za-z0-9À-￿\s'.-]*$/.test(part) &&
            !STOPWORDS.has(foldKey(part))
          );
        }),
    ).slice(0, 8);
  }

  /**
   * Split the summary into sections the spoiler guard can reason about, rather
   * than one opaque blob. The first couple of sentences of a wiki lead are
   * nearly always a safe "who is this", and the rest is where the trouble is.
   */
  function buildSections(extract) {
    const sentences = splitSentences(extract);
    if (sentences.length === 0) return [];

    const introCount = Math.min(2, sentences.length);
    const sections = [
      {
        title: 'Who this is',
        body: sentences.slice(0, introCount).join(' '),
        alwaysSafe: true,
      },
    ];

    if (sentences.length > introCount) {
      sections.push({
        title: 'More',
        body: sentences.slice(introCount).join(' '),
        alwaysSafe: false,
      });
    }
    return sections;
  }

  /** Wiki page + rendered article → the thing the panel renders. */
  function buildEntity(page, renderedHtml, subdomain) {
    const rawFields = parseInfobox(renderedHtml);

    const byMeaning = {};
    for (const label of Object.keys(rawFields)) {
      if (label === '__image') continue;
      const meaning = classifyFieldLabel(label);
      if (meaning && !byMeaning[meaning]) byMeaning[meaning] = rawFields[label];
    }

    const image =
      (page.thumbnail && page.thumbnail.source) ||
      rawFields.__image ||
      '';

    return {
      id: 'wiki:' + subdomain + ':' + slugify(page.title),
      name: page.title,
      title: page.title,
      aliases: buildAliases(byMeaning, page.title),
      native: byMeaning.native || '',
      romanized: byMeaning.romanized || '',
      image: scaleWikiImage(image, 480),
      url: page.fullurl || page.canonicalurl || '',
      tags: buildTags(byMeaning),
      sections: buildSections(page.extract || ''),
      firstSeen: ReaderContext.parseChapterNumber(byMeaning.firstSeen || ''),
      source: 'wiki',
      fetchedAt: Date.now(),
    };
  }
