# Contributing to LoreLens

Thanks for being here. LoreLens is a single JavaScript file that people paste
into a reading app, so the bar for "does this break anything" is high and the
bar for "do I need a toolchain to help" is deliberately low.

## TL;DR

```bash
git clone https://github.com/<owner>/LoreLens.git
cd LoreLens
# edit files in src/
npm run build      # regenerates dist/lorelens.js
npm test           # runs the test suite in real headless Chrome
```

No dependencies are installed. `npm install` does nothing because there is
nothing to install — every script in `tools/` is plain Node with zero packages.

If you do not have Node, you can still contribute: open `tests/harness.html`
in any browser to run the whole test suite visually, and see
[Building without Node](#building-without-node) below.

## Ground rules for this codebase

These are not style preferences, they are what keeps the tool from breaking
someone's reading session.

1. **Never throw into the reader.** Every entry point — event handlers, timers,
   fetch chains, the bootstrap — is wrapped so a failure degrades to "no
   highlights" rather than "blank chapter". If you add a new entry point, wrap it.
2. **No dependencies in `src/`.** The output is pasted into a text box in a
   phone app. It cannot import anything.
3. **No build-time magic.** `npm run build` concatenates `src/*.js` in filename
   order and nothing else — no transpiling, no minifying, no bundler. What you
   read in `src/` is byte-for-byte what runs. This makes diffs reviewable and
   makes it possible for someone to audit the file before pasting it into their
   reader, which matters when the instruction is "paste this code into your app".
4. **Feature-detect, never version-sniff.** Android WebView versions in the wild
   span many years. `if (window.CSS && CSS.highlights)`, not user-agent tests.
5. **Do not mutate chapter DOM unless you have to.** The highlighter's preferred
   path uses the CSS Custom Highlight API precisely so that text selection,
   text-to-speech and the reader's own scripts keep working. If you touch the
   highlighter, keep both paths working.
6. **Spoilers are a safety feature, not a nicety.** Any code path that renders
   wiki text must pass it through the spoiler guard. A regression here is a
   priority bug, not a papercut.
7. **Stay inside the namespace.** Every global, CSS class, DOM id and storage
   key starts with `lorelens`. We are a guest in someone else's page.

## Project layout

| Path | What lives there |
| --- | --- |
| `src/` | The source, split into numbered modules. Concatenated in filename order. |
| `dist/lorelens.js` | Built output. **Committed**, because users download it directly. |
| `tools/build.mjs` | The concatenator. ~100 lines, no dependencies. |
| `tools/build-lorepack.mjs` | Optional: Fandom wiki → offline lorepack JSON. |
| `tests/harness.html` | The test suite. Runs in a browser or headless. |
| `tests/preview.html` | A fake chapter with the real script on it, for looking at. |
| `tests/run.mjs` | Finds Chrome/Edge, runs the harness headless, reports pass/fail. |
| `docs/` | User-facing documentation. |

Files in `src/` are numbered so the concatenation order is obvious and stable:
`00-` prologue, `1x-` primitives, `2x-` storage and settings, `3x-` reader
context, `4x-` wiki networking, `5x-` spoilers, `6x-` matching, `7x-`
highlighting, `8x-` UI, `9x-` app and bootstrap. Add new modules at a number
that reflects what they may depend on. Nothing may reference a symbol defined in
a higher-numbered file at load time (referencing it inside a function body is
fine, since that runs later).

## Making a change

1. **Fork** the repository and create a branch off `main`:
   `git checkout -b fix/chip-overflow`
2. Edit files in `src/`. **Do not hand-edit `dist/lorelens.js`** — it is
   generated, and CI will fail if it does not match `src/`.
3. Run `npm run build` then `npm test`.
4. Commit. Message format is `type: short imperative summary`, where type is one
   of `feat`, `fix`, `docs`, `test`, `refactor`, `chore`.
   Example: `fix: stop chips overflowing on narrow screens`
5. Push and open a pull request against `main`.

The PR template asks which device and which wiki you tested on. Please actually
fill that in — "works on my phone" is the single most useful line in a LoreLens
PR, because the failure modes here are overwhelmingly device- and wiki-specific.

## Testing

`npm test` builds the file, then loads `tests/harness.html` in headless Chrome
and asserts on the resulting DOM. The tests exercise real Chromium, not a DOM
simulation, because the target runtime is an Android WebView and the interesting
bugs (Custom Highlight API, `caretRangeFromPoint`, CSS variable fallbacks) do not
reproduce under a simulated DOM.

Network is stubbed in the harness — the suite never hits Fandom. If you are
adding a feature that talks to the wiki, add a fixture to
`tests/fixtures/` rather than a live call, so the suite stays fast and works
offline.

Add a test when you fix a bug. It does not need to be elaborate; one assertion
that would have caught the bug is enough.

### Looking at it

`tests/preview.html` is a fake chapter with the real script running on it. Open
it in a browser — no build server, no install — after any change that affects
how something looks. Add `#realms`, `#settings` or `#entry` to the URL to open
a particular panel, and `#light` for the light theme.

Please do this. The suite can assert that a highlight was registered; it cannot
tell you that the result looks like a hyperlink, which is exactly the bug that
shipped in an earlier version.

### Manual testing checklist

Automated tests cannot cover the reader integration. Before submitting anything
that touches highlighting or the sheet, check on a real device:

- [ ] Long-press a highlighted word — text selection still works
- [ ] Start text-to-speech — it still reads the paragraph correctly
- [ ] Turn a page / scroll to the next chapter — highlights re-apply
- [ ] Switch the reader theme — the sheet follows the new colors
- [ ] Airplane mode — the tool degrades quietly instead of hanging

### Building without Node

`tools/build.mjs` does nothing but concatenate. If you have no Node, this is
equivalent:

```bash
{ for f in src/*.js; do cat "$f"; echo; done; } > dist/lorelens.js
```

and `tests/harness.html` can simply be opened in a browser. CI will still run
the real build and the real suite on your PR, so you are not flying blind.

## Adding support for a wiki that does not work

This is the most useful kind of contribution and it needs no JavaScript.

Some wikis name their infobox fields unusually, use a different language, or
structure articles in a way the parser does not expect. If a novel's wiki gives
bad results, open a **Wiki compatibility** issue with the wiki URL and one
article that comes out wrong. Fixes usually land as a few extra field names in
`src/42-entity.js` — genuinely a two-line change, and a great first PR.

## What gets merged quickly

- Bug fixes with a test
- Extra infobox field names / language support for more wikis
- Accessibility fixes
- Documentation that makes the install shorter

## What needs discussion first

Open an issue before writing code for these, so you do not spend an evening on
something that gets declined:

- Anything adding a build dependency
- Anything that mutates chapter DOM on the default path
- New network destinations beyond Fandom
- Large refactors

## Reviews and merging

A maintainer will read the diff, usually within a few days. Expect questions —
they are about understanding the change, not about doubting you. Once CI is
green and a maintainer approves, they squash-merge it. You do not need to
squash your own commits; the merge does it.

If your PR sits untouched for two weeks, comment on it. It was almost certainly
missed rather than ignored.

By contributing you agree that your contribution is licensed under the
project's [MIT License](LICENSE).
