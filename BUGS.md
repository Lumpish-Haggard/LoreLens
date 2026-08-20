# Known bugs

Three bugs reported from real use are still open. This file records what is
**measured**, what is **inferred**, and what has already been tried and failed,
so that work resumes from evidence rather than from re-derivation.

Status as of 2026-08-20, LoreLens 2.0.0, commit `51d91a8`.

Device: OPPO CPH2447, Android 16, LNReader, light reader theme.
Novel under test: *Fights Break Sphere: Get all of Yao Lao's memories at the
beginning* — a **fan work**, so no wiki exists for it. The relevant wiki is the
source work's, `battle-through-the-heavens.fandom.com`, which must be set by
hand.

Screenshots: `assets/bug-reports/` (gitignored — they are photographs of pages
of a copyrighted novel, and this repo is public).

---

## Confirmed environment facts

These are **measured on the device**, from the in-app diagnostics, and
corroborated by reading LNReader's source. Stop re-deriving them.

| Fact | Value | Consequence |
| --- | --- | --- |
| `origin` | `null` | No origin-scoped storage survives. |
| `secure context` | `false` | No `navigator.clipboard`, and no other secure-context API. |
| `clipboard API` | `false` | "Copy diagnostics" can never work here. Diagnostics must be on-screen. |
| `storage` | `window.name` only | **`localStorage` and `sessionStorage` both fail the probe.** |
| `document.title` | empty | Cannot be used to identify the novel. |
| chapter root | `DIV#LNReader-chapter` | Detection is correct. |
| highlight mode | `highlight` | The CSS Custom Highlight API path is active. |
| Feature detection | all `true` | `CSS.highlights`, `Highlight`, `caretRangeFromPoint`, `caretPositionFromPoint`, `DOMParser`, `AbortController`, `requestIdleCallback`, `MutationObserver`, lookbehind regex. |

Why the origin is null: LNReader renders the chapter with
`source={{ html: ... }}` and **no `baseUrl`**, in
`src/screens/reader/components/WebViewReader.tsx`. Custom JS is interpolated
into a final `<script>` block in that HTML, so it runs once per document, after
the built-in scripts. Every chapter is a **new document**.

Also documented by LNReader and worth knowing: `#reader-ui`,
`#reader-footer-wrapper`, `#ToolWrapper`, `#ScrollBar`, `#TTS-Controller`,
`.next-button`, `body.page-reader`, and `.highlight` (the element TTS is
currently reading).

---

## Bug 1 — marks disappear and never come back

**Severity: blocker.**

### Symptom
Names are marked when a chapter opens. After a short time — or after opening a
panel and returning — every mark is gone, and only leaving the novel and
re-entering brings them back.

### Root cause — now known, from the device log

The log in `02-diagnostics-log-boot-51-mentions-then-fetch-fails.jpg` and
`03-log-matcher-shrinks-to-1-term-0-mentions.jpg` shows the whole sequence:

```
   3ms  boot #1 (was 0)
   7ms  detected 5 candidate names
   8ms  matcher built over 5 terms
   9ms  highlighted 51 mentions          <- correct
   9ms  probing subdomains: fbsgaoylsmatb
  67ms  wiki request failed (1): Failed to fetch
  ...
6015ms  matcher built over 1 terms       <- the index has been emptied out
6026ms  highlighted 0 mentions
9015ms  matcher built over 7 terms
9025ms  highlighted 0 mentions
```

Marking works perfectly at boot — **51 mentions**. It is then destroyed by the
failing wiki lookups:

1. `LoreLensApp.prefetch()` calls `fetchEntity(term)` for the most common names.
2. Every request fails, because auto-discovery invented the subdomain
   `fbsgaoylsmatb` — an initialism of the fan work's very long title — which
   does not exist. `Failed to fetch` is a DNS/network failure, not a 404.
3. On a null result, `prefetch()` calls **`this.index.reject(term)`**.
4. `EntityIndex.buildMatcher()` **skips rejected terms**, so the matcher shrinks.
5. Once enough terms are rejected, nothing matches: `highlighted 0 mentions`.
6. The watchdog sees no marks, re-runs, re-detects the same names — but they are
   still rejected — and gets 0 again, **every 3 seconds, forever**
   (`04-log-watchdog-loop-every-3s.jpg`).

### The actual defect
**A failed network request un-highlights a name.** Rejection is meant to mean
"the wiki has no article for this", but it is currently also triggered by "the
request did not complete". Those are completely different, and only the first
should ever affect what is marked. Arguably even that should not: a name worth
marking is worth marking whether or not a wiki documents it.

### Fix direction for next session
- `prefetch()` must **not** reject on transport failure. Distinguish
  "resolved: no such article" from "request failed" — the wiki client currently
  collapses both to `null`.
- Reconsider whether `reject()` should remove a term from the matcher at all.
  Preferred: keep marking it, but at `GUESSED` confidence.
- The watchdog must not loop indefinitely. Cap consecutive heal attempts, and do
  not treat "0 mentions" as broken when the index legitimately has no usable
  terms.
