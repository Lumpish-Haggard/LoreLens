# LoreLens for LNReader

Highlights character, place and term names inside a chapter. Tap one and a bottom sheet slides up with the portrait, status capsules and wiki summary — the same idea as the desktop tool in the video, running inside LNReader on your phone.

## Why this is custom JS and not a plugin

LNReader "plugins" are **source plugins**. Their job is `searchNovels`, `parseNovel`, `parseChapter` — fetch text from a website and hand it to the reader. There is no plugin hook for decorating the rendered chapter or drawing UI over it.

What LNReader *does* expose is script injection into the reader WebView: **Settings → Reader → Advanced → JS**. Your code runs after all built-in scripts, with full DOM access, on every chapter you open — regardless of which source the novel came from. That is strictly better for this feature than a plugin would be: one install, works on every source.

(Source plugins *can* ship a `custom.js` alongside them, but that only applies to novels from that one source. Not what you want here.)

## Install

1. Open `lorelens.js`, edit the `CONFIG` block at the top.
2. LNReader → Settings → Reader → Advanced → **JS** tab.
3. Paste the whole file (or use **Import** and point it at `lorelens.js`). Hit **Save**.
4. Reopen a chapter. Changes only apply on chapter open, not live.

## Configuration

| Key | What it does |
| --- | --- |
| `lorepackUrl` | URL to a hosted lorepack JSON. Fetched once, then cached for 30 days. |
| `inlineLorepack` | Paste the lorepack object here instead. Fully offline, zero network. |
| `fandomWiki` | Fandom subdomain for live lookups, e.g. `imabadguy` → `imabadguy.fandom.com`. |
| `isLiveLookupEnabled` | Hit the wiki API when a tapped term is missing from the lorepack. |
| `isAutoDetectEnabled` | Highlight repeated Capitalised Phrases even with no lorepack. |
| `shouldBlurSpoilers` | Blur sections marked `isSpoiler` until tapped. |

### Three ways to run it

**Zero setup.** Set `fandomWiki` only. Auto-detect finds repeated capitalised names in the chapter and underlines them; tapping one queries the wiki live and caches the result. Works immediately, occasionally underlines something that isn't a real entity.

**Curated, online.** Build a lorepack, host the JSON on GitHub raw, set `lorepackUrl`. Only real entities get underlined, and the data is already there when you tap. One small fetch per 30 days.

**Fully offline.** Build a lorepack, paste it into `inlineLorepack`, set `isLiveLookupEnabled: false`. No network at all. Matches how the tool in the video works. Keep it under ~1 MB of JSON or the settings field gets unpleasant to edit — that's roughly 400–600 entities with trimmed summaries.

## Building a lorepack

```bash
node build-lorepack.mjs \
  --wiki imabadguy \
  --categories "Characters,Locations,Terminology" \
  --out fated-villain.lorepack.json
```

It walks the categories, pulls each article's intro extract and thumbnail, and parses the portable infobox to derive aliases (so "Young Master Gu" resolves to the same entry) and capsules (Status, Race, Affiliation, Title, Cultivation). Run it on a laptop, not the phone. Add `--limit 30` for a quick trial run.

Everything the builder emits is also hand-editable — see `example.lorepack.json` for the schema. Marking a section `"isSpoiler": true` is worth doing on anything past your current chapter.

## Known constraints

- **Reader-only.** Custom JS runs in the chapter WebView, so highlights appear when reading, not in the library or chapter list.
- **CORS.** Fandom's `api.php` is called with `origin=*`, which MediaWiki honours for anonymous requests. If your WebView ends up with an opaque origin on some source and the fetch is blocked, switch to `inlineLorepack` — that path never touches the network.
- **Cache persistence.** Uses `localStorage`, keyed per origin. If a source's base URL changes, the cache re-warms silently. There's an in-memory fallback if storage is unavailable.
- **Longest match wins.** "Young Master Gu" is matched before "Gu". Aliases shorter than 4 characters are dropped by the builder because they cause false positives everywhere.
- **Text inside links, `<code>` and `<pre>` is left alone**, so source-site footers and translator notes don't get chewed up.
- Highlighting is batched across frames, so a 6,000-word chapter won't block the first paint.

## Files

- `lorelens.js` — the script you paste into LNReader
- `build-lorepack.mjs` — Fandom → lorepack JSON (Node 18+, no dependencies)
- `example.lorepack.json` — schema reference
- `test-smoke.mjs` — jsdom harness; `npm i jsdom && node test-smoke.mjs` to verify changes
