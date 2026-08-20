# LoreLens

**Tap a character's name while reading. Get their wiki entry. Don't get spoiled.**

You are 500 chapters into a xianxia novel. A name appears. You have absolutely
no memory of who that is. You search for them, and the first result tells you
how they die.

LoreLens fixes both halves of that. It marks the names in the chapter you are
reading, and tapping one opens a panel with their portrait, their sect, and a
summary from the novel's wiki — with anything the wiki ties to a chapter you
have not reached yet hidden behind a tap.

It is one JavaScript file you paste into your reader. There is no account, no
API key, no server, and nothing to set up.

```
┌─────────────────────────────────────────┐
│  …the fog swirled around Gu Changge,    │   ← names are marked in the text
│  and Yue Mingkong said nothing at all.  │
│                                          │
├─────────────────────────────────────────┤
│  ▐▛▀▜▌  Gu Changge                      │
│  ▐▙▄▟▌  顾长歌 · Gù Chánggē              │
│         also Young Master Gu             │
│                                          │
│  ⟨status hidden⟩ ⟨Gu Family⟩ ⟨Sacred⟩   │   ← "Deceased" doesn't ambush you
│                                          │
│  WHO THIS IS                             │
│  Heir to the Gu family and the           │
│  antagonist the story follows.           │
│                                          │
│  MORE                                    │
│  ┌───────────────────────────────────┐  │
│  │ ▨ From beyond chapter 900         │  │   ← tap to reveal, never removed
│  │   Tap to show                     │  │
│  └───────────────────────────────────┘  │
└─────────────────────────────────────────┘
```

## Install

1. Download **[`dist/lorelens.js`](dist/lorelens.js)** to your phone.
2. In LNReader: **Settings → Reader → the gear icon at the bottom right →
   the `{}` icon (last one) → the JS tab**.
3. Tap **Import** and pick the file. Then **Save**, and reopen a chapter.

That is the entire setup. LoreLens works out which wiki your novel uses on its
own. If it guesses wrong, tap the small **L** button and tell it — you never
need to edit the file.

Step-by-step version, including what to do when it does not work:
**[docs/INSTALL.md](docs/INSTALL.md)**.

## What it does

**Finds names without being told any.** A capitalised phrase that recurs, sits
mid-sentence, and is not a common word is nearly always a character, a place, a
sect or a technique. That heuristic runs on the chapter you have open, so it
works from the first paste, on any novel, before it knows anything about the
book.

**Finds the wiki by itself.** Fandom subdomains are overwhelmingly the novel's
title with the spaces removed, so LoreLens generates the handful of shapes that
convention produces, asks each whether it exists, and checks the site's name
against the novel's before believing it.

**Hides what is ahead of you.** This is the part that matters. Wiki pages are
written by people who have finished the book. LoreLens reads your chapter number
off the chapter title, and any sentence the wiki ties to a later chapter is
covered until you tap it. Status tags — the "Deceased" that ruins a book in one
word — are hidden by default. Nothing is ever deleted, only covered.

**Does not damage the page.** Where the browser supports it, names are painted
using the CSS Custom Highlight API, which marks text without touching the DOM at
all. Selecting a sentence still selects a sentence, and text-to-speech still
reads it correctly. Readers that wrap matches in `<span>` tags break both, and
people notice without being able to say why the app got worse.

**Gets better as you read.** Every entry you open is cached. A name you looked
up in chapter 200 is recognised instantly in chapter 700, and works with no
connection at all.

**Look up anything.** Select any words and a **Look up** button appears, for the
character introduced once, four hundred chapters ago, under a title nobody uses
any more.

**Tells you the cultivation ladder.** Every progression novel has one, and
eighty chapters in you have lost track of whether Nascent Soul sits above or
below Golden Core. The **☰** button in the corner reads the wiki's power-system
page and shows the realms in order — and marks the rung this chapter is talking
about. One tap, instead of the trip to the wiki that gets you spoiled.

**Does not look like a hyperlink.** A marked name gets a coloured highlighter
wash, not blue underlined text. Your reader's own footnote links are the blue
underlined text; a name you can tap for lore is a different thing and should
look like one. Colour and style are both configurable.

## Settings

Tap the **L** button in the corner. Everything is in there — which wiki, how far
into the book you are, how much to hide, how much to highlight. Settings live in
your reader's storage, so updating LoreLens never wipes them.

