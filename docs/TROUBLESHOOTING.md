# When it doesn't work

Roughly in the order things go wrong. Most of these are one setting.

Before anything else: open the settings panel (the round **L** button) and tap
**Copy diagnostics**. It puts a short block of text on your clipboard saying
what LoreLens can and cannot see on your device. If you end up filing an issue,
paste that in — it is the difference between a fixable report and a guessing
game.

---

## Nothing happens at all — no marks, no button

**The script did not run.** In order of likelihood:

1. **You are still in the chapter you had open when you installed it.** Custom
   JS is applied when a chapter loads. Go back to the chapter list and open a
   chapter again.
2. **It did not save.** Go back to **Settings → Reader → gear icon → `{}` → JS**
   and check the text is actually still there.
3. **It went into the CSS tab, not the JS tab.** They sit next to each other in
   the same panel, and CSS silently ignores JavaScript.
4. **The paste was truncated.** The file is large and some text fields cut off
   long input without saying so. Scroll to the end of what you pasted — the last
   line should be `})();`. If it is not, use the **Import** button with the
   downloaded file instead, which cannot truncate.

## Names are marked, but tapping does nothing

The panel is probably opening behind something, or the tap is being eaten by the
reader's own tap-to-scroll zones.

Try tapping a marked name near the middle of the line rather than at the edge of
the screen — the outer strips of a reader are usually page-turn zones.

If that is not it, the diagnostics will say `highlight mode: highlight`. That
mode resolves taps by position, which depends on `caretRangeFromPoint`. If your
diagnostics show that as `false` alongside mode `highlight`, that is a bug —
please report it, because those two should never disagree.

## "LoreLens has not found a wiki for this novel yet"

Automatic discovery guesses the wiki address from the novel's title. It misses
when the wiki is named differently from the book — which is common for novels
with long titles, or ones better known by an abbreviation.

Fix it once, in settings: search the web for your novel plus "fandom", and enter
the part before `.fandom.com`. It is remembered for that novel.

## Everything is hidden / it hides too much

You are on the default spoiler guard with no chapter number.

If LoreLens does not know where you are in the book, it cannot tell which
chapters are behind you, so it hides anything that mentions a specific chapter.
That is the safe half of the guess, but it is blunt.

Open settings and put your chapter number in **You are on chapter**. Things
before that point stop being hidden.

If you would rather not have any of it, set **Spoiler guard** to *Show me
everything*. It is your book.

## It hides too little — I got spoiled

Sorry. Two things to do:

1. Set **Spoiler guard** to *Hide anything that sounds final*. That adds
   phrase-based hiding on top of the chapter-based hiding, and catches wiki
   prose that gives away an ending without citing a chapter.
2. If a specific sentence should have been caught, please
   [open an issue](../../issues/new?template=bug_report.yml) with the wiki, the
   article, and the sentence — put `[spoilers]` in the title. The phrase list in
   `src/10-constants.js` is community-maintained and adding to it is a two-line
   change.

## Too many wrong things are underlined

Set **How much to highlight** to *Only names I have confirmed*. That marks a
name only once LoreLens has actually found an article for it, so the false
positives disappear — at the cost of nothing being marked in a chapter until it
has looked things up.

*Balanced*, the default, marks anything that looks like a name and quietly
un-marks the ones the wiki has never heard of.

## The ☰ button says it cannot find a power system

It looks for pages named the way wikis usually name them — Cultivation, Realms,
Power System, Ranks and a dozen others — and then falls back to the wiki's own
search. Some wikis file it under something nobody would guess, and plenty of
novels have no ranking system at all.

If the wiki does have such a page, please
[open an issue](../../issues/new?template=wiki_compat.yml) with its URL. Adding
a title to the list in `src/88-realms.js` is a one-line change and a good first
pull request.

## The ladder is in the wrong order, or full of junk

The rungs are read out of whatever structure the page uses — a numbered list, a
run of headings, a table. A page that puts its realms in prose, or in a layout
none of those describe, will come out wrong.

Worth reporting with the page URL. Tap **Refresh** in the ladder panel after a
fix ships, or the old version stays cached for a few weeks.

## The panel's colours look wrong against my theme

LoreLens reads the colours your reader is painting and builds a matching palette.
If your theme sets its background on an element LoreLens does not look at, it can
end up with a mismatched surface.

This is a bug worth reporting — include the diagnostics and the name of the theme.

## Text selection or text-to-speech broke

Check the diagnostics for `highlight mode`.

- `highlight` — names are painted without touching the page, and selection and
  speech should be completely unaffected. If they are not, that is a serious bug
  and we want to hear about it.
- `wrap` — your device's WebView is too old for the painted path, so LoreLens
  falls back to wrapping names in elements, which can fragment a selection.
  Updating **Android System WebView** from the Play Store usually moves you onto
  the good path.

## It stopped working after a reader update

Most likely the reader changed the markup around the chapter text and the
detection did not find it. The diagnostics line `root:` tells you what LoreLens
latched onto — if it says `NONE`, that is what happened.

Please report it with the diagnostics and your reader's version. It is normally
a one-line fix to a list of selectors.

## It is slow on long chapters

Turn off **Load ahead** in settings. That stops LoreLens quietly fetching entries
in the background, which is the only thing it does that is not strictly
necessary.

Highlighting itself is spread across frames and yields to scrolling, so it should
never be the cause — if it is, that is a bug worth a report.

## Everything broke and I want it gone

Clear the custom JS field in your reader's settings and save. That removes it
entirely. Nothing else on your device is touched, apart from a cache in your
reader's local storage which you can clear from the LoreLens settings panel
first if you want to.

---

## Filing a good report

[Open an issue](../../issues/new?template=bug_report.yml) with:

- The diagnostics block
- Which wiki and which entry, if it is about a lookup
- Your device and Android version — this matters more than you would expect,
  because the browser features LoreLens uses depend on your Android System
  WebView version

And please keep plot spoilers out of it, or put `[spoilers]` in the title.