- Skip wiki discovery entirely when it has already failed for this novel, and
  do not generate initialism candidates for very long titles — `fbsgaoylsmatb`
  is noise and costs a request per chapter.

### Already tried, did not fix it
- Guaranteeing the scan-completion callback fires once (commit `c5b3029`).
- Re-attaching the tap handler and mutation observer to `document` (`c5b3029`).
- `isStillPainted()` recovery check and the 3s watchdog (`d15dd41`) — this
  **made the symptom worse**, turning a one-off failure into a permanent loop.
- Ungating marking from the network (`51d91a8`) — correct and worth keeping, it
  is why marking now works at boot, but it does not stop the later destruction.

---

## Bug 2 — the chosen wiki is forgotten

**Severity: blocker.**

### Symptom
The wiki has to be entered again on every chapter.

### Root cause — now known
`origin: null`, and **both `localStorage` and `sessionStorage` fail the probe**.
The only backend that works is the `window.name` fallback added in `d15dd41`.
Diagnostics report `storage: window.name`.

`boot count: 1` in the capture. It must be observed **across a chapter change**
to tell whether `window.name` survives:

- If the count climbs → `window.name` persists, and any remaining loss is a
  logic bug in `Settings.useNovel` / load order.
- If it stays at 1 → the WebView is recreated per chapter and `window.name` is
  lost too, and **no in-page storage can work at all**. In that case settings
  must be persisted somewhere else entirely, and the honest options are:
  encoding them into the reader's own custom-JS text, or accepting that the wiki
  must be chosen per session and making that one tap instead of typing.

**This is the single most valuable measurement outstanding.**

### Not the cause (ruled out)
- Novel identity is stable and correct:
  `novel key: fights-break-sphere-get-all-of-yao-lao-s-memories-at-the-beginning`.
  The chapter-suffix stripping fix in `c5b3029` was aimed at a problem this
  novel does not have.
- The settings write path works; `settings:` in the diagnostics shows the full
  object being held.

### Already tried, did not fix it
- Stripping chapter numbers from the novel title for a stable key (`c5b3029`).
- Committing text fields on `input`/`blur`/Enter, not just `change` (`d15dd41`).
- The `window.name` fallback and multi-store write/read (`d15dd41`, `51d91a8`).

---

## Bug 3 — the ladder shows too few levels

**Severity: significant. Root cause NOT yet known.**

### Symptom
Reported as "it is only showing cultivation realms mentioned in the chapter".

### What is known
- Nothing in the code filters rungs by chapter. Rungs named in the chapter get a
  highlight and an "IN THIS CHAPTER" tag; all of them should still be listed.
- Folding only happens when **Spoiler guard = "Hide anything that sounds
  final"**. The reported setting was `spoilerGuard: "chapter"`, which folds
  nothing — so folding is probably not the explanation.
- More likely the parser is finding only a few rungs on that wiki's page.

### Outstanding
**No screenshot of the ladder panel has been captured yet.** That is the one
artefact needed. The header now reads "4 of 10 levels" when anything is held
back, which distinguishes truncation from a short parse at a glance.

### Already done
- Section-aware extraction, so the progression section is chosen over technique
  or alchemy sections (`c5b3029`).
- Numbered-tier detection, so sub-steps are dropped (`c5b3029`).
- A "Show all levels" button and an "n of m" count (`d15dd41`).

---

## Secondary issues seen in the screenshots

Lower priority, all real, none blocking.

1. **Wiki discovery is useless for fan works and costs a request per chapter.**
   It generates candidates like `fbsgaoylsmatb` from a long title. It should not
   produce initialisms beyond a certain title length, should cache the failure
   hard, and should be skipped entirely once a wiki has been set by hand.
2. **`Failed to fetch` is not distinguished from "no such article"** anywhere in
   `WikiClient`. Both return `null`. This is the direct enabler of bug 1 and
   should be fixed at the client, not patched at each call site.
3. **Infobox tags include values that are not tags** — "Cai Lin", "Gu Xun Er"
   appeared as capsules, presumably from a relationships field classified as
   affiliation. Tighten `FIELD_ALIASES` or the tag rules.
4. **The panel footer can sit under the reader's own toolbar.**
   `#reader-footer-wrapper` draws over the page and toggles on tap. Mitigated
   with 72px of bottom padding in `d15dd41`; verify it is enough.
5. **Verify the new SKIP_SELECTOR entries do not over-match.** `51d91a8` added
   `#reader-ui` and friends. If `#LNReader-chapter` is ever *inside*
   `#reader-ui`, `closest()` would reject every text node and marking would
   silently produce zero. This was a suspect for bug 1 before the log arrived;
   the log exonerates it for this device, but it is worth an explicit check.

---

## What to do first, next session

1. **Fix bug 1.** The cause is known and the fix is small: stop rejecting terms
   on transport failure, and stop the watchdog looping. This alone makes the
   tool usable.
2. **Get `boot count` across a chapter change.** One number decides the entire
   design of bug 2's fix.
3. **Get one screenshot of the ☰ ladder** on Battle Through the Heavens.

Do not publish until 1 and 2 are closed.