| Setting | Default | What it does |
| --- | --- | --- |
| Wiki | auto | The part before `.fandom.com`. Empty means "work it out". |
| You are on chapter | auto | Drives the spoiler guard. Fills itself in as you read. |
| Spoiler guard | Hide what is ahead | Or hide anything final-sounding, or show everything. |
| How much to highlight | Balanced | Strict marks only confirmed names; generous marks anything name-shaped. |
| Marked names look like | Highlighter marker | Or coloured-and-bold, or underlined. |
| Marker colour | Violet | Amber, teal, rose, or match your reader's theme. |
| First mention only | on | Mark a name once per paragraph rather than every time. |
| Look up selected text | on | The select-and-tap escape hatch. |
| Load ahead | on | Quietly fetch common names so the first tap is instant. |
| Use the wiki | on | Turn off for a fully offline, zero-request setup. |
| Show the ladder button | on | The **☰** cultivation-levels button. |
| Custom glossary | empty | Optional hand-written entries. See below. |

A name you have not confirmed yet is marked more quietly — a dotted underline
rather than a solid wash — so a guess looks like an offer rather than a promise.

## Does this work with my reader?

It is built for and tested against **[LNReader](https://github.com/LNReader/lnreader)**,
which lets you inject custom JavaScript into the reader view.

It is not written against any single app's markup, though. LoreLens finds the
chapter by trying a list of known containers and then, if none match, by locating
the element that actually holds the prose. It reads the colours your reader is
painting rather than assuming any particular theme variables. So it has a fair
chance of working in any reader that will run a script in its reader view — and
if it does not, the diagnostics in the settings panel will say why.

> If the menu path in step 2 does not match your version of LNReader, please
> [open an issue](../../issues/new?template=bug_report.yml) telling us what
> yours says, and include your LNReader version — these instructions are
> written against one release and the reader settings have moved before.

## Custom glossaries (optional)

You almost certainly do not need this. It is for novels whose wiki is a stub,
translations using different names from the wiki's, or translation groups who
want to publish a spoiler-safe glossary for their readers.

Write a JSON file ([example](docs/example.lorepack.json)), host it anywhere over
https, and paste the URL into settings. To get a starting point from a wiki:

```bash
node tools/build-lorepack.mjs --wiki shadowslave --limit 40
```

Then edit what it got wrong — that is the part a script cannot do for you.

## Privacy

LoreLens sends the name you tapped to that novel's Fandom wiki, and nothing
else. No cookies are sent with the request. There is no analytics, no telemetry,
no server belonging to this project, and nothing about you leaves your device.
The cache and your settings are stored locally by your reader.

The file is unminified on purpose. You are being asked to paste a script into an
app you read in — you should be able to read it first, and `tools/check.mjs`
enforces the properties that make that audit meaningful.

## Contributing

Yes please. See **[CONTRIBUTING.md](CONTRIBUTING.md)**.

The most useful contribution needs no JavaScript at all: if a novel's wiki gives
bad results, open a
[wiki compatibility issue](../../issues/new?template=wiki_compat.yml). Most of
those are fixed by adding a couple of field names to a list.

```bash
git clone https://github.com/Lumpish-Haggard/LoreLens.git
cd LoreLens
npm run build     # concatenates src/*.js into dist/lorelens.js
npm test          # runs the suite in real headless Chrome
```

There are no dependencies to install.

## How it fits together

```
src/00-prologue     the wrapper, and the guard against double-injection
src/10-constants    tunables, and the wiki-compatibility field tables
src/15-utils        escaping, folding, colour maths, the error guards
src/20-storage      localStorage that never throws and never fills up
src/25-settings     defaults, persistence, per-novel overrides
src/30-context      finds the chapter, the novel, the chapter number, the theme
src/40-wiki         the Fandom client, request queue, wiki discovery
src/45-entity       wiki payload → the thing the panel draws
src/50-spoilers     the spoiler guard
src/60-index        term → entity map and the matcher
src/65-detect       finding names with no prior knowledge
src/70-highlighter  painted highlights, with a wrapping fallback
src/80-styles       CSS generated from the detected palette
src/82-panel        the sheet
src/84-settings-ui  the settings form
src/86-selection    select-text-to-look-up
src/88-realms       the cultivation / rank ladder
src/90-app          orchestration
src/99-bootstrap    the public API and startup
```

More detail in **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**.

## Credits

The idea comes from a [tool shared on r/Manhua](https://www.reddit.com/r/Manhua/comments/1vsfpvu/new_tool_ayo_check_this_tool_and_drop_your/)
that did this on the desktop, and from the first comment under it pointing out
that a status tag reading "dead" is itself the spoiler. The spoiler guard is
here because of that comment.

## Licence

[MIT](LICENSE).
