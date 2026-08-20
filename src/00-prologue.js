/* =============================================================================
 *  LoreLens — tap a name, get the wiki entry, without leaving the chapter.
 *
 *  You are reading the whole program. It is one file on purpose: you are about
 *  to paste it into your reader, and you should be able to see everything it
 *  does before you do.
 *
 *  What it does
 *    · Finds character, place and technique names in the chapter you are reading
 *    · Tapping one opens a panel with the portrait, tags and summary from the
 *      novel's Fandom wiki
 *    · Hides anything that reads like a spoiler for a chapter you have not
 *      reached yet, behind a tap
 *
 *  What it needs from you
 *    Nothing. Paste it in and open a chapter. It works out which wiki your
 *    novel uses on its own; if it guesses wrong, tap the LoreLens button and
 *    tell it. There is no config to edit, no account, and no API key.
 *
 *  What it sends anywhere
 *    Only the name you tapped, only to that novel's Fandom wiki, and only when
 *    you tap it. No cookies are sent. Nothing about you is sent.
 *
 *  Install, docs, and how to report a bug
 *    https://github.com/Lumpish-Haggard/LoreLens
 *
 *  MIT licensed. Built by people who got tired of googling "who is <name>" and
 *  being spoiled by the first result.
 * ========================================================================== */

(function lorelensMain() {
  'use strict';

  /* Readers re-inject custom scripts on every chapter, and some do it more than
   * once per chapter. A second run should pick up the new text, not build a
   * second copy of the whole UI on top of the first. */
  if (window.lorelens && typeof window.lorelens.rescan === 'function') {
    window.lorelens.rescan();
    return;
  }
