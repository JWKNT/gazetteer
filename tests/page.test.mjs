import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url));
const html = read('index.html').toString();
const app = read('assets/app.js').toString();
const { regions } = JSON.parse(read('data/countries.json'));

test('the page follows the shared identity header contract', () => {
  assert.match(html, /<link rel="canonical" href="https:\/\/jehlp\.net\/gazetteer\/">/);
  assert.match(html, /<title>Gazetteer · jehlp\.net<\/title>/);
  assert.equal((html.match(/class="site-home"/g) || []).length, 1);
  assert.match(html, /class="site-home" href="https:\/\/jehlp\.net\/" aria-label="Home — jehlp.net"/);
  assert.match(html, /<button class="theme-toggle" type="button" data-theme-toggle/);
  assert.match(html, /<img class="site-mark" src="assets\/mark\.png" width="32" height="32" alt="">/);
  const header = html.slice(html.indexOf('<header'), html.indexOf('</header>'));
  assert.doesNotMatch(header, /github/i, 'no source link in the header');
});

test('scripts load from this site or the shared theme only', () => {
  for (const [, src] of html.matchAll(/<script src="([^"]+)"/g)) {
    assert.ok(src.startsWith('assets/') || src.startsWith('https://jehlp.net/site-theme/v2/'), src);
  }
});

test('the country list holds every region in static HTML', () => {
  const options = [...html.matchAll(/<option value="([A-Z]{3})">/g)].map(match => match[1]);
  assert.deepEqual([...options].sort(), Object.keys(regions).sort());
  assert.match(html, /<select id="country-select" name="country" data-ui-select>/);
});

test('the card is a named dialog and the canvas has keyboard help', () => {
  assert.match(html, /<dialog class="country-card" id="country-card" aria-labelledby="card-title">/);
  assert.match(html, /<canvas id="globe" tabindex="0" role="img" aria-label="[^"]+" aria-describedby="globe-help">/);
  assert.match(html, /role="status" aria-live="polite"/);
});

test('data is written as text, not as markup', () => {
  assert.doesNotMatch(app, /innerHTML|insertAdjacentHTML|document\.write/);
});

test('original page text uses short sentences without semicolons', () => {
  const prose = html
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<option[\s\S]*?<\/option>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/g, ' ');
  assert.doesNotMatch(prose, /;/);
  for (const sentence of prose.split(/(?<=[.!?])\s+/)) {
    const words = sentence.trim().split(/\s+/).filter(Boolean);
    assert.ok(words.length <= 30, `sentence too long: ${sentence.trim().slice(0, 80)}`);
  }
});

test('the identity images are small RGBA PNGs', () => {
  for (const [file, side] of [['assets/mark.png', 128], ['assets/favicon.png', 192]]) {
    const png = read(file);
    assert.equal(png.subarray(1, 4).toString(), 'PNG', file);
    assert.equal(png.readUInt32BE(16), side, file);
    assert.equal(png.readUInt32BE(20), side, file);
    assert.equal(png[25], 6, `${file} has an alpha channel`);
  }
});
