// Government type, former names and independence, from The World Factbook.
import { clean } from './factbook.mjs';

const capitalize = text => text.charAt(0).toUpperCase() + text.slice(1);

// The Factbook writes family names in capitals, such as "Emperor JIMMU". Acronyms and
// Roman numerals stay as they are.
const acronyms = new Set(['USSR', 'SFSR', 'RSFSR', 'FRG', 'GDR', 'TRNC', 'UAE']);
const names = text => text.replace(/\b[A-Z][A-Z']{2,}\b/g, word =>
  acronyms.has(word) || /^[IVXLC]+$/.test(word) ? word : word.charAt(0) + word.slice(1).toLowerCase());

// A description: its first clause, then each later clause that is short. A long clause,
// such as a history of later events, is left out.
const describe = text => split(names(text), ';')
  .filter((clause, index) => index === 0 || clause.length <= 45)
  .map(capitalize).join('. ');

// Split at commas or semicolons that are outside parentheses and brackets.
function split(text, separators) {
  const parts = [];
  let depth = 0, part = '';
  for (const char of text) {
    if ('([{'.includes(char)) depth++;
    if (')]}'.includes(char)) depth--;
    if (separators.includes(char) && depth === 0) { parts.push(part.trim()); part = ''; } else part += char;
  }
  parts.push(part.trim());
  return parts.filter(Boolean);
}

const field = (entries, ...path) => {
  for (const entry of entries) {
    let value = entry?.Government;
    for (const key of path) value = value?.[key];
    if (value?.text) return clean(value.text).replace(/\s+/g, ' ').trim();
  }
  return '';
};

// "parliamentary constitutional monarchy; a Commonwealth realm" gives the type and a
// note. Names of legislatures and dates in parentheses are removed. A long second part
// or a note is left out.
export function governmentType(entries) {
  const text = field(entries, 'Government type').split(/\bnote\b/)[0];
  if (!text) return null;
  const [main, second] = split(text, ';').map(part => part
    .replace(/\s*\((?:[^()]*[A-Z][^()]*|since [^()]*)\)/g, '')
    .replace(/\s+/g, ' ').trim());
  const note = second && second.length <= 70 ? capitalize(second.replace(/^and /, '')) : null;
  return { type: capitalize(main), ...(note ? { note } : {}) };
}

// Former names, without the explanations in parentheses.
export function formerNames(entries) {
  const text = field(entries, 'Country name', 'former');
  if (!text || /^none$/i.test(text)) return [];
  return split(text, ',;').map(name => name.replace(/\s*[([][^)\]]*[)\]]/g, '').trim()).filter(Boolean);
}

// A date such as "4 July 1776", "14-15 May 1811", "ca. 550 B.C.", "A.D. 1501" or "1238".
const date = String.raw`(?:ca\. )?(?:A\.D\. )?(?:\d{1,2}(?:-\d{1,2})? [A-Z][a-z]+ )?\d{1,4}(?: B\.C\.)?`;
const dated = new RegExp(String.raw`(${date})\s*(?:\(((?:[^()]|\([^()]*\))*)\))?`, 'g');
const item = ([, when, what]) => ({ date: when, ...(what ? { description: describe(what) } : {}) });
// A description of independence from another state, as opposed to a founding.
const fromAnother = /independen|^from\b|^declared\b|mandate|trusteeship/i;

// The independence of the region, or the founding of a state that never became
// independent from another. The first date is the main one. "Notable earlier dates" give
// the earliest date as a second line. A territory has none.
export function independence(entries) {
  const text = field(entries, 'Independence');
  if (!text) return null;
  const none = text.match(/^none\s*\((.*)\)\s*$/i);
  if (none) return { label: 'Independence', date: 'None', description: describe(none[1]) };
  if (/^none/i.test(text)) return { label: 'Independence', date: 'None' };
  const [current, earlier = ''] = text.replace(/^no official date of independence:\s*/i, '').split(/;?\s*notable earlier dates:\s*/i);
  const head = split(current, ';')[0];
  // Free text, such as a history without a date, has no main date.
  if (!new RegExp(`^${date}`).test(head)) return null;
  const main = [...head.matchAll(dated)].map(item)[0];
  const first = [...earlier.matchAll(dated)].map(item)[0];
  return {
    label: fromAnother.test(main.description ?? '') ? 'Independence' : 'Founded',
    ...main,
    ...(first ? { earlier: first } : {}),
  };
}

// All dated items of the field, for a reviewed choice among them.
export function independenceDates(entries) {
  const text = field(entries, 'Independence').replace(/^no official date of independence:\s*/i, '').replace(/notable earlier dates:\s*/i, '');
  return [...text.matchAll(dated)].map(item);
}
