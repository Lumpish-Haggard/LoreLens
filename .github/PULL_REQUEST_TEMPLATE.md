## What this changes

<!-- One or two sentences. If it fixes an issue, write "Fixes #123". -->

## Why

<!-- The reading situation that made you write this. -->

## How I tested it

<!-- Delete the rows that do not apply. Automated tests cannot cover the reader
     integration, so the manual rows carry real weight in review. -->

| | |
| --- | --- |
| `npm test` | pass / fail / did not run |
| Device | e.g. Pixel 7a, Android 15 |
| Reader app + version | e.g. LNReader 2.x |
| Wiki I tried it against | e.g. shadowslave.fandom.com |

If this touches highlighting, the sheet, or spoiler handling, please confirm on a
real device:

- [ ] Long-press still selects text normally
- [ ] Text-to-speech still reads correctly
- [ ] Highlights re-apply after moving to the next chapter
- [ ] The panel still follows the reader's theme colors
- [ ] Nothing breaks with no network

## Checklist

- [ ] I edited files in `src/`, not `dist/lorelens.js`
- [ ] I ran `npm run build` so `dist/` matches `src/`
- [ ] New behaviour has a test, or I have said below why it cannot have one
- [ ] No new dependencies
- [ ] No plot spoilers in the diff, tests, or screenshots

## Screenshots

<!-- Very welcome for anything visual. Please blur or crop out spoilers. -->
