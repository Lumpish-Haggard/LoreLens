import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const chapterHtml = `
<div id="LNReader-chapter">
  <h2>Chapter 862</h2>
  <p>Gu Changge stood on the other side of the River of Time. The fog swirled around him.</p>
  <p>Chan Hongyi and Tao Yao could be seen in different segments of time.</p>
  <p>Gu Changge did not interfere. The truths that Chan Hongyi and Tao Yao saw were both true.</p>
  <p>Young Master Gu smiled. <a href="#">Gu Changge</a> should stay unwrapped inside links.</p>
  <p>However the young master noticed Yue Mingkong watching him. Yue Mingkong said nothing.</p>
</div>`;

const dom = new JSDOM(`<!doctype html><html><head></head><body>${chapterHtml}</body></html>`, {
  runScripts: 'outside-only',
  url: 'https://example.com/chapter',
  pretendToBeVisual: true,
});

const inlineLorepack = {
  schemaVersion: 1,
  entities: [
    {
      id: 'gu-changge',
      name: 'Gu Changge',
      aliases: ['Young Master Gu'],
      native: '顾长歌',
      romanized: 'gù cháng gē',
      image: '',
      chips: [
        { label: 'Alive', tone: 'good' },
        { label: 'Ancient Immortal', tone: 'accent' },
      ],
      sections: [
        { title: 'Background & context', body: 'The fated villain of this world.', isSpoiler: false },
        { title: 'Late arc', body: 'Ascends beyond the Immortal Domain.', isSpoiler: true },
      ],
      wikiUrl: 'https://example.fandom.com/wiki/Gu_Changge',
    },
  ],
};

let source = readFileSync('./lorelens.js', 'utf8');
source = source.replace('inlineLorepack: null,', `inlineLorepack: ${JSON.stringify(inlineLorepack)},`);
source = source.replace("fandomWiki: '',", "fandomWiki: 'example',");

dom.window.fetch = async () => ({ ok: false, status: 404, json: async () => ({}) });
dom.window.requestIdleCallback = undefined;

dom.window.eval(source);

await new Promise((resolve) => setTimeout(resolve, 400));

const { document } = dom.window;
const marks = [...document.querySelectorAll('.lorelens-term')];
const terms = marks.map((m) => m.getAttribute('data-lorelens-term'));

console.log('--- highlighted terms ---');
console.log(terms.join(' | '));

const insideLink = marks.filter((m) => m.closest('a')).length;
console.log('terms wrapped inside <a>:', insideLink, '(expected 0)');
console.log('auto-detected extras:', terms.filter((t) => !['Gu Changge', 'Young Master Gu'].includes(t)).join(', '));

// simulate a tap on a lorepack-backed term
const target = marks.find((m) => m.getAttribute('data-lorelens-term') === 'Gu Changge');
target.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
await new Promise((resolve) => setTimeout(resolve, 50));

const sheet = document.querySelector('.lorelens-sheet');
console.log('\n--- sheet state ---');
console.log('visible:', sheet.classList.contains('is-visible'));
console.log('name:', sheet.querySelector('.lorelens-name')?.textContent);
console.log('script line:', sheet.querySelector('.lorelens-script')?.textContent);
console.log('chips:', [...sheet.querySelectorAll('.lorelens-chip')].map((c) => c.textContent).join(', '));
console.log('sections:', [...sheet.querySelectorAll('.lorelens-section-title')].map((s) => s.textContent).join(' / '));
console.log('blurred bodies:', sheet.querySelectorAll('.lorelens-body.is-hidden').length, '(expected 1)');

// reveal spoiler
sheet.querySelector('.lorelens-reveal')?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
console.log('blurred after reveal:', sheet.querySelectorAll('.lorelens-body.is-hidden').length, '(expected 0)');

// close
sheet.querySelector('.lorelens-close').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
console.log('visible after close:', sheet.classList.contains('is-visible'), '(expected false)');

// tap an auto-detected term with failing live lookup
const autoTerm = marks.find((m) => m.getAttribute('data-lorelens-term') === 'Yue Mingkong');
if (autoTerm) {
  autoTerm.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 60));
  console.log('\nfallback state body:', sheet.querySelector('.lorelens-state-body')?.textContent.slice(0, 60));
}
