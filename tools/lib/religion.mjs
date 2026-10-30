// The largest religious group of each region. Pew Research Center gives the shares of
// seven groups in 2020 for the 201 countries and territories with 100,000 people or
// more. The World Factbook gives the shares for the smaller territories.
import { readFileSync } from 'node:fs';
import { csvRows } from './sources.mjs';
import { clean } from './factbook.mjs';

export const groupNames = {
  Christians: 'Christianity', Muslims: 'Islam', Hindus: 'Hinduism', Buddhists: 'Buddhism', Jews: 'Judaism',
  Other_religions: 'Other religions', Religiously_unaffiliated: 'No religion',
};

// Shares in percent for 2020, by UN M49 country code.
export function readPew(path) {
  const [header, ...rows] = csvRows(readFileSync(path, 'utf8'));
  const column = name => header.indexOf(name);
  const byCode = new Map();
  for (const row of rows) {
    if (row[column('Year')] !== '2020' || row[column('Level')] !== '1') continue;
    const shares = Object.fromEntries(Object.keys(groupNames).map(group => [group, Number(row[column(group)])]));
    byCode.set(Number(row[column('Countrycode')]), { country: row[column('Country')], shares });
  }
  return byCode;
}

// UN M49 codes by ISO 3166 alpha-3 code, from the GeoNames country list. Pew counts
// Jersey and Guernsey together as the Channel Islands, and gives Kosovo the code 412.
export function readM49(path) {
  const codes = new Map([['XKX', 412], ['JEY', 830], ['GGY', 830]]);
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line || line.startsWith('#')) continue;
    const field = line.split('\t');
    if (!codes.has(field[1]) && Number(field[2])) codes.set(field[1], Number(field[2]));
  }
  return codes;
}

// Factbook items such as "Roman Catholic 85%" or "Muslim (official) 99.4% (Shia 90-95%)".
// Each item goes to one of the seven groups. Items such as "other" and "unspecified"
// go to no group.
const factbookGroups = [
  [/\bunaffiliated\b|\bnone\b|no religion|nonreligious|atheist|agnostic|non-believer/i, 'Religiously_unaffiliated'],
  [/christian|catholic|protestant|orthodox|anglican|lutheran|methodist|baptist|presbyterian|evangelical|pentecostal|adventist|jehovah|church|ekalesia|mormon|latter[- ]day|congregational|moravian|reformed|apostolic|episcopal|kimbanguist|calvinist|salvation army|brethren|mennonite|zionist/i, 'Christians'],
  [/muslim|islam|sunni|shia|ibadhi|ahmadi/i, 'Muslims'],
  [/hindu/i, 'Hindus'],
  [/buddhis/i, 'Buddhists'],
  [/jewish|judaism/i, 'Jews'],
  [/\bother\b|unspecified|unknown|don't know|refused|undeclared|no answer|not stated/i, null],
  [/./, 'Other_religions'],
];
const groupOf = name => factbookGroups.find(([pattern]) => pattern.test(name))[1];

// Shares by group, or else the group of the first religion in a list without shares.
export function factbookShares(data) {
  const text = clean(data?.['People and Society']?.Religions?.text ?? '').split(/\n|\bnote\b/)[0];
  const year = Number(text.match(/\((\d{4})(?: est\.)?\)\s*$/)?.[1]) || null;
  const items = [];
  let depth = 0, item = '';
  for (const char of text.replace(/\((\d{4})(?: est\.)?\)\s*$/, '')) {
    if (char === '(') depth++;
    if (char === ')') depth--;
    if (char === ',' && depth === 0) { items.push(item); item = ''; } else item += char;
  }
  items.push(item);
  const shares = Object.fromEntries(Object.keys(groupNames).map(group => [group, 0]));
  let found = false;
  for (const raw of items) {
    const plain = raw.replace(/\([^)]*\)/g, ' ').trim();
    const match = plain.match(/^(.*?)\s*(<\s*)?(\d*\.?\d+)(?:\s*-\s*(\d*\.?\d+))?\s*(?:%|$)/);
    if (!match) continue;
    const [, name, below, low, high] = match;
    const value = below ? Number(low) / 2 : high ? (Number(low) + Number(high)) / 2 : Number(low);
    const group = groupOf(name);
    if (!group) continue;
    shares[group] += value;
    found = true;
  }
  if (found) return { shares, year };
  const first = items[0].replace(/\([^)]*\)/g, ' ').trim();
  return first && groupOf(first) ? { first: groupOf(first), year } : null;
}

// The largest group and the next one. The next group is given when it holds a tenth or
// more of the people, or when the largest group is "No religion".
export function mainReligion(shares) {
  const ranked = Object.entries(shares).filter(([, value]) => value > 0).sort((a, b) => b[1] - a[1]);
  if (!ranked.length) return null;
  const [[group, share], next] = ranked;
  const round = value => Math.round(value * 10) / 10;
  const result = { name: groupNames[group], share: round(share) };
  if (next && (next[1] >= 10 || group === 'Religiously_unaffiliated')) result.next = { name: groupNames[next[0]], share: round(next[1]) };
  return result;
}
