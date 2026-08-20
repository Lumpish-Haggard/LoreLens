# How LoreLens is put together

For people changing the code. If you only want to use it, you want
[INSTALL.md](INSTALL.md) instead.

## The shape of the problem

LoreLens is a script that runs inside somebody else's app, in a WebView we do
not control, on a page whose markup we did not write and which changes between
releases of that app, on Android devices whose browser engines span many years.
It has no build step at runtime, no dependencies, no server, and no way to ship
a fix quickly — people paste a file in by hand and may not update for months.

Almost every design decision below follows from that.

### Three rules

**1. Never break the reader.** A LoreLens failure must degrade to "no
highlights", never to "no chapter". Every entry point is wrapped in `guard()` or
`guardAsync()` from `src/15-utils.js`, which log and swallow. This is why you
will not find a bare event listener anywhere in the codebase.

**2. Detect, do not assume.** Anything about the host page is discovered at
runtime, with a fallback chain, because a hardcoded assumption about another
app's markup is a bug with a delayed fuse. There is no version sniffing anywhere
— only feature detection.

**3. Be a guest.** Every global, CSS class, DOM id and storage key is prefixed
`lorelens`. The stylesheet contains no bare element selectors. `tools/check.mjs`
enforces all of this on every build, because these are exactly the rules that
get broken accidentally.

## Build

`tools/build.mjs` concatenates `src/*.js` in filename order into
`dist/lorelens.js`. That is the entire build — no transpiling, no minifying, no
bundler.

This is a deliberate choice rather than laziness. Users are asked to paste a
script into an app they read in; that request is only reasonable if they can
read what they are pasting, and diff it against the repository. A minified
bundle would make the audit meaningless.

The numbering encodes dependency order:

| Range | Contains | May depend on |
| --- | --- | --- |
| `00` | wrapper, re-injection guard | — |
| `1x` | constants, utilities | nothing |
| `2x` | storage, settings | `1x` |
| `3x` | reader context | `1x`, `2x` |
| `4x` | wiki client, entity building | `1x`–`3x` |
| `5x` | spoiler guard | `1x`, `2x` |
| `6x` | entity index, name detection | `1x`, `2x` |
| `7x` | highlighter | `1x`–`6x` |
| `8x` | styles, panel, settings UI, selection | `1x`–`5x` |
| `9x` | app orchestration, bootstrap | everything |

Everything lands in one function scope. A later file's `function` declaration is
hoisted, so calling it from an earlier file's function body is fine — that is
how `40-wiki.js` calls `stripWikiHtml()`, which lives in `45-entity.js`. What is
*not* fine is referencing a later file's `const` at load time, since that is a
temporal-dead-zone error.

CI runs the build and fails if `dist/` differs from the committed copy, so the
two can never drift.

## The interesting parts

### Highlighting without touching the DOM

`src/70-highlighter.js` has two strategies and picks at runtime.

The **painted** path uses the [CSS Custom Highlight API](https://developer.mozilla.org/en-US/docs/Web/API/CSS_Custom_Highlight_API):
matches become `Range` objects, registered via `CSS.highlights.set()`, and the
browser paints them. The chapter DOM is never modified.

This matters more than it sounds. The obvious approach — wrapping each match in
a `<span>` — fragments text selection across element boundaries, and
text-to-speech engines treat those boundaries as pauses or skip the wrapped text
entirely. In a *reading app* those are not cosmetic regressions. The whole point
of the painted path is that selection and speech see exactly the DOM the reader
rendered.

The cost is that a painted highlight has no identity in the event stream, so
taps are resolved by hit-testing: `caretRangeFromPoint()` gives the caret at the
tap, and `isPointInRange()` finds which stored range contains it. The painted
path is therefore only chosen when a caret-from-point API also exists.

The **wrapping** path is the fallback for older WebViews, and it is the old
approach with its old problems. The test suite covers both.

### Finding the chapter

`src/30-context.js` tries a list of known containers, then falls back to walking
down from `<body>` and stopping at the smallest element that still holds most of
the page's text. That fallback is what gives LoreLens a chance of working in a
reader nobody has tested it against.

### Theming without knowing the theme

Rather than reading CSS custom properties — whose names differ per app and
change between releases — `buildPalette()` reads the colours the page is
actually painting via `getComputedStyle`, decides light or dark from relative
luminance, and derives surfaces, outlines and muted text by blending toward the
contrast pole. It only consults theme variables for the accent colour, and has a
readable default when none are found.

The result matches themes that did not exist when this was written, and cannot
go stale.

### Finding the wiki

`WikiClient.discoverWiki()` exists because "zero setup" is the whole product
promise and asking someone for a wiki address is setup.

Fandom subdomains are overwhelmingly the novel's title with the spaces removed,
so it generates the shapes that convention produces — joined, hyphenated, with a
leading article dropped, initials for long titles — and probes each with a cheap
`meta=siteinfo` request. A candidate only wins if the returned sitename shares
enough words with the novel title, which stops it binding to an unrelated wiki
that happens to own a short slug.

Both hits and misses are cached, misses for a shorter time, since a wiki may be
created later for a novel currently being written.

### The spoiler guard

`src/50-spoilers.js` is the part that justifies the project existing in this
shape, and it is the one place where the code is deliberately biased.

Wiki pages are written by people who have finished the book. The first thing a
character page shows is usually a status field reading "Deceased". So nothing
from a wiki reaches the panel without passing through `SpoilerGuard.plan()`.

It works per sentence. A sentence naming a chapter later than your position is
hidden; if your position is unknown, any sentence naming a specific chapter is
hidden, because that is the safe half of the guess. In `strong` mode a phrase
list adds hiding for prose that gives away an ending without citing a chapter.
Consecutive hidden sentences collapse into one block so the panel does not look
like a redacted document.

The bias is intentional and worth stating plainly: revealing something takes one
tap and costs a second, and hiding nothing costs the book.

### Untrusted input

Wiki content is user-generated content from a site we do not control, rendered
inside the reader's page. Everything from a wiki goes through `escapeHtml()`, and
anything becoming a URL goes through `escapeUrl()`, which rejects anything that
is not `http(s)`. Remote glossary files get the stricter treatment in
`LoreLensApp.validateLorepack()`, which rebuilds each entry field by field
rather than trusting the incoming object. The test suite feeds hostile input to
both paths.

## Testing

`tests/harness.html` is a self-contained page: fake chapter, stubbed network,
assertions. `tests/run.mjs` finds Chrome, Edge or Chromium and runs it headless.

It runs in a real Chromium rather than a simulated DOM on purpose. The target is
an Android WebView, and the things most likely to break there — the Custom
Highlight API, `caretRangeFromPoint`, computed-style colour reading, `Range`
behaviour — either do not exist or behave differently under a DOM simulation. A
green run against a fake DOM would tell us very little about the artefact people
actually paste into their reader.

You can also just open `tests/harness.html` in a browser; the result is at the
bottom of the page. No install of any kind.

Network is always stubbed. Add fixtures rather than live calls, so the suite
stays fast, deterministic, and works offline.

## What is deliberately not here

- **No dependencies.** The output is pasted by hand into a phone app.
- **No build-time code generation.** What you read in `src/` is what runs.
- **No server.** Nothing to run, pay for, or have go down in two years.
- **No analytics.** There is no way to find out how many people use this, which
  is a real cost, knowingly paid.
- **No offline-first requirement.** The original version needed a glossary file
  prepared in advance. Almost nobody will do that, so it became optional and the
  cache does the job for the common case instead.
