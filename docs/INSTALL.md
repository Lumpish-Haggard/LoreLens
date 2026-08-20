# Installing LoreLens

Five minutes, once. After this you never touch the file again — everything is
adjustable from inside the reader.

## What you need

- **[LNReader](https://github.com/LNReader/lnreader)** on Android, or another
  reader that can run custom JavaScript in its reader view.
- Any novel open in it.

That is all. No account, no API key, no computer.

## Step 1 — Get the file

Download **[`lorelens.js` from the latest release](../../releases/latest)** to
your phone, or [straight from the repository](../dist/lorelens.js).

Save it somewhere you can find again — your Downloads folder is fine. You do not
need to open it.

It is a large file. It is unminified deliberately, so that you, or anyone you
pass it to, can read exactly what it does before running it.

## Step 2 — Load it into the reader

In LNReader:

1. Open **Settings**
2. Go to **Reader**
3. Tap the **gear icon** at the bottom right
4. Tap the **`{}`** icon — it is the last one
5. Switch to the **JS** tab
6. Tap **Import** and choose the file you downloaded
7. **Save**

There is a **Copy/Paste** option next to Import if you would rather paste the
text. Import is the better choice: the file is large, and some text fields cut
off long input without telling you, which produces a script that half-runs.

> This is written against one release of LNReader, and the reader settings have
> moved before. If yours looks different, please
> [tell us](../../issues/new?template=bug_report.yml) — include your LNReader
> version — and this page will be corrected.

## Step 3 — Open a chapter

Close settings and open any chapter. Give it a second.

You should see:

- Some names in the text lightly underlined and tinted
- A small round **L** button in the bottom corner

Tap a marked name and the panel slides up.

Changes to custom JS usually apply when a chapter is opened, not while you are
sitting in one. If nothing happened, back out to the chapter list and open a
chapter again.

## Step 4 — Check it found the right wiki

Tap the **L** button. The top field says which wiki it is using.

If it is empty or wrong, type the correct one. You want the part before
`.fandom.com` — for `https://shadowslave.fandom.com` you type `shadowslave`.
Pasting the whole URL works too; it will trim it for you.

To find it: search the web for your novel's name plus "fandom", and look at the
address of the result.

Your choice is remembered per novel, so you only do this once per book, and only
when the automatic guess misses.

## Step 5 — Tell it where you are

Still in settings, **You are on chapter** should already show roughly your
position — it reads the number out of the chapter title.

If it is blank, your reader's chapter titles do not contain numbers, so type
your chapter number in. This is what the spoiler guard compares against, and
without it the guard falls back to hiding anything that mentions a specific
chapter, which is safe but blunt.

It updates itself upward as you read. It never goes down, so flicking back to an
earlier chapter will not suddenly re-hide things you have already seen.

## Updating later

Download the new file and **Import** it over the old one, the same way. Your
settings, your per-novel wiki choices and your cached entries all live in your
reader's storage rather than in the file, so an update does not disturb them.

## Uninstalling

Go back to **Settings → Reader → gear icon → `{}` → JS**, clear the field, and
save. That is the whole footprint — LoreLens adds nothing outside that field
except its cache in your reader's local storage, which you can clear from the
LoreLens settings panel first if you want to be thorough.

## If something did not work

See **[TROUBLESHOOTING.md](TROUBLESHOOTING.md)**. It covers the six things that
go wrong, in the order they go wrong.
