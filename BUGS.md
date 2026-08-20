# Known bugs

What is **measured**, what is **inferred**, and what has been tried — so work
resumes from evidence rather than re-derivation.

Status as of 2026-08-20, LoreLens 2.0.0.

Device: OPPO CPH2447, Android 16, LNReader, light reader theme.
Novel under test: a **fan work**, so no wiki matches its title. The relevant wiki
is the source work's, `battle-through-the-heavens.fandom.com`, set by hand.

Screenshots: `assets/bug-reports/` (gitignored — photographs of pages of a
copyrighted novel, and this repo is public).

---

## How LNReader runs this script

Read from source, not inferred. `src/screens/reader/components/WebViewReader.tsx`.

The pasted script is interpolated into a function in the page:

```js
async function fn(){
  let novelName   = "...";
  let chapterName = "...";
  let sourceId    = ...;
  let chapterId   = ...;
  let novelId     = ...;
  let html = document.querySelector("chapter").innerHTML;
  <the pasted script goes here>
}
document.addEventListener("DOMContentLoaded", fn);
```

Consequences, all load-bearing:

- **`novelName` and `chapterName` are in scope.** They are the reader's own
  values. `document.title` is empty, so these are strictly better than anything
  we can infer. Now used.
- The WebView is created with `source={{ html }}` and **no `baseUrl`**, so the
  document has **no origin**.
- The message bridge accepts only `hide`, `next`, `prev`, `imgfile`,
  `scrollend`, `height`, `pages`. **There is no channel to persist anything.**
- WebView props: `originWhitelist={['*']}`, `javaScriptEnabled`,
  `allowFileAccess`. No `key` prop, so changing chapter replaces `source.html`
  and reloads the document in the *same* WebView.

### Measured on the device

| Fact | Value |
| --- | --- |
| `origin` | `null` |
| `secure context` | `false` — hence no `navigator.clipboard` |
| `storage` | `window.name` only; `localStorage` and `sessionStorage` both fail |
| `boot count` | climbs 1 → 2 across a chapter change |
| `document.title` | empty |
| chapter root | `DIV#LNReader-chapter` |
| highlight mode | `highlight` (Custom Highlight API) |

---

## Bug 1 — marks vanish between chapters

**Cause identified. Fixed in code. NOT yet confirmed on device.**

Reported precisely: *"entered a wiki in chapter 13, go to chapter 14, many names
lose their highlight, going to chapter 15 brings some back."*

That wording is the diagnosis. The index was built **only from names the current
chapter mentions often enough for detection to call them names** — two
occurrences at the default setting. A character already looked up and confirmed
against the wiki was therefore *not* marked in a chapter that mentioned them
once. Which names are marked then tracks which names happen to repeat in each
chapter, so they appear and vanish as pages turn.

### Fixed by
`seedIndexFromCache()` now loads every entity already cached for the novel into
the index at `CONFIRMED` confidence before detection runs, so a known name is
marked on its first occurrence. Aliases and the originally-tapped term are
indexed too.

### Earlier, separate cause — also fixed
A failed lookup used to call `index.reject()`, and rejected terms were excluded
from the matcher. With an unreachable wiki this emptied the matcher completely
and every mark disappeared. `reject()` now only demotes a term to a guess.
Confirmed from a device log showing `highlighted 51 mentions` at boot degrading
to `highlighted 0 mentions` after `wiki request failed`.

### Tried and did not fix it
- Guaranteeing the scan-completion callback fires once.
- Re-attaching tap handler and observer to `document`.
- `isStillPainted()` + a 3s watchdog — **made it worse**, an unbounded loop.
  Now capped at 3 attempts.
- Ungating marking from the network — correct, kept, not sufficient.

---

## Bug 2 — the wiki is forgotten

**Root cause established. Not fixable in-page. Worked around.**

Reported precisely: *"asks for wiki again if I exit a chapter and enter the
chapter again."* That distinction matters and is consistent with everything:

- Chapter → next chapter: same WebView, new document. `window.name` survives,
  which is why `boot count` climbs 1 → 2. Settings hold.
- Leaving the reader: the WebView is unmounted. `window.name` goes with it.

There is no alternative. The document has no origin, so the browser refuses
`localStorage`, `sessionStorage`, cookies and IndexedDB alike, and LNReader's
bridge exposes no message type to save into. **Nothing a page script can do will
persist across closing the novel.**

### Worked around by
A `WIKIS` block at the top of `lorelens.js` mapping any distinctive part of a
novel's title to a wiki subdomain. It is the only durable setting available, so
matching is deliberately forgiving (case-insensitive, substring, longest match
wins). The settings panel now states plainly that the in-app value will not
survive, and prints the exact line to add.

### Ruled out
- Novel identity — the key is stable and correct across chapters.
- The settings write path — values reach the store and survive a chapter change.

---

## Bug 3 — the ladder shows too few, and wrong, levels

**Partly fixed. Still wrong on the real page. Cause not fully established.**

Session 3 showed a ladder reading `1 Rank / 2 Pinyin / 3 Peak Dou Zun`, headed by
the wiki's editorial notice. Three defects, all fixed:

- column headers read as rungs (header cells marked up as `<td>`, so skipping
  all-`<th>` rows missed them — now there is a `COLUMN_LABELS` list);
- the first table on the page won regardless of size;
- `parseIntro` did not run the editorial-notice filter.

Session 4 shows it improved but **still wrong**: three rungs, and they are the
*top* realms only. So a small table is still winning over the real progression.
`parseLadder` now takes the better of the section-scoped and whole-document
results rather than the first to clear three rungs, which should help — but this
is a guess at the page's shape, not a fix derived from it.

### What is actually needed
The structure of `battle-through-the-heavens.fandom.com/wiki/Cultivation`:
which element holds the full progression, and what the small three-row table
near it is. Attempting to fetch it this session failed (HTTP 402, rate limited).
Either fetch it next session, or read the parse decision out of the diagnostics
log, which now records how many rungs each strategy produced.

---

## Secondary issues

1. `WikiClient` still returns `null` for both "no such article" and "the request
   failed". Bug 1's fix works around this at the call site. Fix it at the client.
2. Infobox tags include values that are not tags ("Cai Lin", "Gu Xun Er").
3. Panel footer can sit under `#reader-footer-wrapper`; mitigated with 72px
   padding, unverified.
4. `SKIP_SELECTOR` includes `#reader-ui`. If the chapter were ever inside it,
   `closest()` would reject every text node and marking would silently yield
   zero. Not the case on this device, but a sharp edge.

---

## Next session

1. Confirm bug 1 on device — marks should now persist across chapters for any
   name looked up before.
2. Confirm the `WIKIS` block makes the wiki stick across closing the novel.
3. Get the structure of that Cultivation page and finish bug 3 from evidence.

Nothing has been confirmed fixed on device. Do not publish on the strength of
the test suite alone — every one of these bugs passed a green suite.
