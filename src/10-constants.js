
  /* ------------------------------------------------------------- constants */

  const VERSION = '2.0.0';

  const NS = 'lorelens';
  const STORAGE_PREFIX = 'lorelens:v2:';

  /**
   * Where the chapter text lives, most specific first. Readers differ and they
   * change between releases, so this is a list rather than one selector, and
   * ReaderContext has a heuristic fallback for when none of them hit.
   */
  const CHAPTER_SELECTORS = [
    '#LNReader-chapter',
    '#chapter',
    '.chapter-content',
    '#chapter-container',
    '.chapterCtn',
    'chapter',
    '#reader-container',
    '.reader-content',
    '#novel-content',
    'main article',
  ];

  /** Never highlight inside these — they are not prose. */
  const SKIP_SELECTOR = [
    'a',
    'code',
    'pre',
    'script',
    'style',
    'textarea',
    'input',
    'button',
    'select',
    'svg',
    'sup',
    'sub',
    '[contenteditable]',
    '[data-lorelens-skip]',
    '.lorelens-ui',
  ].join(',');

  /** The Custom Highlight API registration name, and the DOM-fallback class. */
  const HIGHLIGHT_NAME = 'lorelens-term';
  const MARK_CLASS = 'lorelens-term';

  const MAX_TERM_WORDS = 5;
  const MIN_TERM_LENGTH = 3;

  /** Text-node batch size per frame while highlighting. Tuned for long chapters. */
  const NODES_PER_BATCH = 150;

  /** Hard ceiling on indexed terms, to bound regex compile and match cost. */
  const MAX_INDEXED_TERMS = 1200;

  /** How long a looked-up wiki entry stays good, in days. */
  const ENTRY_TTL_DAYS = 45;

  /** How long a which-wiki-is-this-novel decision stays good, in days. */
  const WIKI_TTL_DAYS = 180;

  /** Concurrent wiki requests. Fandom is fine with more; phone radios are not. */
  const MAX_CONCURRENT_REQUESTS = 3;

  /** Requests time out rather than leaving the panel spinning forever. */
  const REQUEST_TIMEOUT_MS = 12000;

  /** Diagnostics ring buffer size, surfaced by "Copy diagnostics". */
  const LOG_CAPACITY = 120;

  /**
   * Words that commonly start sentences. A capitalised word here is capitalised
   * because of punctuation, not because it is a name, so auto-detect skips it.
   */
  const STOPWORDS = new Set(
    ('a an and as at after all also although am are around before but by been being ' +
      'can could did do does down during each even every for from finally further ' +
      'had has have he her here hers him his how however i if in into is it its ' +
      'just like me more most my never no nor not now of off on once one only or ' +
      'other our out over perhaps she should since so some still such suddenly than ' +
      'that the their them then there these they this those though through thus to ' +
      'too under until up upon us very was we were what when where whether which ' +
      'while who whom why will with within without would yes yet you your ' +
      'chapter volume book part prologue epilogue arc translator editor note ' +
      'meanwhile afterwards nevertheless besides instead otherwise moreover'
    ).split(' '),
  );

  /**
   * Infobox labels, grouped by meaning. Wikis label the same field a dozen ways
   * and in several languages; this table is the whole compatibility layer for
   * that, and it is deliberately just data, so supporting another wiki needs no
   * new logic.
   *
   * Adding entries here is the most welcome kind of pull request there is.
   */
  const FIELD_ALIASES = {
    status: ['status', 'state', 'standing', 'condition', 'vital status', 'estado', 'statut'],
    race: ['race', 'species', 'kind', 'type', 'bloodline', 'raza'],
    gender: ['gender', 'sex'],
    affiliation: [
      'affiliation', 'affiliations', 'organization', 'organisation', 'faction',
      'sect', 'clan', 'family', 'house', 'guild', 'team', 'group', 'allegiance',
      'occupation', 'profession', 'position', 'role',
    ],
    rank: [
      'rank', 'title', 'titles', 'cultivation', 'cultivation level', 'realm',
      'level', 'class', 'grade', 'tier', 'stage', 'power level',
    ],
    alias: [
      'alias', 'aliases', 'other names', 'other name', 'also known as', 'aka',
      'nickname', 'nicknames', 'epithet', 'epithets', 'known as',
      'alternate names', 'true name', 'birth name', 'real name',
    ],
    native: [
      'chinese', 'korean', 'japanese', 'kanji', 'hanzi', 'hangul', 'hanja',
      'native name', 'original name', 'simplified chinese', 'traditional chinese',
    ],
    romanized: [
      'pinyin', 'romaji', 'romanized', 'romanised', 'romanization',
      'revised romanization',
    ],
    firstSeen: [
      'first appearance', 'debut', 'first seen', 'introduced', 'first mentioned',
      'novel debut',
    ],
  };

  /**
   * Phrases that mean a sentence is probably about how something ends. Used by
   * the spoiler guard when the text gives no chapter number to compare against.
   * Erring toward hiding is right here: an unnecessary tap costs a second, an
   * unnecessary reveal costs the book.
   */
  /*
   * These are matched as plain substrings against folded text, so each entry
   * should be the shortest phrase that still carries the meaning: "revealed to
   * be" catches "is revealed to be" and "is later revealed to be", where the
   * longer form catches only the first. Adverbs get inserted mid-phrase far
   * more often than you would expect.
   */
  const SPOILER_PHRASES = [
    'is killed', 'was killed', 'killed by', 'is slain', 'dies', 'died',
    'death of', 'his death', 'her death', 'their death',
    'revealed to be', 'turns out to be',
    'reveals himself', 'reveals herself', 'true identity', 'betrays', 'betrayed',
    'is actually', 'later becomes', 'eventually becomes', 'goes on to',
    'in the end', 'at the end of', 'final battle', 'ultimately',
    'sacrifices himself', 'sacrifices herself', 'is resurrected', 'reincarnates as',
    'ascends to', 'becomes the new', 'is defeated by', 'defeats', 'kills',
    'murdered', 'assassinated', 'marries', 'falls in love with',
    'is the son of', 'is the daughter of', 'is the reincarnation of',
    'secretly', 'unbeknownst',
  ];

  /** Status values that give away a character's fate on sight. */
  const FATE_WORDS =
    /\b(dead|deceased|died|killed|alive|living|active|inactive|retired|imprisoned|sealed|revived|resurrected)\b/i;

  /** Sections of a wiki article that are almost always spoilers wholesale. */
  const SPOILER_SECTION_TITLES =
    /^(plot|story|history|synopsis|biography|events|timeline|death|fate|later|epilogue|ending|relationships)/i;
