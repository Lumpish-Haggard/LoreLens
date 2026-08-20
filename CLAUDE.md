# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this is

LoreLens is a single JavaScript file that users paste into a mobile reading
app's custom-JS setting. It marks character names in the chapter being read, and
tapping one opens a panel with that character's entry from the novel's Fandom
wiki, with likely spoilers hidden.

The artefact is `dist/lorelens.js`. Everything else exists to produce, verify or
explain it.

## Commands

```bash
npm run build     # concatenate src/*.js -> dist/lorelens.js
npm test          # build, then run tests/harness.html in headless Chrome
npm run check     # enforce the source constraints (see below)
node --check dist/lorelens.js        # syntax check the output
node tests/run.mjs                    # tests only, without rebuilding
CHROME_PATH=/path/to/chrome npm test  # if the browser is not auto-found
```

There are no dependencies. `npm install` does nothing.

Running the suite needs Chrome, Chromium or Edge. `tests/harness.html` can also
be opened directly in any browser — the result is printed at the bottom of the
page.

## Non-negotiables

These are not style preferences. Breaking any of them ships a broken artefact to
people who cannot easily update it.

1. **Never let an exception escape into the host page.** Wrap every event
   handler, timer, promise chain and entry point in `guard()` or `guardAsync()`
   from `src/15-utils.js`. A failure must mean "no highlights", never "no
   chapter".
2. **No dependencies in `src/`.** No `import`, no `require`. The file is pasted
   into a text box in a phone app.
3. **No build-time transformation.** `tools/build.mjs` only concatenates.
   Whatever is in `src/` is byte-for-byte what runs. Users are asked to paste
   this script into an app they read in; that is only a reasonable request if
   they can audit it.
4. **Feature-detect, never version-sniff.** `if (window.CSS && CSS.highlights)`,
   never a user-agent test. Android WebView versions in the wild span years.
5. **Do not mutate chapter DOM on the default path.** The highlighter's painted
   path exists so that text selection and text-to-speech keep working. If you
   touch `src/70-highlighter.js`, keep both paths working and keep the tests
   that assert the DOM is untouched.
6. **All wiki content is untrusted.** Everything from a wiki goes through
   `escapeHtml()`; anything becoming a URL goes through `escapeUrl()`. Remote
   glossary files go through `LoreLensApp.validateLorepack()`, which rebuilds
   entries field by field rather than trusting the object.
7. **Stay namespaced.** Every global, CSS class, DOM id and storage key starts
   with `lorelens`. No bare element selectors in the stylesheet.

`tools/check.mjs` enforces 1–7 mechanically where it can, and CI runs it. If it
fails, fix the source rather than the check — unless the check has a genuine
false positive, in which case fix the check and say so in the commit message.

## Source layout

`src/*.js` concatenate in filename order into one function scope. The numeric
prefix encodes dependency order:

```
00-prologue      IIFE open, re-injection guard
10-constants     tunables, wiki-compatibility field tables, spoiler phrase list
15-utils         escaping, key folding, colour maths, guard(), log()
20-storage       localStorage wrapper that never throws, with TTL + eviction
25-settings      defaults, persistence, per-novel overrides
30-context       finds chapter root, novel, chapter number, colour palette
40-wiki          Fandom Action API client, request queue, wiki discovery
45-entity        wiki payload + infobox -> entity; stripWikiHtml, parseInfobox
50-spoilers      SpoilerGuard
60-index         EntityIndex, matcher construction, CONFIDENCE levels
65-detect        NameDetector — finding names with no prior knowledge
70-highlighter   painted (Custom Highlight API) + wrapping fallback
80-styles        CSS generated from the runtime palette
82-panel         the sheet
84-settings-ui   the settings form and diagnostics
86-selection     select-text-to-look-up
88-realms        the cultivation / rank ladder behind the ☰ button
90-app           orchestration
99-bootstrap     window.lorelens API, startup
```

