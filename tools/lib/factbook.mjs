// Read fields from the final edition of The World Factbook (January 2026).
import { readdirSync, existsSync } from 'node:fs';
import { paths, readJson } from './sources.mjs';

const entities = {
  nbsp: ' ', amp: '&', quot: '"', apos: '’', lt: '<', gt: '>', ndash: '–', mdash: '—',
  rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', deg: '°', middot: '·',
  aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', yacute: 'ý',
  Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú',
  agrave: 'à', egrave: 'è', igrave: 'ì', ograve: 'ò', ugrave: 'ù',
  acirc: 'â', ecirc: 'ê', icirc: 'î', ocirc: 'ô', ucirc: 'û',
  auml: 'ä', euml: 'ë', iuml: 'ï', ouml: 'ö', uuml: 'ü', Auml: 'Ä', Ouml: 'Ö', Uuml: 'Ü',
  atilde: 'ã', otilde: 'õ', ntilde: 'ñ', Ntilde: 'Ñ', ccedil: 'ç', Ccedil: 'Ç',
  aring: 'å', Aring: 'Å', oslash: 'ø', Oslash: 'Ø', aelig: 'æ', szlig: 'ß',
};

export function clean(text = '') {
  return text
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&([a-z]+);/gi, (match, name) => entities[name] ?? match)
    .replace(/[ \t]+/g, ' ')
    .trim();
}

const index = new Map();
function buildIndex() {
  for (const region of readdirSync(paths.factbook, { withFileTypes: true })) {
    if (!region.isDirectory() || ['meta', 'world', 'oceans'].includes(region.name)) continue;
    for (const file of readdirSync(`${paths.factbook}${region.name}`)) {
      if (file.endsWith('.json')) index.set(file.slice(0, -5), `${paths.factbook}${region.name}/${file}`);
    }
  }
}

export function entry(code) {
  if (!index.size) buildIndex();
  const path = index.get(code);
  return path && existsSync(path) ? readJson(path) : null;
}

const number = text => Number(text.replace(/,/g, ''));

// "Mont Blanc 4,810" or "Rhone River delta -2 m". Notes after a semicolon or a line
// break, and remarks in parentheses, are removed.
export function point(text) {
  const first = clean(text).split(/;|\n|\bnote\b/)[0].replace(/\([^)]*\)/g, '').replace(/\s+/g, ' ').trim();
  const match = first.match(/^(.*?)[,\s]+(?:(?:more|less) than\s+)?(-?\d[\d,]*(?:\.\d+)?)\s*(?:m\b.*)?$/);
  if (!match || !match[1]) return null;
  return { name: match[1].trim(), m: number(match[2]) };
}

export function elevation(data) {
  const field = data?.Geography?.Elevation ?? {};
  return {
    highest: field['highest point']?.text ? point(field['highest point'].text) : null,
    lowest: field['lowest point']?.text ? point(field['lowest point'].text) : null,
  };
}

// "Lake Victoria (shared with Uganda and Kenya) - 62,940 sq km". A range such as
// "10,360-25,900 sq km" keeps both values.
export function lakes(data) {
  const field = data?.Geography?.['Major lakes (area sq km)'] ?? {};
  const found = [];
  for (const [kind, value] of Object.entries(field)) {
    if (!value?.text) continue;
    const salt = kind.startsWith('salt');
    for (const part of clean(value.text).split('\n')[0].split(';')) {
      const text = part.trim();
      if (!text) continue;
      const area = text.match(/(\d[\d,]*)(?:\s*[-–]\s*(\d[\d,]*))?(?:\s*sq km)?/g);
      const match = text.match(/^(.*?)\s*(?:\(([^)]*)\))?\s*[-–]?\s*(\d[\d,]*)(?:\s*[-–]\s*(\d[\d,]*))?\s*(?:sq km)?(.*)$/);
      if (!match || !area) continue;
      const shared = match[2]?.match(/shared with (.*)$/)?.[1] ?? text.match(/\(shared with ([^)]*)\)/)?.[1];
      found.push({
        name: match[1].replace(/\*$/, '').trim(),
        km2: number(match[3]),
        km2Max: match[4] ? number(match[4]) : null,
        salt,
        shared: shared ? shared.replace(/,? and /g, ', ').split(/,\s*/).map(s => s.trim()).filter(Boolean) : [],
      });
    }
  }
  return found;
}

// "aircraft, cars, packaged medicine, gas turbines, vehicle parts/accessories (2023)"
export function exports(data) {
  const text = clean(data?.Economy?.['Exports - commodities']?.text ?? '');
  if (!text || /^NA\b/.test(text)) return null;
  const year = text.match(/\((\d{4})(?: est\.)?\)\s*$/)?.[1];
  const list = text.replace(/\(\d{4}(?: est\.)?\)\s*$/, '').split('\n')[0].split(/,\s*/).map(s => s.trim()).filter(Boolean);
  return { items: list, year: year ? Number(year) : null };
}

// "$3.031 trillion (2023 est.)"
export function gdp(data) {
  const field = data?.Economy?.['GDP (official exchange rate)'];
  const text = clean(field?.text ?? '');
  const match = text.match(/\$([\d.,]+)\s*(trillion|billion|million)?\s*\((\d{4})/);
  if (!match) return null;
  const scale = { trillion: 1e12, billion: 1e9, million: 1e6 }[match[2]] ?? 1;
  return { usd: number(match[1]) * scale, year: Number(match[3]) };
}

// Languages marked "(official ...)" in the Factbook text and notes. The build
// compares this with a reviewed list, which is the published value.
export function officialLanguages(data) {
  const field = data?.['People and Society']?.Languages ?? {};
  const text = clean([field.Languages?.text, field.note].filter(Boolean).join('\n'));
  const found = [];
  for (const match of text.matchAll(/([A-Z][\p{L}'’ -]+?)\s*(?:\([^)]*\)\s*)?\((?:[^)]*\b)?official\b[^)]*\)/gu)) {
    found.push(match[1].trim());
  }
  for (const match of text.matchAll(/([A-Z][\p{L}' ]+?) (?:is|are) (?:the )?official/gu)) found.push(match[1].trim());
  return { found: [...new Set(found)], text };
}
