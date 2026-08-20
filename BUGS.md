# Known bugs

What is **measured**, what is **inferred**, and what has been tried — so work
resumes from evidence rather than re-derivation.

Status as of 2026-08-20, LoreLens 2.0.0.

Device: OPPO CPH2447, Android 16, LNReader, light reader theme.
Novel under test: a **fan work** whose title matches no wiki. The relevant wiki
is the source work's, `battle-through-the-heavens.fandom.com`, which must be set
by hand.

Screenshots: `assets/bug-reports/` (gitignored — they are photographs of pages
of a copyrighted novel, and this repo is public).

---

## Confirmed environment facts

**Measured on the device**, and corroborated by LNReader's source. Do not
re-derive these.

| Fact | Value | Consequence |
| --- | --- | --- |
| `origin` | `null` | No origin-scoped storage survives. |
| `secure context` | `false` | No `navigator.clipboard`. Diagnostics must be on-screen. |
| `storage` | `window.name` only | `localStorage` **and** `sessionStorage` both fail their probe. |
| `boot count` | climbs 1 → 2 across a chapter | **`window.name` persists. In-page storage does work.** |
| `document.title` | empty | Cannot identify the novel. |
| chapter root | `DIV#LNReader-chapter` | Detection correct. |
| novel key | stable across chapters | Per-novel settings key is not the problem. |
| highlight mode | `highlight` | Custom Highlight API path active. |
| Feature detection | all `true` | Every API the tool uses is present. |

LNReader renders the chapter with `source={{ html }}` and **no `baseUrl`**
(`src/screens/reader/components/WebViewReader.tsx`). Custom JS is interpolated
into a final `<script>` in that HTML, so it runs once per document, after the
built-in scripts. **Every chapter is a new document.**

Also documented by LNReader: `#reader-ui`, `#reader-footer-wrapper`,
`#ToolWrapper`, `#ScrollBar`, `#TTS-Controller`, `.next-button`,
`body.page-reader`, `.highlight` (element TTS is currently reading).

---

## Bug 1 — marks disappear and never come back

**Root cause found and fixed. Needs confirmation on device.**

### What the log showed

```
   9ms  highlighted 51 mentions          <- correct
   9ms  probing subdomains: fbsgaoylsmatb
  67ms  wiki request failed (1): Failed to fetch
6015ms  matcher built over 1 terms       <- index emptied out
6026ms  highlighted 0 mentions
```

Marking worked at boot — 51 mentions — and was then destroyed by failing wiki
lookups:

1. `prefetch()` looked names up; every request failed, because discovery had
   invented the subdomain `fbsgaoylsmatb` from the fan work's long title.
2. Each failure called `index.reject(term)`.
3. `buildMatcher()` **excluded rejected terms**, so the matcher shrank.
4. Eventually nothing matched: `highlighted 0 mentions`.
5. The watchdog saw no marks, re-ran, re-derived the same rejected terms, got 0
   again — **every 3 seconds, forever**.

**The defect: a failed network request could un-highlight a name.** Whether a
wiki has an article is not what decides whether a name is a name.

### Fixed by
- `reject()` no longer removes a term from the matcher; it only demotes it to
  `GUESSED` so it is drawn more quietly.
- `prefetch()` distinguishes a failed request from a definitive "no such
  article" (by watching the client's failure counter) and only rejects on the
  latter; it also stops prefetching for the chapter once the wiki stops
  answering.
- The watchdog is capped at 3 consecutive attempts.
- Discovery no longer generates initialisms for titles longer than 5 words, so
  `fbsgaoylsmatb` is never produced.

### Previously tried, did not fix it
- Guaranteeing the scan-completion callback fires once.
- Re-attaching tap handler and observer to `document`.
- `isStillPainted()` + 3s watchdog — this **made it worse**, turning a one-off
  failure into a permanent loop.
- Ungating marking from the network — correct and kept; it is why marking works
  at boot, but it did not stop the later destruction.

---

## Bug 2 — the chosen wiki is forgotten

**Mechanism now works. Needs an explicit end-to-end check.**

`boot count` climbing 1 → 2 across a chapter change proves the `window.name`
fallback persists. Storage is no longer the blocker it was.

Both captures show `wiki: (none)` — but the wiki was never set during that run,
so this neither confirms nor refutes the remaining behaviour.

### Outstanding check
Set the wiki to `battle-through-the-heavens`, move to the next chapter, and see
whether it is still set. If it is not, the fault is in the load order
(`Settings.load` → `useNovel`), not in storage.

### Ruled out
- Novel identity: the key is stable and correct across chapters.
- The settings write path: values reach the store and survive.

### Previously tried
- Stripping chapter numbers from the novel title for a stable key.
- Committing text fields on `input`/`blur`/Enter, not just `change`.
- `window.name` fallback and multi-store write/read — **this is the one that
  worked.**

---

## Bug 3 — the ladder shows too few, and wrong, levels

**Root cause found and fixed. Needs confirmation on device.**

### What the screenshot showed
The ladder rendered as:

```
1  Rank            IN THIS CHAPTER
2  Pinyin
3  Peak Dou Zun(...)
4  Ban Sheng(...)
5  Half Step Dou Di(...)
```

introduced by the wiki's editorial notice. "Show all levels" produced the same
five, so nothing was being folded — the parser genuinely found only these.

Three separate defects:

1. **Column headers read as rungs.** "Rank" and "Pinyin" name the columns. The
   header row's cells were ordinary `<td>`, so a structural "skip all-`<th>`
   rows" test did not catch them.
2. **The first table won regardless of size.** The page opens with a small
   summary table; the real ladder is further down.
3. **`parseIntro` did not filter editorial notices**, though the entity
   summaries already did.

### Fixed by
- Header rows skipped structurally (all-`<th>` rows), **plus** a `COLUMN_LABELS`
  list so header cells marked up as `<td>` are dropped too.
- Every table in the chosen section is considered; the one yielding the most
  rungs wins.
- `parseIntro` now runs the same editorial-notice filter as entity summaries.

---

## Secondary issues

1. **`Failed to fetch` is still not distinguished from "no such article"** inside
   `WikiClient` — both return `null`. Bug 1's fix works around this at the call
   site by watching the failure counter. Worth fixing properly at the client.
2. **Infobox tags include values that are not tags** — "Cai Lin", "Gu Xun Er"
   appeared as capsules, presumably a relationships field classified as
   affiliation.
3. **Panel footer can sit under `#reader-footer-wrapper`.** Mitigated with 72px
   bottom padding; verify it is enough.
4. **Verify `SKIP_SELECTOR` does not over-match.** If `#LNReader-chapter` were
   ever inside `#reader-ui`, `closest()` would reject every text node and
   marking would silently yield zero. The device log exonerates it here, but it
   is a sharp edge.

---

## Next session

1. Confirm bug 1 and bug 3 are actually gone on device.
2. Run the bug 2 end-to-end check above.
3. If all three are clear, publish.