Scope rule: a `function` declaration in a later file is hoisted, so calling it
from an earlier file's function *body* is fine. Referencing a later file's
`const` at load time is a temporal-dead-zone error. If you add a module, pick a
number reflecting what it may depend on, and do not reuse an existing prefix —
the build rejects duplicate numeric prefixes.

## Testing

`tests/harness.html` is the suite: a fake chapter, a stubbed `window.fetch`, and
assertions, all self-contained. It runs against real Chromium deliberately — the
target is an Android WebView, and the APIs most likely to break there do not
behave the same under a simulated DOM.

- Never make a real network call in a test. Add to the fixtures in the harness.
- Add a test when fixing a bug. One assertion that would have caught it is enough.
- The tests that assert the chapter DOM is unmodified in painted mode are load
  bearing. Do not weaken them to make a change pass.

The suite prints `RESULT n passed, m failed`; `tests/run.mjs` exits non-zero if
`m > 0`.

`tests/preview.html` is a fake chapter with the real script running on it, for
**looking at**. Open it after any visual change. The suite can tell you a
highlight was registered; it cannot tell you the result looks like a hyperlink,
which is a bug that shipped once already. Deep links open a specific screen:
`#realms`, `#settings`, `#entry`, and `#light` for the light theme (combine as
`#light,realms`). Its network is stubbed, so it never touches Fandom.

## Conventions

- The source is written in a conservative dialect: `function` expressions,
  `var`-free but `const`/`let` only, no arrow functions in `src/`, no optional
  chaining, no spread. Old WebViews are the audience. `tools/` and `tests/` are
  Node-only and use modern syntax freely.
- Descriptive names over short ones. `isFateReveal`, not `flag`.
- Comments explain *why*, especially where the code looks odd. Several places
  look wrong until you know what they are defending against — say what that is.
- Commit messages: `type: imperative summary`, where type is `feat`, `fix`,
  `docs`, `test`, `refactor`, or `chore`.

## Things that look like bugs but are not

- **`buildPalette()` reads computed styles instead of CSS variables.** Variable
  names differ per app and change between releases; painted colours do not.
- **Wiki lookups disable themselves after five consecutive failures.** Some
  WebViews block cross-origin requests outright; retrying forever burns battery
  and makes every tap feel broken.
- **The spoiler guard hides chapter-referencing text when progress is unknown.**
  That is the safe half of the guess and it is intentional.
- **`Store` keeps expiry in the memory layer too.** Without it, a TTL would only
  take effect after a reload, and a reading session lasts hours.
- **Auto-detected names are indexed as guesses and painted differently.** A
  guess should look like an offer, not a promise.
- **`font-weight` is absent from the highlight rules and weight is faked with
  `text-shadow`.** `::highlight()` only accepts properties that cannot affect
  layout, so the browser silently drops `font-weight` there. Verified visually,
  not assumed — see `tests/preview.html`.
- **Marked names do not use the reader's accent colour by default.** A reader's
  accent is almost always blue, and blue underlined text reads as a hyperlink,
  which a marked name is not.
- **`NameDetector` strips leading stopwords from a match.** "The Immortal
  Ascension Ritual" at a sentence start would otherwise be rejected whole, and
  the name would never reach the occurrence threshold.

## When changing behaviour

- Bumping the version means editing **both** `src/10-constants.js` (`VERSION`)
  and `package.json`. CI checks they match, and the release workflow checks the
  git tag matches too.
- Always run `npm run build` and commit `dist/`. CI fails if it is out of sync.
  This is the single most common CI failure on incoming pull requests.
- Adding support for a new wiki's infobox usually means adding strings to
  `FIELD_ALIASES` in `src/10-constants.js` and nothing else. Prefer that over
  new logic.
- Adding a network destination requires adding the host to `ALLOWED_HOSTS` in
  `tools/check.mjs`, which is a deliberate speed bump — think about whether it
  belongs.

## Repository

Hosted at `github.com/Lumpish-Haggard/LoreLens`. That URL appears in the docs,
`.github/CODEOWNERS`, the issue-template links and the banner at the top of the
built file — if the repository ever moves, those all need updating together.
Note that `.github/CODEOWNERS` is a filename, not an instance of the owner name.
